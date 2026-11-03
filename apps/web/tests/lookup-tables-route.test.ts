import { beforeEach, describe, expect, it } from 'vitest';
import { emptySpec } from '@/lib/job-spec';
import { jobs, jobVersions } from '@/lib/server/db/schema';
import { lookupTableJobs } from '@/lib/server/jobs-using';
import type { LookupTableSummary, LookupTableView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { resetTables } from './helpers/db';
import { db, insertJob, insertServer } from './helpers/fixtures';
import { appRequest, params } from './helpers/mocks';

const listRoute = await import('@/app/api/lookup-tables/route');
const tableRoute = await import('@/app/api/lookup-tables/[id]/route');
const csvRoute = await import('@/app/api/lookup-tables/[id]/csv/route');

const COLUMNS = [
  { name: 'CODE', type: 'string' },
  { name: 'DAYS', type: 'number' },
  { name: 'FROM', type: 'date' },
  { name: 'TEXT', type: 'string' },
];
const ROWS = [
  ['14', 14, '2026-01-01', 'Net 14 days'],
  ['30', 30, null, 'Netto 30 päivää, "pankki"'],
];

let auth: Record<string, string>;

const create = (body: unknown) => listRoute.POST(appRequest('/api/lookup-tables', { method: 'POST', body, headers: auth }));
const list = async (): Promise<LookupTableSummary[]> => (await (await listRoute.GET(appRequest('/api/lookup-tables', { headers: auth }))).json()).tables;
const get = (id: string) => tableRoute.GET(appRequest(`/api/lookup-tables/${id}`, { headers: auth }), params({ id }));
const update = (id: string, body: unknown) => tableRoute.PATCH(appRequest(`/api/lookup-tables/${id}`, { method: 'PATCH', body, headers: auth }), params({ id }));
const remove = (id: string) => tableRoute.DELETE(appRequest(`/api/lookup-tables/${id}`, { method: 'DELETE', headers: auth }), params({ id }));

async function made(name = 'payment-terms'): Promise<LookupTableView> {
  const response = await create({ name, columns: COLUMNS, rows: ROWS });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return response.json();
}

/** A table lookup of payment-terms, keyed on CODE. */
const termsLookup = (table: string, column = 'CODE') => ({ source: 'table', name: 'terms', table, key: [{ column, param: 'paymentTerms' }], result: 'one', missing: 'warn' });

beforeEach(async () => {
  await resetTables(db());
  auth = await signedIn();
});

describe('lookup tables', () => {
  it('creates, lists, reads, saves and deletes a table', async () => {
    const table = await made();
    expect(table).toMatchObject({ name: 'payment-terms', columns: COLUMNS, rows: ROWS, revision: 1, jobs: [] });
    expect(await list()).toEqual([expect.objectContaining({ id: table.id, name: 'payment-terms', rows: 2, revision: 1, jobs: [] })]);
    expect(await (await get(table.id)).json()).toMatchObject({ rows: ROWS });

    const saved = await update(table.id, { revision: 1, rows: [ROWS[0]] });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ revision: 2, rows: [ROWS[0]] });
    const renamed = await update(table.id, { revision: 2, name: 'terms-fi' });
    expect(await renamed.json()).toMatchObject({ name: 'terms-fi', revision: 3 });

    expect((await remove(table.id)).status).toBe(204);
    expect(await list()).toEqual([]);
    expect((await get(table.id)).status).toBe(404);
    expect((await remove(table.id)).status).toBe(404);
  });

  it('refuses a name taken, or one that is not lowercase letters, digits, dashes and underscores', async () => {
    await made();
    const taken = await create({ name: 'payment-terms', columns: COLUMNS, rows: [] });
    expect(taken.status).toBe(409);
    expect((await taken.json()).error).toBe('There is already a lookup table named payment-terms. Pick another name.');
    expect((await create({ name: 'Payment Terms', columns: COLUMNS, rows: [] })).status).toBe(400);
    const other = await made('other');
    const renamed = await update(other.id, { revision: 1, name: 'payment-terms' });
    expect(renamed.status).toBe(409);
  });

  it('refuses columns and cells that break the rules, naming the place', async () => {
    const bad = async (body: Record<string, unknown>) => (await (await create({ name: 'x', ...body })).json()).error;
    expect(await bad({ columns: [{ name: 'Due date', type: 'string' }], rows: [] })).toMatch(/^Column names use letters, digits and underscores/);
    expect(await bad({ columns: [COLUMNS[0], COLUMNS[0]], rows: [] })).toBe('Two columns are named CODE. Give each its own name.');
    expect(await bad({ columns: COLUMNS, rows: [['14', 'fourteen', null, 'x']] })).toBe('Row 1, column DAYS is not a number.');
    expect(await bad({ columns: COLUMNS, rows: [['14', 14, '1.1.2026', 'x']] })).toBe('Row 1, column FROM is not a date, YYYY-MM-DD.');
    expect(await bad({ columns: COLUMNS, rows: [['14']] })).toBe('Row 1 has 1 cells, and the table has 4 columns.');
  });

  it('takes up to 10,000 rows and 50 columns', async () => {
    const wide = Array.from({ length: 51 }, (_, i) => ({ name: `C${i}`, type: 'string' }));
    expect((await (await create({ name: 'wide', columns: wide, rows: [] })).json()).error).toBe('A table has up to 50 columns.');
    const rows = Array.from({ length: 10_001 }, (_, i) => [String(i)]);
    expect((await (await create({ name: 'long', columns: [COLUMNS[0]], rows })).json()).error).toBe('A table has up to 10,000 rows.');
    expect((await create({ name: 'full', columns: [COLUMNS[0]], rows: rows.slice(1) })).status).toBe(201);
  });

  it('refuses a save over a newer revision', async () => {
    const table = await made();
    expect((await update(table.id, { revision: 1, rows: [] })).status).toBe(200);
    const stale = await update(table.id, { revision: 1, rows: ROWS });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe('Could not save: payment-terms changed since you opened it. Reload to see the changes.');
    expect(await (await get(table.id)).json()).toMatchObject({ revision: 2, rows: [] });
  });

  it('lists the jobs whose draft or any version reads a table, on the list and on the table', async () => {
    const table = await made();
    const other = await made('other');
    const serverId = await insertServer();
    const draftJob = await insertJob(serverId, { lookups: [termsLookup(table.id) as never] });
    const spec = { ...emptySpec({ serverId, library: 'MYLIB', queue: 'MYOUTQ' }), lookups: [termsLookup(table.id, 'TEXT')] };
    const [versionJob] = await db()
      .insert(jobs)
      .values({ name: 'Statements', draft: emptySpec({ serverId, library: 'MYLIB', queue: 'MYOUTQ' }), activeVersion: 1 })
      .returning();
    await db()
      .insert(jobVersions)
      .values({ jobId: versionJob!.id, number: 1, spec: spec as never });

    const listed = await list();
    expect(listed.find((t) => t.id === table.id)?.jobs.map((j) => j.name)).toEqual(['Invoices', 'Statements']);
    expect(listed.find((t) => t.id === other.id)?.jobs).toEqual([]);
    const shown = (await (await get(table.id)).json()) as LookupTableView;
    expect(shown.jobs).toEqual([
      expect.objectContaining({ id: draftJob, name: 'Invoices', mode: 'manual', paused: false }),
      expect.objectContaining({ id: versionJob!.id, name: 'Statements', activeVersion: 1 }),
    ]);
    expect([...(await lookupTableJobs(table.id)).keys()]).toEqual([table.id]);
    expect((await lookupTableJobs(other.id)).size).toBe(0);
  });

  it('downloads the table as UTF-8 CSV with a BOM, commas and decimal points', async () => {
    const table = await made();
    await update(table.id, { revision: 1, columns: [...COLUMNS, { name: 'RATE', type: 'number' }], rows: ROWS.map((row, i) => [...row, i === 0 ? 1.5 : null]) });
    const response = await csvRoute.GET(appRequest(`/api/lookup-tables/${table.id}/csv`, { headers: auth }), params({ id: table.id }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="payment-terms.csv"');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe(
      'CODE,DAYS,FROM,TEXT,RATE\r\n14,14,2026-01-01,Net 14 days,1.5\r\n30,30,,"Netto 30 päivää, ""pankki""",\r\n',
    );
  });

  it('refuses a request too large to save, and a cell longer than 1,000 characters', async () => {
    const big = appRequest('/api/lookup-tables', { method: 'POST', body: { name: 'big', columns: COLUMNS, rows: [] }, headers: { ...auth, 'content-length': String(21 * 1024 * 1024) } });
    const response = await listRoute.POST(big);
    expect(response.status).toBe(413);
    expect((await response.json()).error).toMatch(/^The table is too large to save: a save can be at most 20 MB\./);
    const long = await create({ name: 'long-cell', columns: [COLUMNS[0]], rows: [['x'.repeat(1001)]] });
    expect(long.status).toBe(400);
    expect((await long.json()).error).toBe('Row 1, column CODE holds more than 1,000 characters, the most a cell takes.');
  });

  it('answers a rename to a name taken meanwhile with 409, not a failure', async () => {
    const table = await made();
    await made('other');
    const renamed = await update(table.id, { revision: 1, name: 'other' });
    expect(renamed.status).toBe(409);
    expect((await renamed.json()).error).toBe('Could not rename: a table named other exists.');
  });

  it('needs a signed-in user', async () => {
    expect((await listRoute.GET(appRequest('/api/lookup-tables'))).status).toBe(401);
  });
});
