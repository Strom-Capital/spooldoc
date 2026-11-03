import { eq } from 'drizzle-orm';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emailSpecSchema, emptySpec, type JobTemplate } from '@/lib/job-spec';
import { destinations, jobs, runDeliveries, runFiles, runs, type RunStep } from '@/lib/server/db/schema';
import { deliverAll, deliveryTargets, type DeliverBase, type FoundTarget } from '@/lib/server/deliver';
import { destinationFor, type RunDocument, type RunFile } from '@/lib/server/destinations';
import { setMailSender, updateMail } from '@/lib/server/mail';
import { StepError } from '@/lib/server/step-error';
import { resetTables } from './helpers/db';
import { FakeConnection, loadSample } from './helpers/fake-connection';
import { builtinDestination, db, insertServer } from './helpers/fixtures';

const sample = loadSample('invoice');
const FOLDER = '/home/docs/out';
const templates: JobTemplate[] = [{ id: 'template-1', name: 'Invoice', kind: 'html', source: null, formats: ['pdf'] } as JobTemplate];

const documents: RunDocument[] = [0, 1].map((index) => ({
  pageGroupIndex: index,
  name: `invoice-26010${index + 1}`,
  pages: { first: index + 1, last: index + 1 },
  data: { pg: { invoiceNo: `26010${index + 1}` }, splf: sample.splf },
}));
const files: RunFile[] = documents.map((document) => ({
  pageGroupIndex: document.pageGroupIndex,
  template: 'Invoice',
  templateIndex: 0,
  name: `${document.name}.pdf`,
  contentType: 'application/pdf',
  content: new Uint8Array([37, 80, 68, 70]),
}));

