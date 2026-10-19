import { extract, parseDefinition, readDocx, starterDocx, type HtmlRender } from '@spooldoc/core';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  JobOutputFiles,
  ListJobsResult,
  OutputChangeResult,
  ReadJobFilesResult,
  ReadPageResult,
  ReadWordTemplateResult,
  RenderPreviewResult,
  WordTemplateResult,
  WriteDefinitionResult,
  WriteTemplateResult,
} from '@/lib/chat-types';
import { jobSpecSchema, withTemplate, type JobOutput } from '@/lib/job-spec';
import { buildTools, visibleText, type DraftStore, type JobFiles, type JobFilesReader } from '@/lib/server/chat';
import type { DocumentRenderer } from '@/lib/server/documents';
import type { TemplateFileView } from '@/lib/types';
import { fakeCarbone, fakeRenderer, PDF_BYTES, PNG_BYTES } from './helpers/carbone';
import { fixtureText, loadSample } from './helpers/fake-connection';

const sample = loadSample('invoice');
const yaml = fixtureText('invoice', 'definition.yaml');
const template = fixtureText('invoice', 'template.html');
const options = { toolCallId: 'call-1', messages: [] };
/** A 40 x 10 PNG header, enough for the docx library to place. */
const PNG_LOGO = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAAKCAIAAABaL8vzAAAAEklEQVR4nGM4ceIEAAS0AlkWLoFAAAAAAElFTkSuQmCC', 'base64'));

/** A job draft in memory: a definition and outputs, checked by the spec schema as the draft store does. */
/** An output's HTML template text; undefined for a Word template. */
const htmlOf = (output: JobOutput): string | null | undefined => (output.template.kind === 'html' ? output.template.source : undefined);

class MemoryDraft implements DraftStore {
  yaml = '';
  outputs: JobOutput[] = jobSpecSchema.parse({}).render.outputs;
  /** The first output's template. */
  get html(): string | null | undefined {
    return htmlOf(this.outputs[0]!);
  }
  async readDefinition() {
    return this.yaml;
  }
  async readOutputs() {
    return this.outputs;
  }
  async writeDefinition(yaml: string) {
    this.yaml = yaml;
  }
  async writeTemplate(outputId: string, html: string) {
    await this.changeOutputs((outputs) => outputs.map((o) => (o.id === outputId ? { ...o, template: { kind: 'html', source: html } } : o)));
  }
  async changeOutputs(change: (outputs: JobOutput[]) => JobOutput[]) {
    this.outputs = jobSpecSchema.shape.render.parse({ outputs: change(this.outputs) }).outputs;
    return this.outputs;
  }
  /** The Word files the assistant saved, by id, as the database would keep them. */
  files = new Map<string, { name: string; content: Uint8Array; previousId: string | null }>();
  async writeWordTemplate(outputId: string, file: { name: string; content: Uint8Array; previousId: string | null }): Promise<TemplateFileView> {
    const output = this.outputs.find((o) => o.id === outputId);
    if (!output) throw new Error('The output is gone.');
    if (output.template.kind === 'html' && output.template.source !== null) throw new Error(`The ${output.label} output has an HTML template of its own.`);
    const id = `00000000-0000-4000-8000-${String(this.files.size + 1).padStart(12, '0')}`;
    this.files.set(id, file);
    await this.changeOutputs((outputs) => outputs.map((o) => (o.id === outputId ? withTemplate(o, { kind: 'docx', fileId: id }) : o)));
    return { id, name: file.name, size: file.content.length, createdAt: new Date(0).toISOString(), madeBy: 'assistant', previousId: file.previousId };
  }
  /** Reads a file the assistant saved, as the chat route's `templateFile` does. */
  readFile = async (id: string) => this.files.get(id) ?? null;
}

let store: MemoryDraft;

beforeEach(() => {
  store = new MemoryDraft();
});

/** An output of another job with its template. */
const files = (templateHtml: string | null, fields: Partial<JobOutputFiles> = {}): JobOutputFiles => ({
  id: 'main',
  label: 'Document',
  formats: ['pdf'],
  kind: 'html',
  templateHtml,
  fileId: null,
  ...fields,
});

