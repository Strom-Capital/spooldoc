import { extract, parseDefinition } from '@spooldoc/core';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ListJobsResult,
  ReadJobFilesResult,
  ReadPageResult,
  RenderPreviewResult,
  WriteDefinitionResult,
  WriteTemplateResult,
} from '@/lib/chat-types';
import { buildTools, visibleText, type DraftStore, type JobFiles, type JobFilesReader } from '@/lib/server/chat';
import { fixtureText, loadSample } from './helpers/fake-connection';

const sample = loadSample('invoice');
const yaml = fixtureText('invoice', 'definition.yaml');
const template = fixtureText('invoice', 'template.html');
const options = { toolCallId: 'call-1', messages: [] };

/** A job draft in memory. */
class MemoryDraft implements DraftStore {
  yaml = '';
  html: string | null = null;
  async readDefinition() {
    return this.yaml;
  }
  async readTemplate() {
    return this.html;
  }
  async writeDefinition(yaml: string) {
    this.yaml = yaml;
  }
  async writeTemplate(html: string) {
    this.html = html;
  }
}

let store: MemoryDraft;

beforeEach(() => {
  store = new MemoryDraft();
});

/** Two other jobs: one with a definition and a template, one with only a draft definition. */
const OTHER_JOBS: JobFiles[] = [
  { id: 'job-a', name: 'Invoices', definitionYaml: yaml, templateHtml: template },
  { id: 'job-b', name: 'Reminders', definitionYaml: 'type: reminder\nversion: 1\nsource: text\ntext:\n  page: { width: 132, length: 66 }\n  fields: []\n', templateHtml: null },
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

const tools = (masked = false, jobs?: JobFilesReader) => buildTools({ sample, store, masked, jobs });

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
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.textPreview).toContain('260101');
    expect(result.textPreview).not.toMatch(/<[a-z]/i);
    expect(result.textPreview.length).toBeLessThanOrEqual(1500 + 20);
    expect(store.html).toBe(template);
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
  it('lists every other job with its definition type and whether it has a template', async () => {
    const result = await call<ListJobsResult>(tools(false, new MemoryJobs()).list_jobs, {});
    expect(result).toEqual({
      ok: true,
      jobs: [
        { id: 'job-a', name: 'Invoices', type: 'invoice', hasTemplate: true },
        { id: 'job-b', name: 'Reminders', type: 'reminder', hasTemplate: false },
      ],
    });
  });

  it('reports no type for a job whose definition is empty or does not parse, and nothing else of a job', async () => {
    const reader = new MemoryJobs([{ id: 'job-c', name: 'Blank', definitionYaml: '', templateHtml: null }]);
    const result = await call<ListJobsResult>(tools(false, reader).list_jobs, {});
    if (!result.ok) throw new Error(result.error);
    expect(result.jobs).toEqual([{ id: 'job-c', name: 'Blank', type: null, hasTemplate: false }]);
    expect(Object.keys(result.jobs[0]!).sort()).toEqual(['hasTemplate', 'id', 'name', 'type']);
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
  it("returns a job's definition and template, and only those", async () => {
    const reader = new MemoryJobs();
    const result = await call<ReadJobFilesResult>(tools(false, reader).read_job_files, { id: 'job-a' });
    expect(result).toEqual({ ok: true, id: 'job-a', name: 'Invoices', definitionYaml: yaml, templateHtml: template });
    expect(reader.reads).toEqual(['job-a']);
  });

  it('answers null for a missing template or definition', async () => {
    const result = await call<ReadJobFilesResult>(tools(false, new MemoryJobs()).read_job_files, { id: 'job-b' });
    if (!result.ok) throw new Error(result.error);
    expect(result.templateHtml).toBeNull();
    expect(result.definitionYaml).toContain('type: reminder');

    const blank = new MemoryJobs([{ id: 'job-c', name: 'Blank', definitionYaml: '  \n', templateHtml: null }]);
    const empty = await call<ReadJobFilesResult>(tools(false, blank).read_job_files, { id: 'job-c' });
    expect(empty).toEqual({ ok: true, id: 'job-c', name: 'Blank', definitionYaml: null, templateHtml: null });
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
