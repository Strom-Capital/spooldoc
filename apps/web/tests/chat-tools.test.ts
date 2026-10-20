import { extract, parseDefinition, readDocx, starterDocx, starterXlsx, type HtmlRender } from '@spooldoc/core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type {
  AskUserResult,
  JobTemplateFiles,
  ListJobsResult,
  TemplateChangeResult,
  ReadJobFilesResult,
  ReadPageResult,
  ReadWordTemplateResult,
  RenderPreviewResult,
  WordTemplateResult,
  WriteDefinitionResult,
  WriteTemplateResult,
} from '@/lib/chat-types';
import { jobSpecSchema, withContent, type JobTemplate } from '@/lib/job-spec';
import { ASK_USER_TOOL, buildTools, optionsProblem, visibleText, type DraftStore, type JobFiles, type JobFilesReader } from '@/lib/server/chat';
import type { DocumentRenderer } from '@/lib/server/documents';
import type { TemplateFileView } from '@/lib/types';
import { fakeCarbone, fakeRenderer, PDF_BYTES, PNG_BYTES, sentPageGroup } from './helpers/carbone';
import { fixtureText, loadSample } from './helpers/fake-connection';

const sample = loadSample('invoice');
const yaml = fixtureText('invoice', 'definition.yaml');
const template = fixtureText('invoice', 'template.html');
const options = { toolCallId: 'call-1', messages: [] };
/** A 40 x 10 PNG header, enough for the docx library to place. */
const PNG_LOGO = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAAKCAIAAABaL8vzAAAAEklEQVR4nGM4ceIEAAS0AlkWLoFAAAAAAElFTkSuQmCC', 'base64'));

/** A job draft in memory: a definition and templates, checked by the spec schema as the draft store does. */
/** A template's HTML; undefined for a Word template. */
const htmlOf = (template: JobTemplate): string | null | undefined => (template.kind === 'html' ? template.source : undefined);

class MemoryDraft implements DraftStore {
  yaml = '';
  templates: JobTemplate[] = jobSpecSchema.parse({}).render.templates;
  /** The first template's HTML. */
  get html(): string | null | undefined {
    return htmlOf(this.templates[0]!);
  }
  async readDefinition() {
    return this.yaml;
  }
  async readTemplates() {
    return this.templates;
  }
  async writeDefinition(yaml: string) {
    this.yaml = yaml;
  }
  async writeHtml(templateId: string, html: string) {
    await this.changeTemplates((templates) => templates.map((t) => (t.id === templateId ? withContent(t, { kind: 'html', source: html }) : t)));
  }
  async changeTemplates(change: (templates: JobTemplate[]) => JobTemplate[]) {
    this.templates = jobSpecSchema.shape.render.parse({ templates: change(this.templates) }).templates;
    return this.templates;
  }
  /** The Word files the agent saved, by id, as the database would keep them. */
  files = new Map<string, { name: string; content: Uint8Array; previousId: string | null }>();
  async writeWordTemplate(templateId: string, file: { name: string; content: Uint8Array; previousId: string | null }): Promise<TemplateFileView> {
    const template = this.templates.find((t) => t.id === templateId);
    if (!template) throw new Error('The template is gone.');
    if (template.kind === 'html' && template.source !== null) throw new Error(`The ${template.name} template has HTML of its own.`);
    const id = `00000000-0000-4000-8000-${String(this.files.size + 1).padStart(12, '0')}`;
    this.files.set(id, file);
    await this.changeTemplates((templates) => templates.map((t) => (t.id === templateId ? withContent(t, { kind: 'docx', fileId: id }) : t)));
    return { id, name: file.name, size: file.content.length, createdAt: new Date(0).toISOString(), madeBy: 'assistant', previousId: file.previousId };
  }
  /** Reads a file the agent saved, as the chat route's `templateFile` does. */
  readFile = async (id: string) => this.files.get(id) ?? null;
}

let store: MemoryDraft;

beforeEach(() => {
  store = new MemoryDraft();
});

/** A template of another job. */
const files = (html: string | null, fields: Partial<JobTemplateFiles> = {}): JobTemplateFiles => ({
  id: 'main',
  name: 'Document',
  formats: ['pdf'],
  kind: 'html',
  html,
  fileId: null,
  ...fields,
});

/** Two other jobs: one with a definition and two templates, one with only a draft definition. */
const OTHER_JOBS: JobFiles[] = [
  { id: 'job-a', name: 'Invoices', definitionYaml: yaml, templates: [files(template), files(null, { id: 'lines', name: 'Lines', formats: ['html'] })] },
  {
    id: 'job-b',
    name: 'Reminders',
    definitionYaml: 'type: reminder\nversion: 1\nsource: text\ntext:\n  page: { width: 132, length: 66 }\n  fields: []\n',
    templates: [files(null)],
  },
];

/** The other jobs' files in memory, as the chat route's reader hands them over. */
class MemoryJobs implements JobFilesReader {
  readonly reads: string[] = [];
  constructor(private readonly jobs: JobFiles[] = OTHER_JOBS) {}
  async list() {
    return this.jobs;
  }
  async read(id: string) {
    this.reads.push(id);
    return this.jobs.find((job) => job.id === id) ?? null;
  }
}

const tools = (masked = false, jobs?: JobFilesReader, renderer: DocumentRenderer | null = fakeRenderer) => buildTools({ sample, store, masked, jobs, renderer });

