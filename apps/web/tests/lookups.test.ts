import type { Lookup } from '@spooldoc/core';
import { ConnectionError, type QueryParam } from '@spooldoc/ibmi';
import { eq } from 'drizzle-orm';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailSpecSchema, emptySpec, type JobSpec } from '@/lib/job-spec';
import { destinations, jobs, jobVersions, runs } from '@/lib/server/db/schema';
import type { LookupTestView, RunView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { fakeCarbone, sentPageGroup } from './helpers/carbone';
import { resetTables } from './helpers/db';
import { FakeConnection, fixtureText, GOOD_PASSWORD, loadSample } from './helpers/fake-connection';
import { db, insertServer } from './helpers/fixtures';
import { appRequest, connections, params } from './helpers/mocks';

vi.mock('@spooldoc/ibmi/jt400', async () => (await import('./helpers/mocks')).fakeJt400);

const jobsRoute = await import('@/app/api/jobs/route');
const jobRoute = await import('@/app/api/jobs/[id]/route');
const previewSample = await import('@/app/api/jobs/[id]/preview-sample/route');
const renderRoute = await import('@/app/api/jobs/[id]/render/route');
const testRoute = await import('@/app/api/jobs/[id]/lookups/test/route');
const emailPreview = await import('@/app/api/jobs/[id]/email-preview/route');
const versions = await import('@/app/api/jobs/[id]/versions/route');
const runsRoute = await import('@/app/api/jobs/[id]/runs/route');
const { clearPreviewCache } = await import('@/lib/server/lookups');
const { runJob } = await import('@/lib/server/runner');
const { setMailSender, updateMail } = await import('@/lib/server/mail');

const sample = loadSample('invoice');
const yaml = fixtureText('invoice', 'definition.yaml');
const { library, name: queue } = sample.attributes.queue;

const SQL = 'SELECT NAME, EMAIL, BALANCE FROM MYLIB.CUSTOMERS WHERE CUSTNO = :customerNo';
const COLUMNS = [
  { name: 'NAME', type: 'CHAR', precision: 40, scale: 0, nullable: false },
  { name: 'EMAIL', type: 'VARCHAR', precision: 80, scale: 0, nullable: true },
  { name: 'BALANCE', type: 'DECIMAL', precision: 11, scale: 2, nullable: false },
];
const CHECKED: Lookup['checked'] = {
  sql: SQL,
  columns: [
    { name: 'NAME', type: 'string' },
    { name: 'EMAIL', type: 'string' },
    { name: 'BALANCE', type: 'number' },
  ],
};
const TEMPLATE = '<p>{d.pg.invoiceNo}</p><p>{d.pg.customer.EMAIL}</p>';

const customer = (change: Partial<Lookup> = {}): Lookup => ({ name: 'customer', sql: SQL, result: 'one', missing: 'warn', ...change });

/** Answers like MYLIB.CUSTOMERS: one row for each customer number, none for 10003. */
function customers(sql: string, values: readonly QueryParam[]) {
  const parameters = sql.includes('?') ? [{ type: 'CHAR', precision: 10, scale: 0, nullable: false }] : [];
  const custNo = String(values[0] ?? '');
  const rows = custNo === '10003' || values.length === 0 ? [] : [{ NAME: `Customer ${custNo}`, EMAIL: `ap-${custNo}@example.com`, BALANCE: '1234.50' }];
  return { columns: COLUMNS, rows, parameters };
}

let auth: Record<string, string>;
let serverId: string;

const post = (path: string, body?: unknown) => appRequest(path, { method: 'POST', body: body ?? {}, headers: auth });
const patch = (path: string, body: unknown) => appRequest(path, { method: 'PATCH', body, headers: auth });
const fake = (): FakeConnection => connections.get('ibmi.example.com|DEMOUSER')!;

/** A job with the invoice definition, a template that reads the lookup, the invoice sample as preview, and the lookups given. */
async function lookupJob(lookups: Lookup[]): Promise<string> {
  const created = await jobsRoute.POST(post('/api/jobs', { serverId, library, queue }));
  const { id } = await created.json();
  const templates = [{ id: 'main', name: 'Document', kind: 'html', source: TEMPLATE, formats: ['html'] }];
  await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { extract: { definition: yaml }, render: { templates }, lookups } }), params({ id }));
  expect((await previewSample.POST(post(`/api/jobs/${id}/preview-sample`, { splf: sample.splf }), params({ id }))).status).toBe(201);
  fake().queryAnswer = customers;
  return id;
}

