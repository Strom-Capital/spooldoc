import { PGlite } from '@electric-sql/pglite';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobSpecSchema } from '@/lib/job-spec';
import { renameTags } from '../scripts/rename-word-tags.mjs';

const migrations = fileURLToPath(new URL('../drizzle', import.meta.url));
const MIGRATION = '0018_short_template_tags';

/** A spec as jobs saved it before the shorter tags. */
const oldSpec = {
  extract: { definition: 'type: picklist\nversion: 1\nsource: xml\nxml:\n  pageGroup: FORM\n  fields:\n    no: FORM/NO\noutput:\n  name: "pick-{d.pageGroup.no}"\n' },
  render: {
    templates: [
      { id: 'main', name: 'Document', kind: 'docx', fileId: null, formats: ['pdf', 'docx'] },
      { id: 'print', name: 'Print', kind: 'html', source: '<p>{d.pageGroup.no} of {d.pageGroups:len} {d.pageGroups[i].no} {d.pageGroupX.no} on {d.splf.name}</p>', formats: ['pdf'] },
      { id: 'blank', name: 'Blank', kind: 'html', source: null, formats: ['html'] },
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

  await client.exec(readFileSync(join(migrations, `${MIGRATION}.sql`), 'utf8').replaceAll('--> statement-breakpoint', ''));
});

afterAll(async () => {
  await client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('migration to shorter tags', () => {
  it('renames the tags in drafts and versions, whole words only, and reads with the spec schema', async () => {
    for (const table of ['jobs', 'job_versions']) {
      const column = table === 'jobs' ? 'draft' : 'spec';
      const [row] = (await client.query<{ spec: unknown }>(`select ${column} as spec from ${table}`)).rows;
      const spec = jobSpecSchema.parse(row!.spec);
      expect(spec.render.templates).toEqual([
        { id: 'main', name: 'Document', kind: 'docx', fileId: null, formats: ['pdf', 'docx'] },
        { id: 'print', name: 'Print', kind: 'html', source: '<p>{d.pg.no} of {d.pgs:len} {d.pgs[i].no} {d.pageGroupX.no} on {d.splf.name}</p>', formats: ['pdf'] },
        { id: 'blank', name: 'Blank', kind: 'html', source: null, formats: ['html'] },
      ]);
      // The XML key stays; only the tags change.
      expect(spec.extract.definition).toContain('  pageGroup: FORM\n');
      expect(spec.extract.definition).toContain('name: "pick-{d.pg.no}"');
    }
  });

  it('keeps the chats and keeps versions unchangeable', async () => {
    expect((await client.query(`select * from job_chats`)).rows).toHaveLength(1);
    await expect(client.query(`update job_versions set note = 'x'`)).rejects.toThrow(/cannot be changed/);
  });
});

describe('renameTags for Word template files', () => {
  it('writes the old tags the new way', () => {
    expect(renameTags('{d.pageGroup.no} {d.pageGroups:len} {d.pageGroups[i].no}')).toBe('{d.pg.no} {d.pgs:len} {d.pgs[i].no}');
  });

  it('takes the oldest tags straight to the new names', () => {
    expect(renameTags('{d.doc.no} {d.documents[i].no} {d.sample.splf.name}')).toBe('{d.pg.no} {d.pgs[i].no} {d.splf.name}');
  });

  it('leaves other names and new tags as they are, so running it again changes nothing', () => {
    const text = '{d.pageGroupX.no} {d.docs.no} {d.doc-x} {d.pg.no} {d.pgs:len} {d.splf.name}';
    expect(renameTags(text)).toBe(text);
    const once = renameTags('{d.pageGroup.no} {d.documents:len}');
    expect(renameTags(once)).toBe(once);
  });
});
