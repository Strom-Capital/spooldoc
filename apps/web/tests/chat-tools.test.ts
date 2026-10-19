import { extract, parseDefinition } from '@spooldoc/core';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  JobOutputFiles,
  ListJobsResult,
  OutputChangeResult,
  ReadJobFilesResult,
  ReadPageResult,
  RenderPreviewResult,
  WriteDefinitionResult,
  WriteTemplateResult,
} from '@/lib/chat-types';
import { jobSpecSchema, type JobOutput } from '@/lib/job-spec';
import { buildTools, visibleText, type DraftStore, type JobFiles, type JobFilesReader } from '@/lib/server/chat';
import type { DocumentRenderer } from '@/lib/server/documents';
import { fakeCarbone, fakeRenderer } from './helpers/carbone';
import { fixtureText, loadSample } from './helpers/fake-connection';

const sample = loadSample('invoice');
const yaml = fixtureText('invoice', 'definition.yaml');
const template = fixtureText('invoice', 'template.html');
const options = { toolCallId: 'call-1', messages: [] };

/** A job draft in memory: a definition and outputs, checked by the spec schema as the draft store does. */
class MemoryDraft implements DraftStore {
  yaml = '';
  outputs: JobOutput[] = jobSpecSchema.parse({}).render.outputs;
  /** The first output's template. */
  get html(): string | null {
    return this.outputs[0]!.template.source;
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
  templateHtml,
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
    expect(store.outputs.map((o) => o.template.source)).toEqual([null, '<p>{d.doc.invoiceNo}</p>']);

    const unknown = await call<WriteTemplateResult>(tools().write_template, { html: '<p/>', output: 'Totals' });
    expect(unknown).toEqual({ ok: false, error: 'There is no output "Totals". The job\'s outputs are Document (id main), Lines (id lines).' });
    expect(store.outputs[1]!.template.source).toBe('<p>{d.doc.invoiceNo}</p>');
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
    expect(fakeCarbone.mock.calls[0]![0].asset?.('logo')).toBe('data:,');
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
      output: { id: 'order-lines', label: 'Order lines', formats: ['pdf', 'html'], template: 'starter' },
      outputs: [
        { id: 'main', label: 'Document', formats: ['pdf'], template: 'starter' },
        { id: 'order-lines', label: 'Order lines', formats: ['pdf', 'html'], template: 'starter' },
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