async function call<T>(t: { execute?: (input: never, opts: never) => unknown }, input: unknown): Promise<T> {
  return (await t.execute?.(input as never, options as never)) as T;
}

describe('write_definition', () => {
  it("saves the definition to the job's draft and reports the extraction", async () => {
    const result = await call<WriteDefinitionResult>(tools().write_definition, { yaml });
    if (!result.ok) throw new Error(result.error);

    expect(result.type).toBe('invoice');
    expect(result.path).toBe('definition');
    expect(result.pageGroups).toBe(6);
    expect(result.missing).toEqual([]);
    expect(result.fields.find((f) => f.name === 'invoiceNo')).toEqual({ name: 'invoiceNo', status: 'found', value: '260101' });
    expect(result.fields.find((f) => f.name === 'lines')?.value).toMatch(/^\d+ rows$/);
    expect(result.preview).toContain('"invoiceNo": "260101"');
    expect(result.preview.length).toBeLessThanOrEqual(2000 + 20);
    expect(store.yaml).toBe(yaml);
  });

  it('returns ok: false with the message for invalid YAML and writes nothing', async () => {
    const result = await call<WriteDefinitionResult>(tools().write_definition, { yaml: 'type: invoice\nversion: [1\n' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/YAML/);

    const schema = await call<WriteDefinitionResult>(tools().write_definition, { yaml: 'type: invoice\nversion: 1\nsource: text\n' });
    expect(!schema.ok && schema.error).toMatch(/needs a `text` section/);
    expect(store.yaml).toBe('');
  });

  it('says what an old tag in the file name is now called, and writes nothing', async () => {
    const result = await call<WriteDefinitionResult>(tools().write_definition, { yaml: yaml.replace('{d.pg.invoiceNo}', '{d.pageGroup.invoiceNo}') });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('d.pageGroup is now d.pg. Write {d.pg.invoiceNo} instead of {d.pageGroup.invoiceNo}.');
    expect(store.yaml).toBe('');
  });

  it('masks the values it reports when masking is on', async () => {
    const result = await call<WriteDefinitionResult>(tools(true).write_definition, { yaml });
    if (!result.ok) throw new Error(result.error);
    expect(result.fields.find((f) => f.name === 'invoiceNo')?.value).toBe('999999');
    expect(result.preview).not.toContain('260101');
    expect(result.pageGroups).toBe(6);
  });
});

describe('write_template', () => {
  it('refuses before the job has a definition', async () => {
    const result = await call<WriteTemplateResult>(tools().write_template, { html: template });
    expect(result.ok).toBe(false);
    expect('error' in result && result.error).toMatch(/write_definition first/);
    expect(store.html).toBeNull();
  });

  it('saves the template and returns the visible text of the first document', async () => {
    await call(tools().write_definition, { yaml });
    const result = await call<WriteTemplateResult>(tools().write_template, { html: template });
    if (!('path' in result)) throw new Error(result.error);

    expect(result.ok).toBe(true);
    expect(result.path).toBe('template');
    expect(result.template).toBe('Template 1');
    expect(result.templateId).toBe('template-1');
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.textPreview).toContain('260101');
    expect(result.textPreview).not.toMatch(/<[a-z]/i);
    expect(result.textPreview.length).toBeLessThanOrEqual(1500 + 20);
    expect(store.html).toBe(template);
  });

  it('saves the template named by id or name, and fails for an unknown template', async () => {
    await call(tools().write_definition, { yaml });
    await call(tools().add_template, { name: 'Lines' });
    const byName = await call<WriteTemplateResult>(tools().write_template, { html: '<p>{d.pg.invoiceNo}</p>', template: 'lines' });
    if (!('path' in byName)) throw new Error(byName.error);
    expect(byName.template).toBe('Lines');
    expect(store.templates.map(htmlOf)).toEqual([null, '<p>{d.pg.invoiceNo}</p>']);

    const unknown = await call<WriteTemplateResult>(tools().write_template, { html: '<p/>', template: 'Totals' });
    expect(unknown).toEqual({ ok: false, error: 'There is no template "Totals". The job\'s templates are Template 1 (id template-1), Lines (id lines).' });
    expect(htmlOf(store.templates[1]!)).toBe('<p>{d.pg.invoiceNo}</p>');
  });

  it('checks the template by line before it renders', async () => {
    await call(tools().write_definition, { yaml });
    const result = await call<WriteTemplateResult>(tools().write_template, { html: '<p>\n{d.pg.invoiceNumber}</p>' });
    if (!('path' in result)) throw new Error(result.error);
    expect(result.errors).toEqual(['Line 2: {d.pg.invoiceNumber} is not in the data. Did you mean {d.pg.invoiceNo}?']);
    expect(fakeCarbone).not.toHaveBeenCalled();
  });

  it('says what an old tag is now called, so the agent can fix one copied from an older chat', async () => {
    await call(tools().write_definition, { yaml });
    const result = await call<WriteTemplateResult>(tools().write_template, { html: '<p>{d.pageGroup.invoiceNo} of {d.pageGroups:len}</p>' });
    if (!('path' in result)) throw new Error(result.error);
    expect(result.errors).toEqual([
      'Line 1: d.pageGroup is now d.pg. Write {d.pg.invoiceNo} instead of {d.pageGroup.invoiceNo}.',
      'Line 1: d.pageGroups is now d.pgs. Write {d.pgs:len} instead of {d.pageGroups:len}.',
    ]);
    expect(fakeCarbone).not.toHaveBeenCalled();
  });

  it('only checks the template when Carbone is not connected', async () => {
    await call(tools().write_definition, { yaml });
    const result = await call<WriteTemplateResult>(tools(false, undefined, null).write_template, { html: template });
    if (!('path' in result)) throw new Error(result.error);
    expect(result.errors).toEqual(['Carbone is not connected, so the template was checked but not rendered. The user sets it up in Settings, under Rendering.']);
    expect(store.html).toBe(template);
  });

  it('renders with placeholders for assets, never the file', async () => {
    await call(tools().write_definition, { yaml });
    const withLogo = buildTools({ sample, store, masked: false, renderer: fakeRenderer, assets: [{ name: 'logo', kind: 'image' }] });
    await call(withLogo.write_template, { html: `<img src="{asset('logo')}">{d.pg.invoiceNo}` });
    expect((fakeCarbone.mock.calls[0]![0] as HtmlRender).asset?.('logo')).toBe('data:,');
  });

  it('reports template errors and warns about scripts and external resources', async () => {
    await call(tools().write_definition, { yaml });
    const result = await call<WriteTemplateResult>(tools().write_template, {
      html: '<link href="https://cdn.example.com/x.css"><script>1</script>{% if %}',
    });
    if (!('path' in result)) throw new Error(result.error);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.warnings).toHaveLength(2);
  });
});

