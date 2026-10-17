import type { ReadPageResult, RenderPreviewResult, WriteDefinitionResult, WriteTemplateResult } from '@/lib/chat-types';

/** What `toolSummary` reads from a tool part. */
export interface ToolPartLike {
  toolName: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

/** One line for a tool call, and how it went. */
export interface ToolSummary {
  text: string;
  tone: 'running' | 'ok' | 'warn' | 'error';
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const firstLine = (text: string): string => {
  const line = text.split('\n').find((l) => l.trim() && !/^Invalid definition:$/.test(l.trim())) ?? text;
  return line.replace(/^\s*-\s*/, '').slice(0, 120);
};

const done = (state: string): boolean => state === 'output-available';

/**
 * The one-line summary of a chat tool call, such as
 * "Wrote definition invoice: 6 documents, 2 missing" or "Read page 4".
 *
 * @param part - The tool name, state, input and output of a tool UI part
 */
export function toolSummary(part: ToolPartLike): ToolSummary {
  if (part.state === 'output-error' || part.state === 'output-denied') {
    return { text: `${part.toolName} failed${part.errorText ? `: ${firstLine(part.errorText)}` : ''}`, tone: 'error' };
  }
  const input = (part.input ?? {}) as { page?: number; document?: number };
  switch (part.toolName) {
    case 'read_sample_page': {
      if (!done(part.state)) return { text: `Reading page ${input.page ?? ''}`.trim(), tone: 'running' };
      const out = part.output as ReadPageResult;
      return 'ok' in out ? { text: firstLine(out.error), tone: 'warn' } : { text: `Read page ${out.page}`, tone: 'ok' };
    }
    case 'write_definition': {
      if (!done(part.state)) return { text: 'Writing definition', tone: 'running' };
      const out = part.output as WriteDefinitionResult;
      if (!out.ok) return { text: `Definition not saved: ${firstLine(out.error)}`, tone: 'warn' };
      return {
        text: `Wrote definition ${out.type}: ${plural(out.documents, 'document')}, ${out.missing.length} missing`,
        tone: out.missing.length > 0 || out.documents === 0 ? 'warn' : 'ok',
      };
    }
    case 'write_template': {
      if (!done(part.state)) return { text: 'Writing template', tone: 'running' };
      const out = part.output as WriteTemplateResult;
      if (!('path' in out)) return { text: `Template not saved: ${firstLine(out.error)}`, tone: 'warn' };
      return out.errors.length === 0
        ? { text: 'Wrote template: no errors', tone: 'ok' }
        : { text: `Wrote template: ${plural(out.errors.length, 'error')}`, tone: 'warn' };
    }
    case 'render_preview': {
      if (!done(part.state)) return { text: 'Rendering', tone: 'running' };
      const out = part.output as RenderPreviewResult;
      if (!out.ok) return { text: `Not rendered: ${firstLine(out.error)}`, tone: 'warn' };
      const errors = out.templateErrors.length > 0 ? `, ${plural(out.templateErrors.length, 'template error')}` : '';
      return {
        text: `Rendered: ${out.hits.found} found, ${out.hits.missing} missing${errors}`,
        tone: out.hits.missing > 0 || errors ? 'warn' : 'ok',
      };
    }
    default:
      return { text: done(part.state) ? part.toolName : `Running ${part.toolName}`, tone: done(part.state) ? 'ok' : 'running' };
  }
}

/** True when a finished tool call saved a file, so the editors should drop their drafts. */
export function savedFile(part: ToolPartLike): 'yaml' | 'html' | null {
  if (!done(part.state)) return null;
  const out = (part.output ?? {}) as { ok?: boolean; path?: string };
  if (part.toolName === 'write_definition' && out.ok === true) return 'yaml';
  if (part.toolName === 'write_template' && typeof out.path === 'string') return 'html';
  return null;
}

/** The text of a chat error: the server's `{ error }` for a refused request, or the stream's message. */
export function chatErrorText(error: Error): string {
  try {
    const parsed = JSON.parse(error.message) as { error?: unknown };
    if (typeof parsed.error === 'string' && parsed.error) {
      return parsed.error;
    }
  } catch {
    // Not JSON: an error from the stream.
  }
  return error.message || 'The chat request failed.';
}
