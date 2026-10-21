import { PGlite } from '@electric-sql/pglite';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobSpecSchema } from '@/lib/job-spec';
import { signOnPaused } from '@/lib/server/servers';

const migrations = fileURLToPath(new URL('../drizzle', import.meta.url));
/** The first migration after the 0.2.0 release. */
const FIRST_AFTER = '0011_job_outputs';

const definition = [
  'type: invoice',
  'version: 1',
  'source: xml',
  'xml:',
  '  document: FORM',
  '  fields:',
  '    no: FORM/NO',
  '    document: FORM/DOCTYPE',
  '  groups:',
  '    lines:',
  '      path: LINE',
  '      map:',
  '        document: REF',
  'output:',
  '  name: "invoice-{{ no }}"',
  '',
].join('\n');

/** A spec as 0.2.0 saved it, with a render part of its own. */
function spec(render: unknown, definitionText = definition): Record<string, unknown> {
  return {
    source: { serverId: null, library: 'MYLIB', queue: 'MYOUTQ' },
    trigger: { mode: 'watch', backlog: false, includeHeld: false },
    extract: { definition: definitionText },
    render,
    destination: { destinationId: null },
    finish: { action: 'hold', queue: null },
    preview: { sampleId: null },
  };
}

/** The texts 0.2.0 wrote for a sign-on the IBM i refused, and some it wrote for other errors. */
const signOnErrors = [
  'ibmi.example.com did not accept the password for MYUSER. Check it on the Servers page; repeated wrong passwords can disable the profile. (CPF22E2)',
  'The user profile MYUSER is disabled on ibmi.example.com. A security officer can enable it with CHGUSRPRF USRPRF(MYUSER) STATUS(*ENABLED). (CPF22E3)',
  'The password of MYUSER has expired. Set a new one on the IBM i, then enter it for the server on the Servers page.',
  'MYUSER has no password (PASSWORD(*NONE)), so it cannot sign on. Use a user profile with a password.',
  'There is no user profile MYUSER on ibmi.example.com. Check the user on the Servers page.',
  'ibmi.example.com did not accept the user profile or password. Check them on the Servers page.',
];
const otherErrors = [
  'Cannot reach ibmi.example.com. Check the host name on the Servers page, the network, and that a firewall lets ports 449, 446, 8470 to 8476 through.',
  'MYUSER is not authorized to library MYLIB. A security officer can grant it with GRTOBJAUT OBJ(MYLIB) OBJTYPE(*LIB) USER(MYUSER) AUT(*USE).',
];

let client: PGlite;
let dir: string;

beforeAll(async () => {
  // The migrations 0.2.0 shipped, then rows as 0.2.0 wrote them, then every migration since.
  dir = mkdtempSync(join(tmpdir(), 'spooldoc-migrations-'));
  cpSync(migrations, dir, { recursive: true });
  const journalPath = join(dir, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  const at = journal.entries.findIndex((entry) => entry.tag === FIRST_AFTER);
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, at) }));
  client = new PGlite();
  await migrate(drizzle(client), { migrationsFolder: dir });

  const drafts: [string, unknown][] = [
    ['Formats', spec({ template: '<h1>Invoice {{ doc.no }}</h1>', formats: ['html', 'pdf'] })],
    ['Format', spec({ template: '<p>{{ doc.no }}</p>', format: 'pdf' })],
    ['Starter', spec({ template: null, formats: ['html'] })],
    ['Empty render', spec({})],
    ['No render', { extract: { definition: '' } }],
    ['Flow style', spec({ template: null, formats: ['pdf'] }, 'type: x\nversion: 1\nsource: xml\nxml: { document: FORM, fields: { no: FORM/NO } }\n')],
  ];
  const ids: string[] = [];
  for (const [name, draft] of drafts) {
    const [row] = (await client.query<{ id: string }>(`insert into jobs (name, draft) values ($1, $2) returning id`, [name, draft])).rows;
    ids.push(row!.id);
  }
  await client.query(`insert into job_versions (job_id, number, spec) values ($1, 1, $2)`, [ids[0], drafts[0]![1]]);
  await client.query(`insert into job_versions (job_id, number, spec) values ($1, 1, $2)`, [ids[1], drafts[1]![1]]);
  const [run] = (await client.query<{ id: string }>(`insert into runs (job_id, version, trigger, splf, documents) values ($1, 1, 'watch', '{}', 2) returning id`, [ids[0]])).rows;
  for (const index of [0, 1]) {
    await client.query(`insert into run_outputs (run_id, document_index, name, content_type, size, content) values ($1, $2, $3, 'application/pdf', 1, '\\x00')`, [run!.id, index, `invoice-${index}.pdf`]);
  }
  for (const [i, error] of [...signOnErrors, ...otherErrors, null].entries()) {
    await client.query(`insert into servers (name, host, "user", password_enc, last_checked_at, last_error) values ($1, 'ibmi.example.com', 'MYUSER', 'x', now(), $2)`, [`Server ${i}`, error]);
  }

  const full = join(dir, 'full');
  cpSync(migrations, full, { recursive: true });
  await migrate(drizzle(client), { migrationsFolder: full });
});