describe('read_sample_page', () => {
  it('returns numbered lines in clear when masking is off', async () => {
    const result = await call<ReadPageResult>(tools(false).read_sample_page, { page: 1 });
    if ('ok' in result) throw new Error(result.error);
    expect(result.page).toBe(1);
    expect(result.of).toBe(sample.pages.length);
    expect(result.lines).toMatch(/^ {2}1: /);
    expect(result.lines).toContain('260101');
  });

  it('masks the digits of values when masking is on', async () => {
    const result = await call<ReadPageResult>(tools(true).read_sample_page, { page: 1 });
    if ('ok' in result) throw new Error(result.error);
    expect(result.lines).not.toContain('260101');
    expect(result.lines).toContain('999999');
    expect(result.lines).toContain('Invoice no');
  });

  it('answers a bad page number with an error text', async () => {
    const result = await call<ReadPageResult>(tools().read_sample_page, { page: 99 });
    expect(result).toEqual({ ok: false, error: `There is no page 99: the sample has pages 1 to ${sample.pages.length}.` });
  });
});

describe('render_preview', () => {
  it('needs a definition', async () => {
    const result = await call<RenderPreviewResult>(tools().render_preview, {});
    expect(result.ok).toBe(false);
  });

  it('counts the same hits as extract', async () => {
    await call(tools().write_definition, { yaml });
    await call(tools().write_template, { html: template });
    const result = await call<RenderPreviewResult>(tools().render_preview, { pageGroup: 1 });
    if (!result.ok) throw new Error(result.error);

    const expected = extract(parseDefinition(yaml), sample);
    const count = (status: string) => expected.hits.filter((hit) => hit.status === status).length;
    expect(result.pageGroups).toBe(expected.pageGroups.length);
    expect(result.hits).toEqual({ found: count('found'), missing: count('missing'), empty: count('empty') });
    expect(result.pageGroup).toBe(1);
    expect(result.template).toBe('Template 1');
    expect(result.content).toBe('saved');
    expect(result.templateErrors).toEqual([]);
    expect(result.textPreview).toContain('MÄKELÄ RAKENNUS OY');
  });

  it('uses the starter template when none is saved, and clamps the page group index', async () => {
    await call(tools().write_definition, { yaml });
    const result = await call<RenderPreviewResult>(tools().render_preview, { pageGroup: 50 });
    if (!result.ok) throw new Error(result.error);
    expect(result.content).toBe('starter');
    expect(result.pageGroup).toBe(5);
  });

  it('renders the template named', async () => {
    await call(tools().write_definition, { yaml });
    await call(tools().write_template, { html: template });
    await call(tools().add_template, { name: 'Lines' });
    await call(tools().write_template, { html: '<p>Lines of {d.pg.invoiceNo}</p>', template: 'Lines' });

    const lines = await call<RenderPreviewResult>(tools().render_preview, { template: 'lines' });
    if (!lines.ok) throw new Error(lines.error);
    expect(lines).toMatchObject({ template: 'Lines', content: 'saved', textPreview: 'Lines of 260101' });
    const first = await call<RenderPreviewResult>(tools().render_preview, {});
    if (!first.ok) throw new Error(first.error);
    expect(first.template).toBe('Template 1');
    expect(first.textPreview).not.toContain('Lines of');
    expect((await call<RenderPreviewResult>(tools().render_preview, { template: 'nope' })).ok).toBe(false);
  });
});

