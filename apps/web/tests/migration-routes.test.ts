import { PGlite } from '@electric-sql/pglite';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobSpecSchema } from '@/lib/job-spec';

const migrations = fileURLToPath(new URL('../drizzle', import.meta.url));
/** The migration that turns a job's one destination into routes. */
const ROUTES = '0032_routes';

const IFS = '00000000-0000-4000-8000-0000000000a1';
const EMAIL = '00000000-0000-4000-8000-0000000000a2';
const WEBHOOK = '00000000-0000-4000-8000-0000000000a3';

const email = { to: '{d.pg.email}', cc: '', bcc: '', replyTo: '', subject: 'Invoice {d.pg.invoiceNo}', body: 'Hello', bodyTemplateId: null, attach: ['pdf'] };
const webhook = { attach: ['pdf', 'html'] };

/** A spec as it was saved before routes, with this destination part. */
function spec(destination: unknown): Record<string, unknown> {
  return {
    source: { serverId: null, library: 'MYLIB', queue: 'MYOUTQ', filter: { splf: '', userData: '', jobName: '', jobUser: '', formType: '' } },
    trigger: { mode: 'manual', backlog: false, includeHeld: false },
    extract: { definition: '' },
    lookups: [],
    render: { templates: [{ id: 'template-1', name: 'Template 1', kind: 'html', source: null, formats: ['pdf'] }] },
    ...(destination === undefined ? {} : { destination }),
    finish: { action: 'hold', queue: null },
    preview: { sampleId: null },
  };
}

const shapes: [string, unknown][] = [
  ['No destination', { destinationId: null, email: null, webhook: null }],
  ['IFS', { destinationId: IFS, email: null, webhook: null }],
  ['Email', { destinationId: EMAIL, email, webhook: null }],
  ['Webhook', { destinationId: WEBHOOK, email: null, webhook }],
  ['Kept email part', { destinationId: IFS, email, webhook: null }],
  ['Missing destination', undefined],
];

let client: PGlite;
let dir: string;

beforeAll(async () => {
  // Every migration before routes, then rows as they were written, then the rest.
  dir = mkdtempSync(join(tmpdir(), 'spooldoc-migrations-'));
  cpSync(migrations, dir, { recursive: true });
  const journalPath = join(dir, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  const at = journal.entries.findIndex((entry) => entry.tag === ROUTES);
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, at) }));
  client = new PGlite();
  await migrate(drizzle(client), { migrationsFolder: dir });

  for (const [name, destination] of shapes) {
    const [job] = (await client.query<{ id: string }>(`insert into jobs (name, draft) values ($1, $2) returning id`, [name, spec(destination)])).rows;
    await client.query(`insert into job_versions (job_id, number, spec) values ($1, 1, $2)`, [job!.id, spec(destination)]);
  }
  const [job] = (await client.query<{ id: string }>(`select id from jobs where name = 'Email'`)).rows;
  const [run] = (await client.query<{ id: string }>(`insert into runs (job_id, version, trigger, splf) values ($1, 1, 'manual', '{}') returning id`, [job!.id])).rows;
  await client.query(`insert into run_deliveries (run_id, job_id, splf_key, kind, document, status) values ($1, $2, 'key', 'email', 'invoice-1', 'sent')`, [run!.id, job!.id]);

  const full = join(dir, 'full');
  cpSync(migrations, full, { recursive: true });
  await migrate(drizzle(client), { migrationsFolder: full });
});

afterAll(async () => {
  await client.close();
  rmSync(dir, { recursive: true, force: true });
});

const destinationOf = async (table: 'draft' | 'version', name: string): Promise<unknown> => {
  const sql =
    table === 'draft'
      ? `select draft -> 'destination' as destination from jobs where name = $1`
      : `select v.spec -> 'destination' as destination from job_versions v join jobs j on j.id = v.job_id where j.name = $1`;
  return (await client.query<{ destination: unknown }>(sql, [name])).rows[0]!.destination;
};

describe('routes from one destination', () => {
  it('make one route with no conditions to the destination, with its email and webhook parts, in drafts and versions', async () => {
    for (const table of ['draft', 'version'] as const) {
      expect(await destinationOf(table, 'No destination'), table).toEqual({ routes: [{ when: [], destinations: [] }] });
      expect(await destinationOf(table, 'IFS'), table).toEqual({ routes: [{ when: [], destinations: [{ destinationId: IFS, email: null, webhook: null }] }] });
      expect(await destinationOf(table, 'Email'), table).toEqual({ routes: [{ when: [], destinations: [{ destinationId: EMAIL, email, webhook: null }] }] });
      expect(await destinationOf(table, 'Webhook'), table).toEqual({ routes: [{ when: [], destinations: [{ destinationId: WEBHOOK, email: null, webhook }] }] });
      expect(await destinationOf(table, 'Kept email part'), table).toEqual({ routes: [{ when: [], destinations: [{ destinationId: IFS, email, webhook: null }] }] });
      expect(await destinationOf(table, 'Missing destination'), table).toEqual({ routes: [{ when: [], destinations: [] }] });
    }
  });

  it('read every draft and version with the spec schema', async () => {
    const drafts = (await client.query<{ name: string; spec: unknown }>(`select name, draft as spec from jobs`)).rows;
    const versions = (await client.query<{ name: string; spec: unknown }>(`select j.name || ' v1' as name, v.spec from job_versions v join jobs j on j.id = v.job_id`)).rows;
    expect(drafts.length + versions.length).toBe(shapes.length * 2);
    for (const { name, spec: value } of [...drafts, ...versions]) expect(jobSpecSchema.safeParse(value).success, name).toBe(true);
  });

  it('leave versions unchangeable again', async () => {
    await expect(client.query(`update job_versions set note = 'changed'`)).rejects.toThrow();
  });

  it('leave the route of earlier deliveries empty', async () => {
    expect((await client.query<{ route: number | null }>(`select route from run_deliveries`)).rows).toEqual([{ route: null }]);
  });
});