afterAll(async () => {
  await client.close();
  rmSync(dir, { recursive: true, force: true });
});

async function specs(): Promise<{ name: string; spec: unknown }[]> {
  const drafts = (await client.query<{ name: string; spec: unknown }>(`select name, draft as spec from jobs order by created_at, name`)).rows;
  const versions = (await client.query<{ name: string; spec: unknown }>(`select j.name || ' v1' as name, v.spec from job_versions v join jobs j on j.id = v.job_id`)).rows;
  return [...drafts, ...versions];
}

describe('upgrade from 0.2.0', () => {
  it('reads every draft and version with the spec schema', async () => {
    const all = await specs();
    expect(all).toHaveLength(8);
    for (const { name, spec } of all) {
      expect(jobSpecSchema.safeParse(spec).success, name).toBe(true);
    }
  });

  it('makes one HTML template of the 0.2.0 template and formats', async () => {
    const byName = new Map((await specs()).map(({ name, spec }) => [name, jobSpecSchema.parse(spec).render.templates]));
    const template = (source: string | null, formats: string[]) => [{ id: 'template-1', name: 'Template 1', kind: 'html', source, formats }];
    expect(byName.get('Formats')).toEqual(template('<h1>Invoice {{ doc.no }}</h1>', ['pdf', 'html']));
    expect(byName.get('Formats v1')).toEqual(template('<h1>Invoice {{ doc.no }}</h1>', ['pdf', 'html']));
    expect(byName.get('Format')).toEqual(template('<p>{{ doc.no }}</p>', ['pdf']));
    expect(byName.get('Format v1')).toEqual(template('<p>{{ doc.no }}</p>', ['pdf']));
    expect(byName.get('Starter')).toEqual(template(null, ['html']));
    expect(byName.get('Empty render')).toEqual(template(null, ['pdf']));
    expect(byName.get('No render')).toEqual(template(null, ['pdf']));
  });

  it('names the template as the files of earlier runs', async () => {
    expect((await client.query(`select template, template_index from run_files order by page_group_index`)).rows).toEqual([
      { template: 'Template 1', template_index: 0 },
      { template: 'Template 1', template_index: 0 },
    ]);
  });

  it('renames only the XML key under xml, not fields named document', async () => {
    const [row] = (await client.query<{ definition: string }>(`select draft->'extract'->>'definition' as definition from jobs where name = 'Formats'`)).rows;
    expect(row!.definition).toBe(definition.replace('  document: FORM', '  pageGroup: FORM'));
    const [flow] = (await client.query<{ definition: string }>(`select draft->'extract'->>'definition' as definition from jobs where name = 'Flow style'`)).rows;
    expect(flow!.definition).toContain('xml: { pageGroup: FORM, fields: { no: FORM/NO } }');
  });

  it('keeps versions unchangeable', async () => {
    await expect(client.query(`update job_versions set note = 'x'`)).rejects.toThrow(/cannot be changed/);
  });

  it('pauses sign-on to a server whose 0.2.0 sign-on failed, and only that', async () => {
    const rows = (await client.query<{ last_error: string | null; error_code: string | null; error_since: Date | null }>(`select last_error, error_code, error_since from servers`)).rows;
    for (const row of rows) {
      const signOn = row.last_error !== null && signOnErrors.includes(row.last_error);
      expect(signOnPaused({ errorCode: row.error_code as never }), row.last_error ?? 'no error').toBe(signOn);
      expect(row.error_since !== null).toBe(row.last_error !== null);
    }
  });
});