describe('add_template and remove_template', () => {
  it('adds a template with the starter and the formats asked for', async () => {
    const result = await call<TemplateChangeResult>(tools().add_template, { name: 'Order lines', formats: ['html', 'pdf'] });
    expect(result).toEqual({
      ok: true,
      template: { id: 'order-lines', name: 'Order lines', formats: ['pdf', 'html'], kind: 'html', content: 'starter' },
      templates: [
        { id: 'template-1', name: 'Template 1', formats: ['pdf'], kind: 'html', content: 'starter' },
        { id: 'order-lines', name: 'Order lines', formats: ['pdf', 'html'], kind: 'html', content: 'starter' },
      ],
    });
    expect(store.templates).toHaveLength(2);
    expect((await call<TemplateChangeResult>(tools().add_template, { name: 'Totals' })).ok && store.templates[2]!.formats).toEqual(['pdf']);
  });

  it('refuses a name another template has', async () => {
    const result = await call<TemplateChangeResult>(tools().add_template, { name: 'template 1' });
    expect(result).toEqual({ ok: false, error: 'There is already a template named "template 1". Pick another name.' });
    expect(store.templates).toHaveLength(1);
  });

  it('removes a template by id or name, but never the last one', async () => {
    await call(tools().add_template, { name: 'Lines' });
    const removed = await call<TemplateChangeResult>(tools().remove_template, { template: 'Template 1' });
    if (!removed.ok) throw new Error(removed.error);
    expect(removed.template.name).toBe('Template 1');
    expect(store.templates.map((o) => o.id)).toEqual(['lines']);

    expect(await call<TemplateChangeResult>(tools().remove_template, { template: 'lines' })).toEqual({
      ok: false,
      error: 'A job needs at least one template, so the last one cannot be removed.',
    });
    expect(await call<TemplateChangeResult>(tools().remove_template, { template: 'nope' })).toEqual({
      ok: false,
      error: 'There is no template "nope". The job\'s templates are Lines (id lines).',
    });
    expect(store.templates.map((o) => o.id)).toEqual(['lines']);
  });
});

describe('visibleText', () => {
  it('drops head, styles and tags and decodes entities', () => {
    const text = visibleText(
      '<html><head><title>T</title><style>p{}</style></head><body><h1>A &amp; B</h1><table><tr><td>1</td><td>2</td></tr></table></body></html>',
    );
    expect(text).toBe('A & B\n1 | 2');
  });
});

describe('list_jobs', () => {
  it('lists every other job with its definition type, templates and whether they have content of their own', async () => {
    const result = await call<ListJobsResult>(tools(false, new MemoryJobs()).list_jobs, {});
    expect(result).toEqual({
      ok: true,
      jobs: [
        { id: 'job-a', name: 'Invoices', type: 'invoice', templates: ['Document', 'Lines'], hasOwnContent: true },
        { id: 'job-b', name: 'Reminders', type: 'reminder', templates: ['Document'], hasOwnContent: false },
      ],
    });
  });

  it('reports no type for a job whose definition is empty or does not parse, and nothing else of a job', async () => {
    const reader = new MemoryJobs([{ id: 'job-c', name: 'Blank', definitionYaml: '', templates: [files(null)] }]);
    const result = await call<ListJobsResult>(tools(false, reader).list_jobs, {});
    if (!result.ok) throw new Error(result.error);
    expect(result.jobs).toEqual([{ id: 'job-c', name: 'Blank', type: null, templates: ['Document'], hasOwnContent: false }]);
    expect(Object.keys(result.jobs[0]!).sort()).toEqual(['hasOwnContent', 'id', 'name', 'templates', 'type']);
  });

  it('lists no jobs without a reader, and reports a reader that fails', async () => {
    expect(await call<ListJobsResult>(tools().list_jobs, {})).toEqual({ ok: true, jobs: [] });
    const broken: JobFilesReader = {
      list: async () => {
        throw new Error('database gone');
      },
      read: async () => null,
    };
    const result = await call<ListJobsResult>(tools(false, broken).list_jobs, {});
    expect(result).toEqual({ ok: false, error: 'Could not list the jobs: database gone' });
  });
});

describe('read_job_files', () => {
  it("returns a job's definition and every template, and only those", async () => {
    const reader = new MemoryJobs();
    const result = await call<ReadJobFilesResult>(tools(false, reader).read_job_files, { id: 'job-a' });
    expect(result).toEqual({
      ok: true,
      id: 'job-a',
      name: 'Invoices',
      definitionYaml: yaml,
      templates: [files(template), files(null, { id: 'lines', name: 'Lines', formats: ['html'] })],
    });
    expect(reader.reads).toEqual(['job-a']);
  });

  it('answers null for a missing template or definition', async () => {
    const result = await call<ReadJobFilesResult>(tools(false, new MemoryJobs()).read_job_files, { id: 'job-b' });
    if (!result.ok) throw new Error(result.error);
    expect(result.templates[0]!.html).toBeNull();
    expect(result.definitionYaml).toContain('type: reminder');

    const blank = new MemoryJobs([{ id: 'job-c', name: 'Blank', definitionYaml: '  \n', templates: [files(null)] }]);
    const empty = await call<ReadJobFilesResult>(tools(false, blank).read_job_files, { id: 'job-c' });
    expect(empty).toEqual({ ok: true, id: 'job-c', name: 'Blank', definitionYaml: null, templates: [files(null)] });
  });

  it('fails for an unknown job and without a reader, and writes nothing', async () => {
    const unknown = await call<ReadJobFilesResult>(tools(false, new MemoryJobs()).read_job_files, { id: 'nope' });
    expect(unknown).toEqual({ ok: false, error: 'There is no job nope. Find the id with list_jobs.' });
    const none = await call<ReadJobFilesResult>(tools().read_job_files, { id: 'job-a' });
    expect(none).toEqual({ ok: false, error: 'There are no other jobs to read.' });
    expect(store.yaml).toBe('');
    expect(store.html).toBeNull();
  });
});

