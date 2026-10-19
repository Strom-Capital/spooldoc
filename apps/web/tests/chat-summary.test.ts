import { describe, expect, it } from 'vitest';
import { chatActivity, chatErrorText, savedFile, toolSummary } from '@/lib/client/chat';

const done = (toolName: string, output: unknown, input: unknown = {}) => ({ toolName, state: 'output-available', input, output });

describe('toolSummary', () => {
  it('summarizes each tool in one line', () => {
    expect(toolSummary(done('read_sample_page', { page: 4, of: 8, lines: '' })).text).toBe('Read page 4');
    expect(
      toolSummary(done('write_definition', { ok: true, type: 'invoice', documents: 6, missing: ['a', 'b'], fields: [], warnings: [], preview: '' })),
    ).toEqual({ text: 'Wrote definition invoice: 6 documents, 2 missing', tone: 'warn' });
    expect(toolSummary(done('write_template', { ok: true, path: 'template', output: 'Lines', errors: [], warnings: [], textPreview: '' })).text).toBe(
      'Wrote template of Lines: no errors',
    );
    expect(
      toolSummary(
        done('render_preview', {
          ok: true,
          output: 'Document',
          document: 0,
          documents: 6,
          template: 'saved',
          hits: { found: 37, missing: 0, empty: 2 },
          missing: [],
          templateErrors: [],
          textPreview: '',
        }),
      ),
    ).toEqual({ text: 'Rendered Document: 37 found, 0 missing', tone: 'ok' });
    const lines = { id: 'lines', label: 'Lines', formats: ['pdf', 'html'], template: 'starter' };
    expect(toolSummary(done('add_output', { ok: true, output: lines, outputs: [lines] }))).toEqual({ text: 'Added output Lines: PDF and HTML', tone: 'ok' });
    expect(toolSummary(done('remove_output', { ok: true, output: lines, outputs: [] }))).toEqual({ text: 'Removed output Lines', tone: 'ok' });
    expect(toolSummary(done('remove_output', { ok: false, error: 'A job needs at least one output, so the last one cannot be removed.' })).text).toBe(
      'Output not removed: A job needs at least one output, so the last one cannot be removed.',
    );
    expect(toolSummary(done('list_jobs', { ok: true, jobs: [{ id: 'a', name: 'A', type: 'invoice', outputs: ['Document'], hasTemplate: true }] }))).toEqual({
      text: 'Listed 1 other job',
      tone: 'ok',
    });
    const output = (templateHtml: string | null) => ({ id: 'main', label: 'Document', formats: ['pdf'], templateHtml });
    expect(toolSummary(done('read_job_files', { ok: true, id: 'a', name: 'Invoices', definitionYaml: 'type: invoice', outputs: [output(null)] })).text).toBe(
      'Read job Invoices: definition',
    );
    expect(
      toolSummary(done('read_job_files', { ok: true, id: 'a', name: 'Invoices', definitionYaml: 'type: invoice', outputs: [output('<p/>'), output('<p/>')] })).text,
    ).toBe('Read job Invoices: definition and 2 templates');
    expect(toolSummary(done('read_job_files', { ok: false, error: 'There is no job x. Find the id with list_jobs.' }))).toEqual({
      text: 'There is no job x. Find the id with list_jobs.',
      tone: 'warn',
    });
  });

  it('shows running, rejected and failed calls', () => {
    expect(toolSummary({ toolName: 'read_sample_page', state: 'input-available', input: { page: 2 } })).toEqual({ text: 'Reading page 2', tone: 'running' });
    expect(toolSummary(done('write_definition', { ok: false, error: 'Invalid definition:\n  - text: `source: text` needs a `text` section' })).text).toBe(
      'Definition not saved: text: `source: text` needs a `text` section',
    );
    expect(toolSummary({ toolName: 'render_preview', state: 'output-error', errorText: 'boom' })).toEqual({ text: 'render_preview failed: boom', tone: 'error' });
  });
});

describe('savedFile', () => {
  it('names the draft a finished write replaces', () => {
    expect(savedFile(done('write_definition', { ok: true }))).toBe('yaml');
    expect(savedFile(done('write_definition', { ok: false, error: 'x' }))).toBeNull();
    expect(savedFile(done('write_template', { ok: false, path: 'templates/a.html', errors: ['x'] }))).toBe('html');
    expect(savedFile(done('render_preview', { ok: true }))).toBeNull();
    expect(savedFile(done('add_output', { ok: true }))).toBe('outputs');
    expect(savedFile(done('remove_output', { ok: false, error: 'x' }))).toBeNull();
  });
});

describe('chatErrorText', () => {
  it('reads the server error of a refused request and passes stream errors through', () => {
    expect(chatErrorText(new Error('{"error":"No model configured"}'))).toBe('No model configured');
    expect(chatErrorText(new Error('invalid x-api-key'))).toBe('invalid x-api-key');
  });
});

describe('chatActivity', () => {
  const assistant = (...parts: { type: string; state?: string; text?: string }[]) => [
    { role: 'user', parts: [{ type: 'text', text: 'Go' }] },
    { role: 'assistant', parts },
  ];

  it('says nothing when the chat is idle or failed', () => {
    expect(chatActivity(assistant({ type: 'text', state: 'done', text: 'Done.' }), 'ready')).toBeNull();
    expect(chatActivity([], 'error')).toBeNull();
  });

  it('thinks before the first token and at the start of a step', () => {
    expect(chatActivity([{ role: 'user', parts: [{ type: 'text', text: 'Go' }] }], 'submitted')).toBe('Thinking');
    expect(chatActivity([{ role: 'user', parts: [{ type: 'text', text: 'Go' }] }], 'streaming')).toBe('Thinking');
    expect(chatActivity(assistant({ type: 'step-start' }), 'streaming')).toBe('Thinking');
  });

  it('stays quiet while a tool runs and reads the result once it returned', () => {
    expect(chatActivity(assistant({ type: 'tool-write_definition', state: 'input-streaming' }), 'streaming')).toBeNull();
    expect(chatActivity(assistant({ type: 'tool-write_definition', state: 'input-available' }), 'streaming')).toBeNull();
    expect(chatActivity(assistant({ type: 'tool-write_definition', state: 'output-available' }), 'streaming')).toBe('Reading the result');
    expect(chatActivity(assistant({ type: 'dynamic-tool', state: 'output-error' }), 'streaming')).toBe('Reading the result');
  });

  it('stays quiet while text or reasoning streams in, and thinks during hidden reasoning', () => {
    expect(chatActivity(assistant({ type: 'text', state: 'streaming', text: 'The' }), 'streaming')).toBeNull();
    expect(chatActivity(assistant({ type: 'reasoning', state: 'streaming', text: 'Look at page 1' }), 'streaming')).toBeNull();
    expect(chatActivity(assistant({ type: 'reasoning', state: 'streaming', text: '' }), 'streaming')).toBe('Thinking');
    expect(chatActivity(assistant({ type: 'text', state: 'done', text: 'Saved.' }), 'streaming')).toBe('Thinking');
  });
});