const testLookup = async (id: string, lookups: Lookup[], index = 0, pageGroup = 0) =>
  testRoute.POST(post(`/api/jobs/${id}/lookups/test`, { lookups, index, pageGroup }), params({ id }));

async function runOnce(id: string): Promise<RunView> {
  const saved = await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
  expect(saved.status, JSON.stringify(await saved.clone().json())).toBe(201);
  const [run] = (await (await runsRoute.POST(post(`/api/jobs/${id}/runs`, { splfs: [sample.splf] }), params({ id }))).json()).runs as RunView[];
  return run!;
}

beforeEach(async () => {
  await resetTables(db());
  connections.clear();
  clearPreviewCache();
  auth = await signedIn();
  serverId = await insertServer();
});

describe('testing a lookup', () => {
  it('checks the SQL, runs it with the page group values and answers with the columns to keep', async () => {
    const id = await lookupJob([customer()]);
    const response = await testLookup(id, [customer()]);
    expect(response.status).toBe(200);
    const view = (await response.json()) as LookupTestView;
    expect(view).toMatchObject({
      checked: CHECKED,
      columns: [
        { name: 'NAME', type: 'string', db2: 'CHAR(40)' },
        { name: 'EMAIL', type: 'string', db2: 'VARCHAR(80)' },
        { name: 'BALANCE', type: 'number', db2: 'DECIMAL(11,2)' },
      ],
      parameters: [{ name: 'customerNo', value: '10001', source: 'd.pg.customerNo', marker: 'CHAR(10)' }],
      rows: [{ NAME: 'Customer 10001', EMAIL: 'ap-10001@example.com', BALANCE: 1234.5 }],
      rowCount: 1,
      host: 'ibmi.example.com',
    });
    const queries = fake().calls.filter((c) => c.method === 'query' || c.method === 'describeQuery');
    expect(queries.map((c) => c.args[0])).toEqual(['SELECT NAME, EMAIL, BALANCE FROM MYLIB.CUSTOMERS WHERE CUSTNO = ?', 'SELECT NAME, EMAIL, BALANCE FROM MYLIB.CUSTOMERS WHERE CUSTNO = ?']);
    expect(queries[1]!.args[1]).toEqual(['10001']);
    // A lookup only reads: nothing on the IBM i changed.
    expect(fake().actions()).toEqual([]);
  });

  it('refuses a parameter that is not in the data, before it asks the IBM i', async () => {
    const id = await lookupJob([]);
    const bad = customer({ sql: 'SELECT NAME FROM MYLIB.CUSTOMERS WHERE CUSTNO = :customerNumber' });
    const response = await testLookup(id, [bad]);
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe(':customerNumber is not a field of the page group or an earlier lookup. Check the name against the definition.');
    expect(fake().calls.some((c) => c.method === 'describeQuery')).toBe(false);
  });

  it('flags a text value bound to a number marker', async () => {
    const id = await lookupJob([]);
    fake().queryAnswer = () => ({ columns: COLUMNS, rows: [], parameters: [{ type: 'DECIMAL', precision: 7, scale: 0, nullable: false }] });
    const response = await testLookup(id, [customer({ sql: 'SELECT NAME FROM MYLIB.CUSTOMERS WHERE CUSTNO = :customerName' })]);
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/^:customerName is text \("NORTHERN SUPPLY CO"\), and Db2 for i compares it with a number \(DECIMAL\(7,0\)\)/);
  });

  it('says which lookup Db2 for i refused, with its own text one step away', async () => {
    const id = await lookupJob([]);
    fake().failures.set(
      'describeQuery',
      new ConnectionError('query', 'MYLIB.CUSTOMERS was not found (SQL0204). Check the library and table, or the server\'s user profile.', {
        messageId: 'SQL0204',
        detail: 'CUSTOMERS in MYLIB type *FILE not found.',
      }),
    );
    const response = await testLookup(id, [customer()]);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Could not run customer: MYLIB.CUSTOMERS was not found (SQL0204). Check the library and table, or the server's user profile.",
      code: 'query',
      messageId: 'SQL0204',
      detail: 'CUSTOMERS in MYLIB type *FILE not found.',
    });
  });

  it('refuses more than one row for a lookup of one row, and columns templates cannot read', async () => {
    const id = await lookupJob([]);
    fake().queryAnswer = () => ({ columns: COLUMNS, rows: [{ NAME: 'A', EMAIL: null, BALANCE: '1' }, { NAME: 'B', EMAIL: null, BALANCE: '2' }, { NAME: 'C', EMAIL: null, BALANCE: '3' }] });
    const many = await testLookup(id, [customer()]);
    expect(many.status).toBe(422);
    expect((await many.json()).error).toBe('customer returned 3 rows for customerNo 10001. Add a condition, or FETCH FIRST 1 ROW ONLY.');

    fake().queryAnswer = () => ({ columns: [...COLUMNS, { ...COLUMNS[0]!, name: '00004' }, COLUMNS[1]!], rows: [] });
    const columns = await testLookup(id, [customer()]);
    expect((await columns.json()).problems).toEqual([
      'Column 4 of customer is named 00004, which templates cannot read. Name it with AS, such as TRIM(NAME) AS NAME.',
      'customer returns two columns named EMAIL. Give one of them another name with AS.',
    ]);
  });
});