describe('Word templates', () => {
  const wordTemplate = (fileId: string | null): JobTemplate[] => [{ id: 'main', name: 'Document', kind: 'docx', fileId, formats: ['pdf', 'docx'] }];
  const withFile = (bytes: Uint8Array | null) =>
    buildTools({ sample, store, masked: false, renderer: fakeRenderer, templateFile: async (id) => (id === 'file-1' && bytes ? { name: 'invoice.docx', content: bytes } : null) });

  it('never writes over a Word template', async () => {
    await call(tools().write_definition, { yaml });
    store.templates = wordTemplate(null);
    const result = await call<WriteTemplateResult>(tools().write_template, { html: '<p>{d.pg.invoiceNo}</p>' });
    expect(result).toEqual({
      ok: false,
      error: 'The Document template is a Word template. Change it with edit_word_template, or design a new one with write_word_template.',
    });
    expect(store.templates[0]).toMatchObject({ kind: 'docx', fileId: null });
  });

  it('checks and renders the uploaded file, or the starter template, to DOCX and returns its text', async () => {
    await call(tools().write_definition, { yaml });
    store.templates = wordTemplate('00000000-0000-4000-8000-000000000001');
    const bytes = await starterDocx(parseDefinition(yaml));
    const reader = buildTools({ sample, store, masked: false, renderer: fakeRenderer, templateFile: async () => ({ name: 'invoice.docx', content: bytes }) });
    const result = await call<RenderPreviewResult>(reader.render_preview, {});
    if (!result.ok) throw new Error(result.error);
    expect(result).toMatchObject({ content: 'saved', templateErrors: [] });
    // The fake Carbone sends the file back as it was: its paragraphs are the text.
    expect(result.textPreview).toContain('Invoice No\t{d.pg.invoiceNo}');
    expect(fakeCarbone.mock.calls.at(-1)![0]).toMatchObject({ kind: 'docx', format: 'docx' });

    store.templates = wordTemplate(null);
    const starter = await call<RenderPreviewResult>(withFile(null).render_preview, {});
    expect(starter).toMatchObject({ ok: true, content: 'starter', templateErrors: [] });
  });

  it('reports the tag check by part, and a file that is gone', async () => {
    await call(tools().write_definition, { yaml });
    store.templates = wordTemplate('file-1');
    const bad = await starterDocx(parseDefinition(yaml.replace('name: invoiceNo,', 'name: invoiceNumber,').replace('field: invoiceNo }', 'field: invoiceNumber }')));
    const result = await call<RenderPreviewResult>(withFile(bad).render_preview, {});
    expect(result).toMatchObject({ ok: true, templateErrors: ['body: {d.pg.invoiceNumber} is not in the data. Did you mean {d.pg.invoiceNo}?'] });
    expect(await call(withFile(null).render_preview, {})).toEqual({
      ok: false,
      error: 'The Word file of the Document template is gone. Write a new one with write_word_template, or the user uploads one.',
    });
  });
});