/** Two other jobs: one with a definition and two outputs, one with only a draft definition. */
const OTHER_JOBS: JobFiles[] = [
  { id: 'job-a', name: 'Invoices', definitionYaml: yaml, outputs: [files(template), files(null, { id: 'lines', label: 'Lines', formats: ['html'] })] },
  {
    id: 'job-b',
    name: 'Reminders',
    definitionYaml: 'type: reminder\nversion: 1\nsource: text\ntext:\n  page: { width: 132, length: 66 }\n  fields: []\n',
    outputs: [files(null)],
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
    expect(result.documents).toBe(6);
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

  it('masks the values it reports when masking is on', async () => {
    const result = await call<WriteDefinitionResult>(tools(true).write_definition, { yaml });
    if (!result.ok) throw new Error(result.error);
    expect(result.fields.find((f) => f.name === 'invoiceNo')?.value).toBe('999999');
    expect(result.preview).not.toContain('260101');
    expect(result.documents).toBe(6);
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
    expect(result.output).toBe('Document');
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.textPreview).toContain('260101');
    expect(result.textPreview).not.toMatch(/<[a-z]/i);
    expect(result.textPreview.length).toBeLessThanOrEqual(1500 + 20);
    expect(store.html).toBe(template);
  });

  it('saves the template of the output named by id or name, and fails for an unknown output', async () => {
    await call(tools().write_definition, { yaml });
    await call(tools().add_output, { label: 'Lines' });
    const byName = await call<WriteTemplateResult>(tools().write_template, { html: '<p>{d.doc.invoiceNo}</p>', output: 'lines' });
    if (!('path' in byName)) throw new Error(byName.error);
    expect(byName.output).toBe('Lines');
    expect(store.outputs.map(htmlOf)).toEqual([null, '<p>{d.doc.invoiceNo}</p>']);

    const unknown = await call<WriteTemplateResult>(tools().write_template, { html: '<p/>', output: 'Totals' });
    expect(unknown).toEqual({ ok: false, error: 'There is no output "Totals". The job\'s outputs are Document (id main), Lines (id lines).' });
    expect(htmlOf(store.outputs[1]!)).toBe('<p>{d.doc.invoiceNo}</p>');
  });

  it('checks the template by line before it renders', async () => {
    await call(tools().write_definition, { yaml });
    const result = await call<WriteTemplateResult>(tools().write_template, { html: '<p>\n{d.doc.invoiceNumber}</p>' });
    if (!('path' in result)) throw new Error(result.error);
    expect(result.errors).toEqual(['Line 2: {d.doc.invoiceNumber} is not in the data. Did you mean {d.doc.invoiceNo}?']);
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
    await call(withLogo.write_template, { html: `<img src="{asset('logo')}">{d.doc.invoiceNo}` });
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
    const result = await call<RenderPreviewResult>(tools().render_preview, { document: 1 });
    if (!result.ok) throw new Error(result.error);

    const expected = extract(parseDefinition(yaml), sample);
    const count = (status: string) => expected.hits.filter((hit) => hit.status === status).length;
    expect(result.documents).toBe(expected.documents.length);
    expect(result.hits).toEqual({ found: count('found'), missing: count('missing'), empty: count('empty') });
    expect(result.document).toBe(1);
    expect(result.output).toBe('Document');
    expect(result.template).toBe('saved');
    expect(result.templateErrors).toEqual([]);
    expect(result.textPreview).toContain('MÄKELÄ RAKENNUS OY');
  });

  it('uses the starter template when none is saved, and clamps the document index', async () => {
    await call(tools().write_definition, { yaml });
    const result = await call<RenderPreviewResult>(tools().render_preview, { document: 50 });
    if (!result.ok) throw new Error(result.error);
    expect(result.template).toBe('starter');
    expect(result.document).toBe(5);
  });

  it("renders the output named, with that output's template", async () => {
    await call(tools().write_definition, { yaml });
    await call(tools().write_template, { html: template });
    await call(tools().add_output, { label: 'Lines' });
    await call(tools().write_template, { html: '<p>Lines of {d.doc.invoiceNo}</p>', output: 'Lines' });

    const lines = await call<RenderPreviewResult>(tools().render_preview, { output: 'lines' });
    if (!lines.ok) throw new Error(lines.error);
    expect(lines).toMatchObject({ output: 'Lines', template: 'saved', textPreview: 'Lines of 260101' });
    const first = await call<RenderPreviewResult>(tools().render_preview, {});
    if (!first.ok) throw new Error(first.error);
    expect(first.output).toBe('Document');
    expect(first.textPreview).not.toContain('Lines of');
    expect((await call<RenderPreviewResult>(tools().render_preview, { output: 'nope' })).ok).toBe(false);
  });
});