describe('saving a version with lookups', () => {
  it('refuses a lookup that was never tested or changed since, without the IBM i', async () => {
    const id = await lookupJob([customer()]);
    const calls = fake().calls.length;
    const untested = await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    expect(untested.status).toBe(422);
    expect((await untested.json()).problems).toEqual(['Lookups: Test lookup customer before you save this version.']);

    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { lookups: [customer({ checked: { ...CHECKED!, sql: `${SQL} AND 1 = 1` } })] } }), params({ id }));
    const changed = await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }));
    expect((await changed.json()).problems).toEqual(['Lookups: customer changed since its test. Test it again before you save this version.']);
    expect(fake().calls.length).toBe(calls);

    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { lookups: [customer({ checked: CHECKED })] } }), params({ id }));
    expect((await versions.POST(post(`/api/jobs/${id}/versions`, {}), params({ id }))).status).toBe(201);
  });
});

describe('lookups in the preview and the run', () => {
  it('renders the preview with the lookup values, and says what ran', async () => {
    const id = await lookupJob([customer({ checked: CHECKED })]);
    const result = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, {}), params({ id }))).json();
    expect(result.errors).toEqual([]);
    expect(result.html).toContain('<p>ap-10001@example.com</p>');
    expect(result.lookups).toMatchObject({
      ran: ['customer'],
      problems: [],
      misses: [],
      traces: [{ lookup: 'customer', pageGroup: 0, parameters: [{ name: 'customerNo', value: '10001' }], rows: 1, cached: false }],
      pageGroup: { invoiceNo: '260101', customer: { EMAIL: 'ap-10001@example.com', BALANCE: 1234.5 } },
    });
    // The extracted JSON stays as the definition read it.
    expect(result.extract.pageGroups[0].customer).toBeUndefined();
    // Rendering again takes the result from the cache, so typing in a template does not query the IBM i again.
    const queries = fake().calls.filter((c) => c.method === 'query').length;
    const again = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, { html: `${TEMPLATE}<p>more</p>` }), params({ id }))).json();
    expect(again.lookups.traces[0].cached).toBe(true);
    expect(fake().calls.filter((c) => c.method === 'query').length).toBe(queries);
  });

  it('runs no untested lookup in the preview, and renders without it when the IBM i refuses', async () => {
    const id = await lookupJob([customer()]);
    const untested = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, { html: '<p>{d.pg.invoiceNo}</p>' }), params({ id }))).json();
    expect(untested.lookups.ran).toEqual([]);
    expect(fake().calls.some((c) => c.method === 'query')).toBe(false);

    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { lookups: [customer({ checked: CHECKED })] } }), params({ id }));
    fake().failures.set('query', new ConnectionError('timeout', 'The query ran longer than 30 seconds and was canceled (SQL0952).'));
    const failed = await (await renderRoute.POST(post(`/api/jobs/${id}/render`, { html: '<p>{d.pg.invoiceNo}</p>' }), params({ id }))).json();
    expect(failed.html).toContain('<p>260101</p>');
    expect(failed.errors).toEqual(['Lookups: Could not run customer: The query ran longer than 30 seconds and was canceled (SQL0952).']);
    expect(failed.lookups.error).toMatchObject({ lookup: 'customer', code: 'timeout', message: 'Could not run customer: The query ran longer than 30 seconds and was canceled (SQL0952).' });
  });

  it('gives the preview and the run the same data', async () => {
    const id = await lookupJob([customer({ checked: CHECKED })]);
    await renderRoute.POST(post(`/api/jobs/${id}/render`, { pageGroup: 0 }), params({ id }));
    const previewed = sentPageGroup(fakeCarbone.mock.calls.at(-1)![0]);
    fakeCarbone.mockClear();
    await runOnce(id);
    const ran = fakeCarbone.mock.calls.map((call) => sentPageGroup(call[0])).find((group) => group?.invoiceNo === '260101');
    expect(ran).toEqual(previewed);
    expect(ran?.customer).toEqual({ NAME: 'Customer 10001', EMAIL: 'ap-10001@example.com', BALANCE: 1234.5 });
  });

  it('records a Lookups step, and a lookup that finds no row and warns gives a warning run with the document name', async () => {
    const id = await lookupJob([customer({ checked: CHECKED })]);
    const run = await runOnce(id);
    expect(run.steps.map((s) => s.step)).toEqual(['capture', 'extract', 'lookup', 'render', 'deliver', 'finish']);
    const step = run.steps.find((s) => s.step === 'lookup')!;
    expect(step).toMatchObject({ ok: true, note: '1 lookup, 6 queries', warnings: ['No row in customer for customerNo 10003 (invoice-260102)'] });
    expect(run.status).toBe('warning');
    expect(run.error).toBe('Delivered, but a lookup found no row: No row in customer for customerNo 10003 (invoice-260102).');
    expect(run.files).toHaveLength(6);
    expect(fake().actions()).toEqual(['holdSpooledFile']);
  });

  it('records no Lookups step for a job without lookups', async () => {
    const created = await jobsRoute.POST(post('/api/jobs', { serverId, library, queue }));
    const { id } = await created.json();
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { extract: { definition: yaml } } }), params({ id }));
    const run = await runOnce(id);
    expect(run.steps.map((s) => s.step)).not.toContain('lookup');
  });

  it('stops the run at Lookups when a lookup that must find a row finds none, and leaves the file alone', async () => {
    const id = await lookupJob([customer({ missing: 'fail', checked: CHECKED })]);
    const run = await runOnce(id);
    expect(run.status).toBe('failed');
    expect(run.steps.map((s) => [s.step, s.ok])).toEqual([
      ['capture', true],
      ['extract', true],
      ['lookup', false],
    ]);
    expect(run.error).toBe('No row in customer for customerNo 10003 (invoice-260102). Check the values, or set When no row is found to Warn and leave it empty.');
    expect(run.files).toEqual([]);
    expect(fake().actions()).toEqual([]);
  });

  it('runs a row lookup once per distinct set of parameters in a run', async () => {
    const product: Lookup = {
      name: 'product',
      for: 'lines',
      sql: 'SELECT DESC FROM MYLIB.PRODUCTS WHERE ITEM = :item',
      result: 'one',
      missing: 'empty',
      checked: { sql: 'SELECT DESC FROM MYLIB.PRODUCTS WHERE ITEM = :item', columns: [{ name: 'DESC', type: 'string' }] },
    };
    const id = await lookupJob([product]);
    const templates = [{ id: 'main', name: 'Document', kind: 'html', source: '<p>{d.pg.lines[i].product.DESC}</p><p>{d.pg.lines[i+1]}</p>', formats: ['html'] }];
    await jobRoute.PATCH(patch(`/api/jobs/${id}`, { draft: { render: { templates } } }), params({ id }));
    fake().queryAnswer = (_sql, values) => ({ columns: [{ name: 'DESC', type: 'VARCHAR', precision: 40, scale: 0, nullable: true }], rows: [{ DESC: `About ${String(values[0])}` }] });
    const run = await runOnce(id);
    const items = new Set((JSON.parse(fixtureText('invoice', 'expected.json')) as { lines: { item: string }[] }[]).flatMap((g) => g.lines.map((l) => l.item)));
    expect(run.steps.find((s) => s.step === 'lookup')?.note).toBe(`1 lookup, ${items.size} queries`);
    expect(run.status).toBe('success');
  });
});