describe('Word templates by the agent', () => {
  /** A small design: a title, the invoice number, and the lines as a loop. */
  const design = {
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [
      {
        footers: { default: { children: [{ type: 'Paragraph', children: [{ type: 'TextRun', text: 'Page ' }, { type: 'PageNumber', field: 'PAGE' }] }] } },
        children: [
          { type: 'Paragraph', children: [{ type: 'TextRun', text: 'Invoice {d.pg.invoiceNo}', bold: true, size: '18pt' }] },
          {
            type: 'Table',
            rows: [
              { type: 'TableRow', children: [{ type: 'TableCell', children: [{ type: 'Paragraph', text: '{d.pg.lines[i].item}' }] }] },
              { type: 'TableRow', children: [{ type: 'TableCell', children: [{ type: 'Paragraph', text: '{d.pg.lines[i+1]}' }] }] },
            ],
          },
        ],
      },
    ],
  };
  const wordTemplate = (fileId: string | null): JobTemplate[] => [{ id: 'main', name: 'Document', kind: 'docx', fileId, formats: ['pdf', 'docx'] }];
  const word = (input: Partial<Parameters<typeof buildTools>[0]> = {}) =>
    buildTools({ sample, store, masked: false, renderer: fakeRenderer, templateFile: store.readFile, ...input });
  const modelOutput = (t: { toModelOutput?: unknown }, output: unknown, toolCallId = options.toolCallId) =>
    (t.toModelOutput as (o: { toolCallId: string; input: unknown; output: unknown }) => unknown)({ toolCallId, input: {}, output });

  beforeEach(async () => {
    await call(tools().write_definition, { yaml });
  });

  it('designs a template, saves it as a new file the template uses and reports its text', async () => {
    const result = await call<WordTemplateResult>(word().write_word_template, { design });
    if (!('file' in result)) throw new Error(result.error);
    expect(result).toMatchObject({ ok: true, template: 'Template 1', templateId: 'template-1', errors: [], view: null, pages: null, file: { name: 'invoice.docx' } });
    expect(result.textPreview).toContain('Invoice {d.pg.invoiceNo}');
    // The HTML starter template became a Word one.
    expect(store.templates[0]).toMatchObject({ kind: 'docx', fileId: result.file.id, formats: ['pdf'] });
    const saved = store.files.get(result.file.id)!;
    expect(saved.previousId).toBeNull();
    expect(readDocx(saved.content).fields).toEqual(['PAGE']);
  });

  it('shows the model every page as a PDF, once, in the step after the call', async () => {
    const tools = word({ visual: true });
    const result = await call<WordTemplateResult>(tools.write_word_template, { design });
    expect(result).toMatchObject({ ok: true, view: 'pdf', pages: 1 });
    expect(fakeCarbone.mock.calls.at(-1)![0]).toMatchObject({ kind: 'docx', format: 'pdf' });
    const shown = modelOutput(tools.write_word_template, result) as { type: string; value: { type: string; mediaType?: string; data?: { data: Uint8Array } }[] };
    expect(shown.type).toBe('content');
    expect(JSON.parse((shown.value[0] as unknown as { text: string }).text)).toEqual(result);
    expect(shown.value[1]).toMatchObject({ type: 'file', mediaType: 'application/pdf', data: { type: 'data', data: PDF_BYTES } });
    // A later request has the result's text only.
    expect(modelOutput(word({ visual: true }).write_word_template, result)).toEqual({ type: 'json', value: result });
    expect(modelOutput(tools.write_word_template, result, 'another-call')).toEqual({ type: 'json', value: result });
  });

  it('shows page 1 as a PNG when the document has more pages than a preview takes', async () => {
    const long = new TextEncoder().encode('%PDF-1.7 << /Type /Pages /Count 9 >>');
    const renderer: DocumentRenderer = async (input) => (input.format === 'pdf' ? long : fakeRenderer(input));
    const tools = word({ visual: true, renderer });
    const result = await call<WordTemplateResult>(tools.write_word_template, { design });
    expect(result).toMatchObject({
      ok: true,
      view: 'png',
      pages: 9,
      note: 'The document of page group 1 has 9 pages, so you see page 1 only. To check the later pages, render a page group with fewer pages (render_preview with pageGroup).',
    });
    const shown = modelOutput(tools.write_word_template, result) as { value: unknown[] };
    expect(shown.value[1]).toMatchObject({ type: 'file', mediaType: 'image/png', data: { type: 'data', data: PNG_BYTES } });
  });

  it('renders the preview with masked values when masking is on', async () => {
    await call(word({ visual: true, masked: true }).write_word_template, { design });
    const pdf = fakeCarbone.mock.calls.findLast(([input]) => input.format === 'pdf')![0];
    expect(sentPageGroup(pdf)?.invoiceNo).toMatch(/^9+$/);
  });

  it('places uploaded images and refuses a design with problems, saving nothing', async () => {
    const images = async () => new Map([['logo', { data: PNG_LOGO, type: 'png' as const, width: 40, height: 10 }]]);
    const withLogo = { ...design, sections: [{ children: [{ type: 'Paragraph', children: [{ type: 'ImageRun', asset: 'logo', width: 120 }] }] }] };
    const result = await call<WordTemplateResult>(word({ images }).write_word_template, { design: withLogo, name: 'Lasku' });
    if (!('file' in result)) throw new Error(result.error);
    expect(result.file.name).toBe('Lasku.docx');
    const bad = await call<WordTemplateResult>(word({ images }).write_word_template, {
      design: { sections: [{ children: [{ type: 'Paragraph', children: [{ type: 'ImageRun', asset: 'missing' }] }, { type: 'Script' }] }] },
    });
    expect(bad).toEqual({
      ok: false,
      error:
        'The design has problems, nothing was saved:\nsections[0].children[0].children[0].asset: There is no PNG or JPEG asset "missing". Use one of the uploaded image assets.\nsections[0].children[1]: "Script" is not allowed here. Use "Paragraph", "Table".',
    });
    expect(store.files.size).toBe(1);
  });

  it("keeps the file it replaces as the new file's previous one, and its name", async () => {
    store.templates = wordTemplate(null);
    const first = await call<WordTemplateResult>(word().write_word_template, { design, name: 'sales.docx' });
    const second = await call<WordTemplateResult>(word().write_word_template, { design });
    if (!('file' in first) || !('file' in second)) throw new Error('not saved');
    expect(second.file.name).toBe('sales.docx');
    expect(store.files.get(second.file.id)!.previousId).toBe(first.file.id);
    expect(store.templates[0]).toMatchObject({ kind: 'docx', fileId: second.file.id });
  });

  it('does not replace the HTML of an HTML template', async () => {
    await call(tools().write_template, { html: template });
    const result = await call<WordTemplateResult>(word().write_word_template, { design });
    expect(result).toEqual({ ok: false, error: 'Could not save the Word template: The Template 1 template has HTML of its own.' });
    expect(store.html).toBe(template);
  });

  it('reads the parts of the file and one part, in pieces', async () => {
    store.templates = wordTemplate(null);
    const parts = await call<ReadWordTemplateResult>(word().read_word_template, {});
    expect(parts).toMatchObject({ ok: true, template: 'Document', file: null, parts: [{ name: 'word/document.xml' }, { name: 'word/footer1.xml' }] });
    const body = await call<ReadWordTemplateResult>(word().read_word_template, { part: 'word/document.xml' });
    if (!body.ok || !('xml' in body)) throw new Error('no part');
    expect(body).toMatchObject({ from: 0, more: false });
    expect(body.xml).toContain('{d.pg.invoiceNo}');
    const rest = await call<ReadWordTemplateResult>(word().read_word_template, { part: 'word/document.xml', from: body.size - 10 });
    expect(rest).toMatchObject({ from: body.size - 10, xml: body.xml.slice(-10), more: false });
    expect(await call(word().read_word_template, { part: 'word/styles.xml' })).toMatchObject({ ok: false, error: expect.stringMatching(/^There is no part "word\/styles.xml"/) });
    store.templates = jobSpecSchema.parse({}).render.templates;
    expect(await call(word().read_word_template, {})).toMatchObject({ ok: false, error: expect.stringMatching(/is an HTML template/) });
  });

  it("edits the starter template or the template's file and saves the result as a new file", async () => {
    store.templates = wordTemplate(null);
    const fromStarter = await call<WordTemplateResult>(word().edit_word_template, { edits: [{ part: 'word/document.xml', find: '>Invoice<', replace: '>Sales invoice<' }] });
    if (!('file' in fromStarter)) throw new Error(fromStarter.error);
    expect(fromStarter.textPreview.split('\n')[0]).toBe('Sales invoice');
    expect(store.files.get(fromStarter.file.id)!.previousId).toBeNull();
    const again = await call<WordTemplateResult>(word().edit_word_template, { edits: [{ part: 'word/document.xml', find: '>Sales invoice<', replace: '>Invoice {d.pg.invoiceNo}<' }] });
    if (!('file' in again)) throw new Error(again.error);
    expect(store.files.get(again.file.id)).toMatchObject({ previousId: fromStarter.file.id, name: 'invoice.docx' });
    expect(again.textPreview.split('\n')[0]).toBe('Invoice {d.pg.invoiceNo}');
  });

  it('refuses an edit it cannot make, and saves nothing', async () => {
    store.templates = wordTemplate(null);
    const missing = await call<WordTemplateResult>(word().edit_word_template, { edits: [{ part: 'word/document.xml', find: 'nowhere', replace: 'x' }] });
    expect(missing).toMatchObject({ ok: false, error: expect.stringMatching(/^The text to find is not in word\/document.xml/) });
    const broken = await call<WordTemplateResult>(word().edit_word_template, { edits: [{ part: 'word/document.xml', find: '>Invoice<', replace: '>A & B<' }] });
    expect(broken).toMatchObject({ ok: false, error: expect.stringMatching(/is not well-formed XML: A bare & in text/) });
    expect(store.files.size).toBe(0);
    expect(store.templates[0]).toMatchObject({ kind: 'docx', fileId: null });
  });

  it('runs a render the model calls next to an edit after the edit', async () => {
    store.templates = wordTemplate(null);
    const tools = word();
    const edit = call<WordTemplateResult>(tools.edit_word_template, { edits: [{ part: 'word/document.xml', find: '>Invoice<', replace: '>Sales invoice<' }] });
    const render = call<RenderPreviewResult>(tools.render_preview, {});
    const [edited, rendered] = await Promise.all([edit, render]);
    expect(edited).toMatchObject({ ok: true });
    expect(rendered).toMatchObject({ ok: true, content: 'saved' });
    if (!rendered.ok) throw new Error(rendered.error);
    expect(rendered.textPreview.split('\n')[0]).toBe('Sales invoice');
  });

  it('shows the model the Word document in render_preview too', async () => {
    store.templates = wordTemplate(null);
    const tools = word({ visual: true });
    const result = await call<RenderPreviewResult>(tools.render_preview, {});
    expect(result).toMatchObject({ ok: true, content: 'starter', view: 'pdf', pages: 1 });
    expect((modelOutput(tools.render_preview, result) as { type: string }).type).toBe('content');
  });

  it('adds a Word template, and refuses a format its kind does not make', async () => {
    const added = await call<TemplateChangeResult>(tools().add_template, { name: 'Letter', kind: 'docx', formats: ['docx'] });
    expect(added).toMatchObject({ ok: true, template: { name: 'Letter', kind: 'docx', formats: ['docx'], content: 'starter' } });
    const wrong = await call<TemplateChangeResult>(tools().add_template, { name: 'Web', kind: 'docx', formats: ['html'] });
    expect(wrong).toEqual({ ok: false, error: 'A Word template makes PDF and DOCX files, not HTML.' });
  });
});