describe('delivering a run to several destinations', () => {
  let runId: string;
  let jobId: string;
  let conn: FakeConnection;
  let steps: RunStep[];
  let sent: SendMailOptions[];

  beforeEach(async () => {
    await resetTables(db());
    const serverId = await insertServer();
    const spec = emptySpec({ serverId, library: 'MYLIB', queue: 'MYOUTQ', destinationId: await builtinDestination() });
    const [job] = await db().insert(jobs).values({ name: 'MYJOB', draft: spec, activeVersion: 1 }).returning();
    jobId = job!.id;
    const [run] = await db().insert(runs).values({ jobId, version: 1, trigger: 'manual', splf: sample.splf }).returning();
    runId = run!.id;
    conn = new FakeConnection();
    conn.folders.add(FOLDER);
    steps = [];
    sent = [];
    await updateMail({ host: 'smtp.example.com', port: 587, security: 'starttls', user: 'mailer', password: 'mail-Passw0rd', from: 'invoices@example.com', fromName: 'Example Co' });
    const json = nodemailer.createTransport({ jsonTransport: true });
    setMailSender(() => ({
      async sendMail(message) {
        sent.push(message);
        return json.sendMail(message);
      },
    }));
  });

  afterEach(() => setMailSender(null));

  const destination = async (kind: string, name: string, config: Record<string, unknown>) => {
    const [row] = await db().insert(destinations).values({ kind, name, config }).returning();
    return row!.id;
  };
  const ifs = (folder: string, keepCopy: boolean) => destination('ifs', `IFS ${folder}`, { folder, ifExists: 'replace', keepCopy });

  /** A target with every document, as the runner makes it. */
  const target = (destinationId: string, email = false): FoundTarget => ({
    route: null,
    destinationId,
    email: email ? emailSpecSchema.parse({ to: 'buyer@example.com', subject: 'Invoice {d.pg.invoiceNo}' }) : null,
    webhook: null,
    documents,
    destination: destinationFor(destinationId),
  });

  /** What the runner gives `deliverAll`, with a step that records like the runner's. */
  const base = (): DeliverBase => ({
    runId,
    files,
    job: { id: jobId, splfKey: 'key' },
    templates,
    context: { job: { id: jobId, name: 'MYJOB', version: 1 }, run: { id: runId, seq: 1 }, splf: sample.splf, attributes: sample.attributes, pageGroups: 2 },
    valueTypes: {},
    conn,
    host: 'ibmi.example.com',
    addSecret: () => undefined,
    step: async (about, deliver) => {
      try {
        const note = await deliver();
        steps.push({ step: 'deliver', ok: true, ms: 0, note, ...(about ? { destination: about } : {}) });
        return note;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        steps.push({ step: 'deliver', ok: false, ms: 0, error: message, ...(about ? { destination: about } : {}) });
        throw new StepError('deliver', message, err instanceof StepError ? err.detail : undefined);
      }
    },
  });

  const storedNames = async () => (await db().select({ name: runFiles.name }).from(runFiles).where(eq(runFiles.runId, runId))).map((row) => row.name).sort();

  it('gives a job without routes one target with every document', () => {
    const spec = emptySpec({ serverId: 'server-1', library: 'MYLIB', queue: 'MYOUTQ', destinationId: 'destination-1' });
    expect(deliveryTargets(spec, documents)).toEqual([{ route: null, destinationId: 'destination-1', email: null, webhook: null, documents }]);
  });

  it('still delivers to the second destination when the first fails, records both steps, and the first error leads', async () => {
    const missing = await ifs('/home/docs/missing', false);
    const download = await builtinDestination();
    const error = await deliverAll([target(missing), target(download)], base()).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(StepError);
    expect((error as StepError).message).toBe("The folder /home/docs/missing does not exist on ibmi.example.com. Create it, or change the destination's folder.");
    expect(steps.map((step) => [step.ok, step.destination?.kind])).toEqual([
      [false, 'ifs'],
      [true, 'spooldoc'],
    ]);
    expect(steps[0]!.destination).toEqual({ id: missing, name: 'IFS /home/docs/missing', kind: 'ifs' });
    expect(steps[1]!.note).toBe('Kept 2 files in Spooldoc');
    expect(await storedNames()).toEqual(['invoice-260101.pdf', 'invoice-260102.pdf']);
  });

  it('says how many more destinations failed, and a gone destination fails its own step', async () => {
    const missing = await ifs('/home/docs/missing', false);
    const gone = await ifs('/home/docs/gone', false);
    const other = await ifs('/home/docs/other', false);
    await db().delete(destinations).where(eq(destinations.id, gone));
    const targets = [target(missing), target(gone), target(other)];
    const error = await deliverAll(targets, base()).catch((err: unknown) => err);
    expect((error as Error).message).toBe(
      "The folder /home/docs/missing does not exist on ibmi.example.com. Create it, or change the destination's folder. 2 more destinations failed. The Deliver steps say why.",
    );
    expect(steps.map((step) => step.error)).toEqual([
      expect.stringContaining('/home/docs/missing'),
      'The destination is gone.',
      expect.stringContaining('/home/docs/other'),
    ]);
    expect(steps[1]!.destination).toBeUndefined();
  });

  it('says 1 more destination failed when two fail', async () => {
    const error = await deliverAll([target(await ifs('/home/docs/a', false)), target(await ifs('/home/docs/b', false))], base()).catch((err: unknown) => err);
    expect((error as Error).message).toMatch(/ 1 more destination failed\. The Deliver steps say why\.$/);
  });

  it('stores the files once for a Spooldoc download and an email destination', async () => {
    const email = await destination('email', 'Invoices by email', { testAddress: null });
    await deliverAll([target(await builtinDestination()), target(email, true)], base());
    expect(steps.map((step) => step.note)).toEqual(['Kept 2 files in Spooldoc', 'Sent 2 emails']);
    expect(sent).toHaveLength(2);
    expect(await storedNames()).toEqual(['invoice-260101.pdf', 'invoice-260102.pdf']);
    const deliveries = await db().select().from(runDeliveries).where(eq(runDeliveries.runId, runId));
    expect(deliveries.map((d) => d.destinationId)).toEqual([email, email]);
  });

  it('stores the files once for a download next to an IFS folder, with a copy kept or not', async () => {
    for (const keepCopy of [false, true]) {
      await db().delete(runFiles);
      steps = [];
      await deliverAll([target(await ifs(FOLDER, keepCopy)), target(await builtinDestination())], base());
      expect(steps.every((step) => step.ok)).toBe(true);
      expect(await storedNames()).toEqual(['invoice-260101.pdf', 'invoice-260102.pdf']);
    }
  });

  it('gives each target only the files of its documents', async () => {
    const one: FoundTarget = { ...target(await builtinDestination()), documents: documents.slice(1) };
    await deliverAll([one], base());
    expect(steps[0]!.note).toBe('Kept 1 file in Spooldoc');
    expect(await storedNames()).toEqual(['invoice-260102.pdf']);
  });

  it('sends no email to a target whose documents get none, and succeeds', async () => {
    const email = await destination('email', 'Invoices by email', { testAddress: null });
    await deliverAll([{ ...target(email, true), documents: [] }], base());
    expect(steps[0]).toMatchObject({ ok: true, note: 'Sent 0 emails' });
    expect(sent).toHaveLength(0);
  });
});