describe('an email To address from a lookup', () => {
  let sent: SendMailOptions[];

  beforeEach(async () => {
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

  afterEach(() => {
    setMailSender(null);
  });

  async function emailJob(lookups: Lookup[]): Promise<{ jobId: string; spec: JobSpec }> {
    const [destination] = await db().insert(destinations).values({ kind: 'email', name: 'Invoices by email', config: { testAddress: null } }).returning();
    const base = emptySpec({ serverId, library, queue, destinationId: destination!.id });
    const spec: JobSpec = {
      ...base,
      extract: { definition: yaml },
      lookups,
      destination: { destinationId: destination!.id, email: emailSpecSchema.parse({ to: '{d.pg.customer.EMAIL}', subject: 'Invoice {d.pg.invoiceNo}' }), webhook: null },
    };
    const [job] = await db().insert(jobs).values({ name: 'Invoices', draft: spec, activeVersion: 1 }).returning();
    await db().insert(jobVersions).values({ jobId: job!.id, number: 1, spec });
    return { jobId: job!.id, spec };
  }

  it('sends each email to the address the lookup found, and the preview lists the lookup columns', async () => {
    const { jobId } = await emailJob([customer({ missing: 'empty', checked: CHECKED })]);
    const conn = new FakeConnection();
    conn.queryAnswer = (sql, values) => {
      const answer = customers(sql, values);
      // Every customer has an address here, so every email goes.
      return values[0] === '10003' ? { ...answer, rows: [{ NAME: 'Customer 10003', EMAIL: 'ap-10003@example.com', BALANCE: '0' }] } : answer;
    };
    const runId = await runJob({ jobId, version: 1, splf: sample.splf, trigger: 'manual' }, { conn, host: 'ibmi.example.com', serverId, password: GOOD_PASSWORD });
    const [row] = await db().select().from(runs).where(eq(runs.id, runId));
    expect(row!.status, row!.error ?? '').toBe('success');
    expect(sent.map((m) => (m.to as string[])[0])).toEqual(['ap-10001@example.com', 'ap-10003@example.com', 'ap-10002@example.com', 'ap-10004@example.com', 'ap-10008@example.com', 'ap-10006@example.com']);

    // The draft's preview of the email has the address and lists the lookup's columns to insert.
    const captured = await previewSample.POST(post(`/api/jobs/${jobId}/preview-sample`, { splf: sample.splf }), params({ id: jobId }));
    expect(captured.status).toBe(201);
    fake().queryAnswer = customers;
    const [job] = await db().select().from(jobs).where(eq(jobs.id, jobId));
    const preview = await (
      await emailPreview.POST(post(`/api/jobs/${jobId}/email-preview`, { email: (job!.draft as JobSpec).destination.email }), params({ id: jobId }))
    ).json();
    expect(preview.to).toEqual([{ text: 'ap-10001@example.com', tag: '{d.pg.customer.EMAIL}', state: 'found' }]);
    expect(preview.unknownTags).toEqual([]);
    expect(preview.fields.map((f: { path: string }) => f.path)).toEqual(expect.arrayContaining(['pg.customer.EMAIL', 'pg.customer.BALANCE']));
    expect(preview.fields.map((f: { path: string }) => f.path)).not.toContain('pg.customer');
  });
});