describe('Excel templates', () => {
  const excel = (fileId: string | null = null, scope: 'splf' | 'pageGroup' = 'splf'): JobTemplate[] => [
    { id: 'lines', name: 'Lines', kind: 'xlsx', fileId, scope, formats: ['xlsx', 'pdf'] },
  ];
  const withFile = (bytes: Uint8Array | null, visual = false) =>
    buildTools({ sample, store, masked: false, renderer: fakeRenderer, visual, templateFile: async (id) => (id === 'file-1' && bytes ? { name: 'lines.xlsx', content: bytes } : null) });
  const byUser = 'The Lines template is an Excel template. You cannot write or edit Excel files yet: the user downloads the starter template from the template\'s panel, changes it in Excel and uploads it. Check it with render_preview.';

  it('adds an Excel template of the whole spooled file making XLSX, or of page groups, and refuses a format or scope it does not take', async () => {
    const added = await call<TemplateChangeResult>(tools().add_template, { name: 'Lines', kind: 'xlsx' });
    expect(added).toMatchObject({ ok: true, template: { name: 'Lines', kind: 'xlsx', scope: 'splf', formats: ['xlsx'], content: 'starter' } });
    expect(store.templates[1]).toEqual({ id: 'lines', name: 'Lines', kind: 'xlsx', fileId: null, scope: 'splf', formats: ['xlsx'] });
    const perGroup = await call<TemplateChangeResult>(tools().add_template, { name: 'Per invoice', kind: 'xlsx', scope: 'pageGroup', formats: ['pdf', 'xlsx'] });
    expect(perGroup).toMatchObject({ ok: true, template: { kind: 'xlsx', scope: 'pageGroup', formats: ['pdf', 'xlsx'] } });
    expect(await call(tools().add_template, { name: 'Web', kind: 'xlsx', formats: ['html'] })).toEqual({ ok: false, error: 'An Excel template makes XLSX and PDF files, not HTML.' });
    expect(await call(tools().add_template, { name: 'Letter', kind: 'docx', scope: 'splf' })).toMatchObject({ ok: false, error: expect.stringMatching(/^Only an Excel template has a scope/) });
  });

  it('never writes or edits an Excel template, and says the user makes it in Excel', async () => {
    await call(tools().write_definition, { yaml });
    store.templates = excel();
    expect(await call(tools().write_template, { html: '<p>{d.pg.invoiceNo}</p>' })).toEqual({ ok: false, error: byUser });
    expect(await call(withFile(null).write_word_template, { design: { sections: [{ children: [] }] } })).toEqual({ ok: false, error: byUser });
    expect(await call(withFile(null).read_word_template, {})).toEqual({ ok: false, error: byUser });
    expect(await call(withFile(null).edit_word_template, { edits: [{ part: 'word/document.xml', find: 'a', replace: 'b' }] })).toEqual({ ok: false, error: byUser });
    expect(store.templates).toEqual(excel());
  });

  it('renders the whole spooled file to XLSX and returns its text by sheet and cell', async () => {
    await call(tools().write_definition, { yaml });
    store.templates = excel();
    const result = await call<RenderPreviewResult>(withFile(null).render_preview, { pageGroup: 3 });
    if (!result.ok) throw new Error(result.error);
    expect(result).toMatchObject({ content: 'starter', templateErrors: [] });
    // The fake Carbone sends the file back as it was: its cells are the text.
    expect(result.textPreview).toContain('Lines!A2: {d.pgs[i].invoiceNo}');
    const sent = fakeCarbone.mock.calls.at(-1)![0];
    expect(sent).toMatchObject({ kind: 'xlsx', format: 'xlsx' });
    expect(sentPageGroup(sent)).toBeUndefined();
    expect((sent.data as { pgs: unknown[] }).pgs).toHaveLength(6);
  });

  it('reports the tag check by sheet and cell, a file that is gone, and shows the model the PDF', async () => {
    await call(tools().write_definition, { yaml });
    store.templates = excel('file-1');
    const pageGroupFile = starterXlsx(parseDefinition(yaml), 'pageGroup');
    const wrong = await call<RenderPreviewResult>(withFile(pageGroupFile).render_preview, {});
    expect(wrong).toMatchObject({ ok: true, templateErrors: [expect.stringMatching(/^Invoice!B3: \{d\.pg\.invoiceNo\} and 23 other cells read one page group/)] });
    expect(await call(withFile(null).render_preview, {})).toEqual({ ok: false, error: 'The Excel file of the Lines template is gone. The user uploads it again.' });

    store.templates = excel('file-1', 'pageGroup');
    const shown = await call<RenderPreviewResult>(withFile(pageGroupFile, true).render_preview, { pageGroup: 1 });
    expect(shown).toMatchObject({ ok: true, templateErrors: [], view: 'pdf', pages: 1 });
    expect(sentPageGroup(fakeCarbone.mock.calls.at(-1)![0])?.invoiceNo).toBe('260102');
  });
});

