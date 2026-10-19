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
const MIGRATION = '0016_page_groups_and_templates';

/** A spec as jobs saved it before page groups and templates. */
const oldSpec = {
  extract: { definition: 'type: picklist\nversion: 1\nsource: xml\nxml:\n  document: FORM\n  fields:\n    no: FORM/NO\noutput:\n  name: "pick-{d.doc.no}"\n' },
  render: {
    outputs: [
      { id: 'main', label: 'Document', template: { kind: 'docx', fileId: null }, formats: ['pdf', 'docx'] },
      { id: 'print', label: 'Print', template: { kind: 'html', source: '<p>{d.doc.no} of {d.documents[].no:aggCount} on {d.sample.splf.name}</p>' }, formats: ['pdf'] },
      { id: 'blank', label: 'Blank', template: { kind: 'html', source: null }, formats: ['html'] },
    ],
  },
};

let client: PGlite;
let dir: string;

beforeAll(async () => {
  // The migrations up to the one before, then old data, then this one.
  dir = mkdtempSync(join(tmpdir(), 'spooldoc-migrations-'));
  cpSync(migrations, dir, { recursive: true });
  const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  const at = journal.entries.findIndex((entry) => entry.tag === MIGRATION);
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.slice(0, at) }));
  client = new PGlite();
  await migrate(drizzle(client), { migrationsFolder: dir });

  const [job] = (await client.query<{ id: string }>(`insert into jobs (name, draft) values ('Pick lists', $1) returning id`, [oldSpec])).rows;
  await client.query(`insert into job_versions (job_id, number, spec) values ($1, 1, $2)`, [job!.id, oldSpec]);
  await client.query(`insert into job_chats (job_id, messages) values ($1, '[]')`, [job!.id]);
  const [run] = (await client.query<{ id: string }>(`insert into runs (job_id, version, trigger, splf, documents, steps) values ($1, 1, 'manual', '{}', 5, $2) returning id`, [job!.id, JSON.stringify([{ step: 'capture', ok: true, ms: 1, note: '5 pages' }, { step: 'extract', ok: true, ms: 1, note: '5 documents' }, { step: 'render', ok: true, ms: 1, note: '5 PDFs' }])])).rows;
  await client.query(`insert into run_outputs (run_id, document_index, output, output_index, name, content_type, size, content) values ($1, 0, null, 0, 'a.pdf', 'application/pdf', 1, '\\x00')`, [run!.id]);

  await client.exec(readFileSync(join(migrations, `${MIGRATION}.sql`), 'utf8').replaceAll('--> statement-breakpoint', ''));
});

afterAll(async () => {
  await client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('migration to page groups and templates', () => {
  it('turns outputs into flat templates, renames the tags and reads with the spec schema', async () => {
    for (const table of ['jobs', 'job_versions']) {
      const column = table === 'jobs' ? 'draft' : 'spec';
      const [row] = (await client.query<{ spec: unknown }>(`select ${column} as spec from ${table}`)).rows;
      const spec = jobSpecSchema.parse(row!.spec);
      expect(spec.render.templates).toEqual([
        { id: 'main', name: 'Document', kind: 'docx', fileId: null, formats: ['pdf', 'docx'] },
        { id: 'print', name: 'Print', kind: 'html', source: '<p>{d.pageGroup.no} of {d.pageGroups[].no:aggCount} on {d.splf.name}</p>', formats: ['pdf'] },
        { id: 'blank', name: 'Blank', kind: 'html', source: null, formats: ['html'] },
      ]);
      expect(spec.extract.definition).toContain('  pageGroup: FORM\n');
      expect(spec.extract.definition).toContain('name: "pick-{d.pageGroup.no}"');
    }
  });

  it('renames the run files and counts, clears the chats and keeps versions unchangeable', async () => {
    expect((await client.query(`select template, template_index, page_group_index from run_files`)).rows).toEqual([{ template: 'Template 1', template_index: 0, page_group_index: 0 }]);
    expect((await client.query(`select page_groups from runs`)).rows).toEqual([{ page_groups: 5 }]);
    const [run] = (await client.query<{ steps: { step: string; note: string }[] }>(`select steps from runs`)).rows;
    expect(run!.steps.map((s) => s.note)).toEqual(['5 pages', '5 page groups', '5 PDFs']);
    expect((await client.query(`select * from job_chats`)).rows).toEqual([]);
    await expect(client.query(`update job_versions set note = 'x'`)).rejects.toThrow(/cannot be changed/);
  });
});
