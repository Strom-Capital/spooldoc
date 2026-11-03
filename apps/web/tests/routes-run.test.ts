import { and, eq } from 'drizzle-orm';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emailSpecSchema, emptySpec, type JobSpec, type JobTemplate, type Route } from '@/lib/job-spec';
import { destinations, jobs, jobVersions, runDeliveries, runs } from '@/lib/server/db/schema';
import { setMailSender, updateMail } from '@/lib/server/mail';
import { runJob } from '@/lib/server/runner';
import { getRun } from '@/lib/server/runs';
import { resetTables } from './helpers/db';
import { FakeConnection, fixtureText, GOOD_PASSWORD, loadSample } from './helpers/fake-connection';
import { db, insertServer } from './helpers/fixtures';

const FOLDER = '/home/docs/out';
/** The invoice of page group 4 goes to a customer in Sweden; the others are in Finland. */
const SWEDEN = { field: 'pg.address3', op: 'matches', pattern: '^SE-' } as const;

describe('routes in a run', () => {
  const sample = loadSample('invoice');
  let serverId: string;
  let sent: SendMailOptions[];
  let ids: { email: string; copy: string; ifs: string };

  beforeEach(async () => {
    await resetTables(db());
    serverId = await insertServer();
    sent = [];
    await updateMail({ host: 'smtp.example.com', port: 587, security: 'starttls', user: 'mailer', password: 'mail-Passw0rd', from: 'invoices@example.com', fromName: 'Example Co' });
    const json = nodemailer.createTransport({ jsonTransport: true });
    setMailSender(() => ({
      async sendMail(message) {
        sent.push(message);
        return json.sendMail(message);
      },
    }));
    const [email] = await db().insert(destinations).values({ kind: 'email', name: 'MYEMAIL', config: { testAddress: null } }).returning();
    const [copy] = await db().insert(destinations).values({ kind: 'email', name: 'MYEMAIL2', config: { testAddress: null } }).returning();
    const [ifs] = await db().insert(destinations).values({ kind: 'ifs', name: 'MYIFS', config: { folder: FOLDER, keepCopy: false } }).returning();
    ids = { email: email!.id, copy: copy!.id, ifs: ifs!.id };
  });

  afterEach(() => setMailSender(null));

  const mail = (change: Record<string, unknown> = {}) => emailSpecSchema.parse({ to: '{d.pg.customerNo}@example.com', subject: 'Invoice {d.pg.invoiceNo}', ...change });
  const entry = (destinationId: string, email: ReturnType<typeof mail> | null = null) => ({ destinationId, email, webhook: null });

  /** An invoice job whose version `number` has these routes; the job's active version. */
  async function routedJob(routes: Route[], templates?: JobTemplate[], jobId?: string, number = 1): Promise<string> {
    const base = emptySpec({ serverId, library: 'MYLIB', queue: 'INVOICES' });
    const spec: JobSpec = {
      ...base,
      extract: { definition: fixtureText('invoice', 'definition.yaml') },
      render: templates ? { templates } : base.render,
      destination: { routes },
    };
    let id = jobId;
    if (!id) [{ id }] = (await db().insert(jobs).values({ name: 'Invoices', draft: spec }).returning({ id: jobs.id })) as [{ id: string }];
    await db().insert(jobVersions).values({ jobId: id!, number, spec });
    await db().update(jobs).set({ activeVersion: number }).where(eq(jobs.id, id!));
    return id!;
  }

  const run = async (jobId: string, conn: FakeConnection, version = 1) => {
    const runId = await runJob({ jobId, version, splf: sample.splf, trigger: 'manual' }, { conn, host: 'ibmi.example.com', serverId, password: GOOD_PASSWORD });
    return (await getRun(runId))!;
  };
  const fakeIfs = () => {
    const conn = new FakeConnection();
    conn.folders.add(FOLDER);
    return conn;
  };

  it('emails the documents that match a route and writes the rest to the IFS, with the route of each', async () => {
    const jobId = await routedJob([{ when: [SWEDEN], destinations: [entry(ids.email, mail())] }, { when: [], destinations: [entry(ids.ifs)] }]);
    const conn = fakeIfs();
    const view = await run(jobId, conn);
    expect(view.status).toBe('success');
    expect(view.routes).toBe(2);
    expect(view.otherwise).toBe(true);
    expect(sent.map((message) => message.subject)).toEqual(['Invoice 260104']);
    expect([...conn.ifs.keys()].sort()).toEqual(['260101', '260102', '260103', '260105', '260106'].map((no) => `${FOLDER}/invoice-${no}.pdf`));
    expect(view.steps.map((step) => step.step)).toEqual(['capture', 'extract', 'route', 'render', 'deliver', 'deliver', 'finish']);
    expect(view.steps.find((step) => step.step === 'route')).toMatchObject({ ok: true, note: 'Route 1: 1 page group, otherwise: 5' });
    expect(view.steps.filter((step) => step.step === 'deliver').map((step) => [step.destination?.name, step.route])).toEqual([
      ['MYEMAIL', 1],
      ['MYIFS', 2],
    ]);
    expect(view.deliveries.filter((d) => d.kind === 'email').map((d) => [d.document, d.route])).toEqual([['invoice-260104', 1]]);
    expect(conn.actions()).toEqual(['holdSpooledFile']);
  });

  it('records no Route step for one route without conditions', async () => {
    const jobId = await routedJob([{ when: [], destinations: [entry(ids.email, mail())] }]);
    const view = await run(jobId, new FakeConnection());
    expect(view.status).toBe('success');
    expect(view.steps.map((step) => step.step)).not.toContain('route');
    expect(view.steps.find((step) => step.step === 'deliver')?.route).toBeUndefined();
    expect(view.deliveries.map((d) => d.route)).toEqual(Array(6).fill(1));
  });

  it('delivers what matches, then fails the run and leaves the spooled file alone when a page group matches no route', async () => {
    const jobId = await routedJob([{ when: [SWEDEN], destinations: [entry(ids.email, mail())] }]);
    const conn = new FakeConnection();
    const view = await run(jobId, conn);
    expect(view.status).toBe('failed');
    expect(view.error).toBe(
      '1 of 6 documents took a route. Page group 1 (invoice-260101) matched no route: pg.address3 is FI-90100 OULU, which does not match /^SE-/. 4 more documents matched no route. The Route step lists each one.',
    );
    const route = view.steps.find((step) => step.step === 'route');
    expect(route).toMatchObject({ ok: false, error: '5 documents matched no route.', note: 'Route 1: 1 page group, no route: 5' });
    expect(route?.unrouted?.map((item) => item.pageGroup)).toEqual([0, 1, 2, 4, 5]);
    expect(route?.unrouted?.[0]).toEqual({ pageGroup: 0, document: 'invoice-260101', reasons: ['pg.address3 is FI-90100 OULU, which does not match /^SE-/'] });
    expect(sent).toHaveLength(1);
    expect(view.steps.map((step) => step.step)).not.toContain('finish');
    expect(conn.actions()).toEqual([]);
  });

  it('lets the error of a failed destination lead, with the documents that took no route after it', async () => {
    await db().update(destinations).set({ config: { folder: '/home/docs/missing', keepCopy: false } }).where(eq(destinations.id, ids.ifs));
    const jobId = await routedJob([{ when: [SWEDEN], destinations: [entry(ids.ifs)] }]);
    const view = await run(jobId, new FakeConnection());
    expect(view.status).toBe('failed');
    expect(view.error).toMatch(/^The folder \/home\/docs\/missing does not exist on ibmi\.example\.com\..* Page group 1 \(invoice-260101\) matched no route: /);
    expect(view.error).not.toMatch(/took a route/);
  });

  it('sends only the documents that were not sent when Retry runs a version with Otherwise', async () => {
    const jobId = await routedJob([{ when: [SWEDEN], destinations: [entry(ids.email, mail())] }]);
    const conn = fakeIfs();
    expect((await run(jobId, conn)).status).toBe('failed');
    expect(sent).toHaveLength(1);

    await routedJob([{ when: [SWEDEN], destinations: [entry(ids.email, mail())] }, { when: [], destinations: [entry(ids.ifs)] }], undefined, jobId, 2);
    sent = [];
    const retry = await run(jobId, conn, 2);
    expect(retry.status).toBe('success');
    expect(sent).toEqual([]);
    expect(retry.deliveries.filter((d) => d.kind === 'email').map((d) => d.status)).toEqual(['already_sent']);
    expect(conn.ifs.size).toBe(5);
    expect(conn.actions()).toEqual(['holdSpooledFile']);
  });

  it('sends each email destination of a route its own message, from its own message template', async () => {
    const templates: JobTemplate[] = [
      { id: 'template-1', name: 'Template 1', kind: 'html', source: null, formats: ['pdf'] },
      { id: 'message', name: 'Message', kind: 'html', source: '<p>Dear customer {d.pg.customerNo}</p>', formats: ['pdf'] },
    ];
    const jobId = await routedJob(
      [{ when: [SWEDEN], destinations: [entry(ids.email, mail({ body: 'Written for Sweden' })), entry(ids.copy, mail({ to: 'archive@example.com', bodyTemplateId: 'message' }))] }, { when: [], destinations: [entry(ids.ifs)] }],
      templates,
    );
    const view = await run(jobId, fakeIfs());
    expect(view.status).toBe('success');
    expect(sent.map((message) => (message.to as string[])[0])).toEqual(['10004@example.com', 'archive@example.com']);
    expect(String(sent[0]!.text)).toContain('Written for Sweden');
    expect(String(sent[1]!.html)).toContain('Dear customer 10004');
    const rows = await db()
      .select({ route: runDeliveries.route, destinationId: runDeliveries.destinationId })
      .from(runDeliveries)
      .where(and(eq(runDeliveries.runId, view.id), eq(runDeliveries.kind, 'email')));
    expect(rows).toEqual([
      { route: 1, destinationId: ids.email },
      { route: 1, destinationId: ids.copy },
    ]);
    // The files written to the IFS, two templates for each of five page groups, came by Otherwise.
    expect(view.deliveries.filter((d) => d.kind === 'ifs').map((d) => d.route)).toEqual(Array(10).fill(2));
    expect((await db().select({ status: runs.status }).from(runs))[0]!.status).toBe('success');
  });
});