describe('ask_user', () => {
  const schema = () => tools().ask_user.inputSchema as z.ZodType;
  const html = { label: 'HTML', description: 'Edited here in Spooldoc, and can also make an HTML page', recommended: true };
  const word = { label: 'Word', description: 'Edited in Word, and can also make a DOCX' };
  const question = 'Both make PDF. For this invoice I recommend HTML.';

  it('takes a question and 2 to 4 short answers, each with an optional line', () => {
    expect(ASK_USER_TOOL).toBe('ask_user');
    expect(schema().safeParse({ question, options: [html, word] }).success).toBe(true);
    expect(schema().safeParse({ question, options: [{ label: 'Yes' }, { label: 'No' }] }).success).toBe(true);
    expect(schema().safeParse({ question, options: [html] }).success).toBe(false);
    expect(schema().safeParse({ question, options: [] }).success).toBe(false);
    expect(schema().safeParse({ question, options: ['A', 'B', 'C', 'D', 'E'].map((label) => ({ label })) }).success).toBe(false);
    expect(schema().safeParse({ question: ' ', options: [html, word] }).success).toBe(false);
    expect(schema().safeParse({ question, options: [{ label: '' }, word] }).success).toBe(false);
    expect(schema().safeParse({ question, options: [{ label: 'x'.repeat(41) }, word] }).success).toBe(false);
  });

  it('asks, and writes nothing to the draft', async () => {
    const before = structuredClone(store.templates);
    expect(await call<AskUserResult>(tools().ask_user, { question, options: [html, word] })).toEqual({ ok: true, asked: true });
    expect(store.templates).toEqual(before);
    expect(store.yaml).toBe('');
  });

  it('turns down answers that are alike, or a recommendation that is not first', async () => {
    expect(await call<AskUserResult>(tools().ask_user, { question, options: [word, { ...html, recommended: false }, { label: 'word' }] })).toEqual({
      ok: false,
      error: 'Two answers have the same label. Give each its own.',
    });
    expect(await call<AskUserResult>(tools().ask_user, { question, options: [word, html] })).toEqual({
      ok: false,
      error: 'Only the first answer can be recommended. Put the one you recommend first.',
    });
    expect(optionsProblem([html, word])).toBeNull();
    expect(optionsProblem([word, { label: 'HTML' }])).toBeNull();
  });
});