describe('add_output and remove_output', () => {
  it('adds an output with the starter template and the formats asked for', async () => {
    const result = await call<OutputChangeResult>(tools().add_output, { label: 'Order lines', formats: ['html', 'pdf'] });
    expect(result).toEqual({
      ok: true,
      output: { id: 'order-lines', label: 'Order lines', formats: ['pdf', 'html'], kind: 'html', template: 'starter' },
      outputs: [
        { id: 'main', label: 'Document', formats: ['pdf'], kind: 'html', template: 'starter' },
        { id: 'order-lines', label: 'Order lines', formats: ['pdf', 'html'], kind: 'html', template: 'starter' },
      ],
    });
    expect(store.outputs).toHaveLength(2);
    expect((await call<OutputChangeResult>(tools().add_output, { label: 'Totals' })).ok && store.outputs[2]!.formats).toEqual(['pdf']);
  });

  it('refuses a name another output has', async () => {
    const result = await call<OutputChangeResult>(tools().add_output, { label: 'document' });
    expect(result).toEqual({ ok: false, error: 'There is already an output named "document". Pick another name.' });
    expect(store.outputs).toHaveLength(1);
  });

  it('removes an output by id or name, but never the last one', async () => {
    await call(tools().add_output, { label: 'Lines' });
    const removed = await call<OutputChangeResult>(tools().remove_output, { output: 'Document' });
    if (!removed.ok) throw new Error(removed.error);
    expect(removed.output.label).toBe('Document');
    expect(store.outputs.map((o) => o.id)).toEqual(['lines']);

    expect(await call<OutputChangeResult>(tools().remove_output, { output: 'lines' })).toEqual({
      ok: false,
      error: 'A job needs at least one output, so the last one cannot be removed.',
    });
    expect(await call<OutputChangeResult>(tools().remove_output, { output: 'nope' })).toEqual({
      ok: false,
      error: 'There is no output "nope". The job\'s outputs are Lines (id lines).',
    });
    expect(store.outputs.map((o) => o.id)).toEqual(['lines']);
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
  it('lists every other job with its definition type, outputs and whether it has a template', async () => {
    const result = await call<ListJobsResult>(tools(false, new MemoryJobs()).list_jobs, {});
    expect(result).toEqual({
      ok: true,
      jobs: [
        { id: 'job-a', name: 'Invoices', type: 'invoice', outputs: ['Document', 'Lines'], hasTemplate: true },
        { id: 'job-b', name: 'Reminders', type: 'reminder', outputs: ['Document'], hasTemplate: false },
      ],
    });
  });

  it('reports no type for a job whose definition is empty or does not parse, and nothing else of a job', async () => {
    const reader = new MemoryJobs([{ id: 'job-c', name: 'Blank', definitionYaml: '', outputs: [files(null)] }]);
    const result = await call<ListJobsResult>(tools(false, reader).list_jobs, {});
    if (!result.ok) throw new Error(result.error);
    expect(result.jobs).toEqual([{ id: 'job-c', name: 'Blank', type: null, outputs: ['Document'], hasTemplate: false }]);
    expect(Object.keys(result.jobs[0]!).sort()).toEqual(['hasTemplate', 'id', 'name', 'outputs', 'type']);
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
  it("returns a job's definition and every output with its template, and only those", async () => {
    const reader = new MemoryJobs();
    const result = await call<ReadJobFilesResult>(tools(false, reader).read_job_files, { id: 'job-a' });
    expect(result).toEqual({
      ok: true,
      id: 'job-a',
      name: 'Invoices',
      definitionYaml: yaml,
      outputs: [files(template), files(null, { id: 'lines', label: 'Lines', formats: ['html'] })],
    });
    expect(reader.reads).toEqual(['job-a']);
  });

  it('answers null for a missing template or definition', async () => {
    const result = await call<ReadJobFilesResult>(tools(false, new MemoryJobs()).read_job_files, { id: 'job-b' });
    if (!result.ok) throw new Error(result.error);
    expect(result.outputs[0]!.templateHtml).toBeNull();
    expect(result.definitionYaml).toContain('type: reminder');

    const blank = new MemoryJobs([{ id: 'job-c', name: 'Blank', definitionYaml: '  \n', outputs: [files(null)] }]);
    const empty = await call<ReadJobFilesResult>(tools(false, blank).read_job_files, { id: 'job-c' });
    expect(empty).toEqual({ ok: true, id: 'job-c', name: 'Blank', definitionYaml: null, outputs: [files(null)] });
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
  const wordOutput = (fileId: string | null): JobOutput[] => [{ id: 'main', label: 'Document', template: { kind: 'docx', fileId }, formats: ['pdf', 'docx'] }];
  const withFile = (bytes: Uint8Array | null) =>
    buildTools({ sample, store, masked: false, renderer: fakeRenderer, templateFile: async (id) => (id === 'file-1' && bytes ? { name: 'invoice.docx', content: bytes } : null) });

  it('never writes over a Word template', async () => {
    await call(tools().write_definition, { yaml });
    store.outputs = wordOutput(null);
    const result = await call<WriteTemplateResult>(tools().write_template, { html: '<p>{d.doc.invoiceNo}</p>' });
    expect(result).toEqual({
      ok: false,
      error: 'The Document output uses a Word template. Change it with edit_word_template, or design a new one with write_word_template.',
    });
    expect(store.outputs[0]!.template).toEqual({ kind: 'docx', fileId: null });
  });

  it('checks and renders the uploaded file, or the starter template, to DOCX and returns its text', async () => {
    await call(tools().write_definition, { yaml });
    store.outputs = wordOutput('00000000-0000-4000-8000-000000000001');
    const bytes = await starterDocx(parseDefinition(yaml));
    const reader = buildTools({ sample, store, masked: false, renderer: fakeRenderer, templateFile: async () => ({ name: 'invoice.docx', content: bytes }) });
    const result = await call<RenderPreviewResult>(reader.render_preview, {});
    if (!result.ok) throw new Error(result.error);
    expect(result).toMatchObject({ template: 'saved', templateErrors: [] });
    // The fake Carbone sends the file back as it was: its paragraphs are the text.
    expect(result.textPreview).toContain('Invoice No\t{d.doc.invoiceNo}');
    expect(fakeCarbone.mock.calls.at(-1)![0]).toMatchObject({ kind: 'docx', format: 'docx' });

    store.outputs = wordOutput(null);
    const starter = await call<RenderPreviewResult>(withFile(null).render_preview, {});
    expect(starter).toMatchObject({ ok: true, template: 'starter', templateErrors: [] });
  });

  it('reports the tag check by part, and a file that is gone', async () => {
    await call(tools().write_definition, { yaml });
    store.outputs = wordOutput('file-1');
    const bad = await starterDocx(parseDefinition(yaml.replace('name: invoiceNo,', 'name: invoiceNumber,').replace('field: invoiceNo }', 'field: invoiceNumber }')));
    const result = await call<RenderPreviewResult>(withFile(bad).render_preview, {});
    expect(result).toMatchObject({ ok: true, templateErrors: ['body: {d.doc.invoiceNumber} is not in the data. Did you mean {d.doc.invoiceNo}?'] });
    expect(await call(withFile(null).render_preview, {})).toEqual({
      ok: false,
      error: 'The Word template of the Document output is gone. Write a new one with write_word_template, or the user uploads one.',
    });
  });
});

describe('Word templates by the assistant', () => {
  /** A small design: a title, the invoice number, and the lines as a loop. */
  const design = {
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [
      {
        footers: { default: { children: [{ type: 'Paragraph', children: [{ type: 'TextRun', text: 'Page ' }, { type: 'PageNumber', field: 'PAGE' }] }] } },
        children: [
          { type: 'Paragraph', children: [{ type: 'TextRun', text: 'Invoice {d.doc.invoiceNo}', bold: true, size: '18pt' }] },
          {
            type: 'Table',
            rows: [
              { type: 'TableRow', children: [{ type: 'TableCell', children: [{ type: 'Paragraph', text: '{d.doc.lines[i].item}' }] }] },
              { type: 'TableRow', children: [{ type: 'TableCell', children: [{ type: 'Paragraph', text: '{d.doc.lines[i+1]}' }] }] },
            ],
          },
        ],
      },
    ],
  };
  const wordOutput = (fileId: string | null): JobOutput[] => [{ id: 'main', label: 'Document', template: { kind: 'docx', fileId }, formats: ['pdf', 'docx'] }];
  const word = (input: Partial<Parameters<typeof buildTools>[0]> = {}) =>
    buildTools({ sample, store, masked: false, renderer: fakeRenderer, templateFile: store.readFile, ...input });
  const modelOutput = (t: { toModelOutput?: unknown }, output: unknown, toolCallId = options.toolCallId) =>
    (t.toModelOutput as (o: { toolCallId: string; input: unknown; output: unknown }) => unknown)({ toolCallId, input: {}, output });

  beforeEach(async () => {
    await call(tools().write_definition, { yaml });
  });

  it('designs a template, saves it as a new file the output uses and reports its text', async () => {
    const result = await call<WordTemplateResult>(word().write_word_template, { design });
    if (!('file' in result)) throw new Error(result.error);
    expect(result).toMatchObject({ ok: true, output: 'Document', errors: [], view: null, pages: null, file: { name: 'invoice.docx' } });
    expect(result.textPreview).toContain('Invoice {d.doc.invoiceNo}');
    // The HTML starter output became a Word one.
    expect(store.outputs[0]).toMatchObject({ template: { kind: 'docx', fileId: result.file.id }, formats: ['pdf'] });
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
      note: 'Document 1 has 9 pages, so you see page 1 only. To check the later pages, render a document with fewer pages (render_preview with document).',
    });
    const shown = modelOutput(tools.write_word_template, result) as { value: unknown[] };
    expect(shown.value[1]).toMatchObject({ type: 'file', mediaType: 'image/png', data: { type: 'data', data: PNG_BYTES } });
  });

  it('renders the preview with masked values when masking is on', async () => {
    await call(word({ visual: true, masked: true }).write_word_template, { design });
    const pdf = fakeCarbone.mock.calls.findLast(([input]) => input.format === 'pdf')![0];
    expect((pdf.data.doc as { invoiceNo: string }).invoiceNo).toMatch(/^9+$/);
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
    store.outputs = wordOutput(null);
    const first = await call<WordTemplateResult>(word().write_word_template, { design, name: 'sales.docx' });
    const second = await call<WordTemplateResult>(word().write_word_template, { design });
    if (!('file' in first) || !('file' in second)) throw new Error('not saved');
    expect(second.file.name).toBe('sales.docx');
    expect(store.files.get(second.file.id)!.previousId).toBe(first.file.id);
    expect(store.outputs[0]!.template).toEqual({ kind: 'docx', fileId: second.file.id });
  });

  it('does not replace an HTML template of the HTML output', async () => {
    await call(tools().write_template, { html: template });
    const result = await call<WordTemplateResult>(word().write_word_template, { design });
    expect(result).toEqual({ ok: false, error: 'Could not save the Word template: The Document output has an HTML template of its own.' });
    expect(store.html).toBe(template);
  });

  it('reads the parts of the file and one part, in pieces', async () => {
    store.outputs = wordOutput(null);
    const parts = await call<ReadWordTemplateResult>(word().read_word_template, {});
    expect(parts).toMatchObject({ ok: true, output: 'Document', file: null, parts: [{ name: 'word/document.xml' }, { name: 'word/footer1.xml' }] });
    const body = await call<ReadWordTemplateResult>(word().read_word_template, { part: 'word/document.xml' });
    if (!body.ok || !('xml' in body)) throw new Error('no part');
    expect(body).toMatchObject({ from: 0, more: false });
    expect(body.xml).toContain('{d.doc.invoiceNo}');
    const rest = await call<ReadWordTemplateResult>(word().read_word_template, { part: 'word/document.xml', from: body.size - 10 });
    expect(rest).toMatchObject({ from: body.size - 10, xml: body.xml.slice(-10), more: false });
    expect(await call(word().read_word_template, { part: 'word/styles.xml' })).toMatchObject({ ok: false, error: expect.stringMatching(/^There is no part "word\/styles.xml"/) });
    store.outputs = jobSpecSchema.parse({}).render.outputs;
    expect(await call(word().read_word_template, {})).toMatchObject({ ok: false, error: expect.stringMatching(/uses an HTML template/) });
  });

  it("edits the starter template or the output's file and saves the result as a new file", async () => {
    store.outputs = wordOutput(null);
    const fromStarter = await call<WordTemplateResult>(word().edit_word_template, { edits: [{ part: 'word/document.xml', find: '>Invoice<', replace: '>Sales invoice<' }] });
    if (!('file' in fromStarter)) throw new Error(fromStarter.error);
    expect(fromStarter.textPreview.split('\n')[0]).toBe('Sales invoice');
    expect(store.files.get(fromStarter.file.id)!.previousId).toBeNull();
    const again = await call<WordTemplateResult>(word().edit_word_template, { edits: [{ part: 'word/document.xml', find: '>Sales invoice<', replace: '>Invoice {d.doc.invoiceNo}<' }] });
    if (!('file' in again)) throw new Error(again.error);
    expect(store.files.get(again.file.id)).toMatchObject({ previousId: fromStarter.file.id, name: 'invoice.docx' });
    expect(again.textPreview.split('\n')[0]).toBe('Invoice {d.doc.invoiceNo}');
  });

  it('refuses an edit it cannot make, and saves nothing', async () => {
    store.outputs = wordOutput(null);
    const missing = await call<WordTemplateResult>(word().edit_word_template, { edits: [{ part: 'word/document.xml', find: 'nowhere', replace: 'x' }] });
    expect(missing).toMatchObject({ ok: false, error: expect.stringMatching(/^The text to find is not in word\/document.xml/) });
    const broken = await call<WordTemplateResult>(word().edit_word_template, { edits: [{ part: 'word/document.xml', find: '>Invoice<', replace: '>A & B<' }] });
    expect(broken).toMatchObject({ ok: false, error: expect.stringMatching(/is not well-formed XML: A bare & in text/) });
    expect(store.files.size).toBe(0);
    expect(store.outputs[0]!.template).toEqual({ kind: 'docx', fileId: null });
  });

  it('shows the model the Word document in render_preview too', async () => {
    store.outputs = wordOutput(null);
    const tools = word({ visual: true });
    const result = await call<RenderPreviewResult>(tools.render_preview, {});
    expect(result).toMatchObject({ ok: true, template: 'starter', view: 'pdf', pages: 1 });
    expect((modelOutput(tools.render_preview, result) as { type: string }).type).toBe('content');
  });

  it('adds a Word output, and refuses a format its kind does not make', async () => {
    const added = await call<OutputChangeResult>(tools().add_output, { label: 'Letter', kind: 'docx', formats: ['docx'] });
    expect(added).toMatchObject({ ok: true, output: { label: 'Letter', kind: 'docx', formats: ['docx'], template: 'starter' } });
    const wrong = await call<OutputChangeResult>(tools().add_output, { label: 'Web', kind: 'docx', formats: ['html'] });
    expect(wrong).toEqual({ ok: false, error: 'A Word template makes PDF and DOCX files, not HTML.' });
  });
});
