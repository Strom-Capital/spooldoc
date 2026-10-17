import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extract, openWorkspace, parseDefinition, type Workspace } from '@spooldoc/core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReadPageResult, RenderPreviewResult, WriteDefinitionResult, WriteTemplateResult } from '@/lib/chat-types';
import { buildTools, visibleText } from '@/lib/server/chat';
import { fixtureText, loadSample } from './helpers/fake-connection';

const sample = loadSample('invoice');
const yaml = fixtureText('invoice', 'definition.yaml');
const template = fixtureText('invoice', 'template.html');
const options = { toolCallId: 'call-1', messages: [] };

let ws: Workspace;

beforeEach(async () => {
  ws = openWorkspace(mkdtempSync(path.join(tmpdir(), 'spooldoc-tools-')));
  await ws.writeSample(sample);
});

const tools = (masked = false) => buildTools({ sampleId: sample.id, workspace: ws, masked });

async function call<T>(t: { execute?: (input: never, opts: never) => unknown }, input: unknown): Promise<T> {
  return (await t.execute?.(input as never, options as never)) as T;
}

describe('write_definition', () => {
  it('saves the definition, links the sample and reports the extraction', async () => {
    const result = await call<WriteDefinitionResult>(tools().write_definition, { yaml });
    if (!result.ok) throw new Error(result.error);

    expect(result.type).toBe('invoice');
    expect(result.path).toBe('definitions/invoice.yaml');
    expect(result.documents).toBe(6);
    expect(result.missing).toEqual([]);
    expect(result.fields.find((f) => f.name === 'invoiceNo')).toEqual({ name: 'invoiceNo', status: 'found', value: '260101' });
    expect(result.fields.find((f) => f.name === 'lines')?.value).toMatch(/^\d+ rows$/);
    expect(result.preview).toContain('"invoiceNo": "260101"');
    expect(result.preview.length).toBeLessThanOrEqual(2000 + 20);
    expect(await ws.readDefinition('invoice')).toBe(yaml);
    expect((await ws.readSample(sample.id))?.definition).toBe('invoice');
    expect(JSON.stringify(result)).not.toContain(ws.root);
  });

  it('returns ok: false with the message for invalid YAML and writes nothing', async () => {
    const result = await call<WriteDefinitionResult>(tools().write_definition, { yaml: 'type: invoice\nversion: [1\n' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/YAML/);

    const schema = await call<WriteDefinitionResult>(tools().write_definition, { yaml: 'type: invoice\nversion: 1\nsource: text\n' });
    expect(!schema.ok && schema.error).toMatch(/needs a `text` section/);
    expect(await ws.readDefinition('invoice')).toBeNull();
    expect((await ws.readSample(sample.id))?.definition).toBeUndefined();
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
  it('refuses before a definition is linked', async () => {
    const result = await call<WriteTemplateResult>(tools().write_template, { html: template });
    expect(result.ok).toBe(false);
    expect('error' in result && result.error).toMatch(/write_definition first/);
    expect(await ws.readTemplate('invoice')).toBeNull();
  });

  it('saves the template and returns the visible text of the first document', async () => {
    await call(tools().write_definition, { yaml });
    const result = await call<WriteTemplateResult>(tools().write_template, { html: template });
    if (!('path' in result)) throw new Error(result.error);

    expect(result.ok).toBe(true);
    expect(result.path).toBe('templates/invoice.html');
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.textPreview).toContain('260101');
    expect(result.textPreview).not.toMatch(/<[a-z]/i);
    expect(result.textPreview.length).toBeLessThanOrEqual(1500 + 20);
    expect(await ws.readTemplate('invoice')).toBe(template);
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
  it('needs a linked definition', async () => {
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
