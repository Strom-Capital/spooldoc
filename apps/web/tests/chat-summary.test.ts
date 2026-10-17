import { describe, expect, it } from 'vitest';
import { chatErrorText, savedFile, toolSummary } from '@/lib/client/chat';

const done = (toolName: string, output: unknown, input: unknown = {}) => ({ toolName, state: 'output-available', input, output });

describe('toolSummary', () => {
  it('summarizes each tool in one line', () => {
    expect(toolSummary(done('read_sample_page', { page: 4, of: 8, lines: '' })).text).toBe('Read page 4');
    expect(
      toolSummary(done('write_definition', { ok: true, type: 'invoice', documents: 6, missing: ['a', 'b'], fields: [], warnings: [], preview: '' })),
    ).toEqual({ text: 'Wrote definition invoice: 6 documents, 2 missing', tone: 'warn' });
    expect(toolSummary(done('write_template', { ok: true, path: 'templates/invoice.html', errors: [], warnings: [], textPreview: '' })).text).toBe(
      'Wrote template: no errors',
    );
    expect(
      toolSummary(
        done('render_preview', { ok: true, document: 0, documents: 6, template: 'saved', hits: { found: 37, missing: 0, empty: 2 }, missing: [], templateErrors: [], textPreview: '' }),
      ),
    ).toEqual({ text: 'Rendered: 37 found, 0 missing', tone: 'ok' });
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
  });
});

describe('chatErrorText', () => {
  it('reads the server error of a refused request and passes stream errors through', () => {
    expect(chatErrorText(new Error('{"error":"No model configured"}'))).toBe('No model configured');
    expect(chatErrorText(new Error('invalid x-api-key'))).toBe('invalid x-api-key');
  });
});
