import type {
  ListJobsResult,
  ReadCarboneReferenceResult,
  OutputChangeResult,
  ReadJobFilesResult,
  ReadPageResult,
  ReadWordTemplateResult,
  RenderPreviewResult,
  WordTemplateResult,
  WriteDefinitionResult,
  WriteTemplateResult,
} from '@/lib/chat-types';

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
        ? { text: `Wrote template of ${out.output}: no errors`, tone: 'ok' }
        : { text: `Wrote template of ${out.output}: ${plural(out.errors.length, 'error')}`, tone: 'warn' };
    }
    case 'write_word_template':
    case 'edit_word_template': {
      const verb = part.toolName === 'write_word_template' ? 'Designed' : 'Edited';
      if (!done(part.state)) return { text: part.toolName === 'write_word_template' ? 'Designing a Word template' : 'Editing the Word template', tone: 'running' };
      const out = part.output as WordTemplateResult;
      if (!('file' in out)) return { text: `Word template not saved: ${firstLine(out.error)}`, tone: 'warn' };
      const seen = out.view === 'pdf' ? `, looked at ${plural(out.pages ?? 1, 'page')}` : out.view === 'png' ? ', looked at page 1' : '';
      return out.errors.length === 0
        ? { text: `${verb} ${out.file.name} for ${out.output}${seen}`, tone: 'ok' }
        : { text: `${verb} ${out.file.name} for ${out.output}: ${plural(out.errors.length, 'error')}`, tone: 'warn' };
    }
    case 'read_word_template': {
      if (!done(part.state)) return { text: 'Reading the Word template', tone: 'running' };
      const out = part.output as ReadWordTemplateResult;
      if (!out.ok) return { text: firstLine(out.error), tone: 'warn' };
      const name = out.file ?? 'the starter template';
      return 'part' in out ? { text: `Read ${out.part} of ${name}`, tone: 'ok' } : { text: `Read the parts of ${name}`, tone: 'ok' };
    }
    case 'render_preview': {
      if (!done(part.state)) return { text: 'Rendering', tone: 'running' };
      const out = part.output as RenderPreviewResult;
      if (!out.ok) return { text: `Not rendered: ${firstLine(out.error)}`, tone: 'warn' };
      const errors = out.templateErrors.length > 0 ? `, ${plural(out.templateErrors.length, 'template error')}` : '';
      return {
        text: `Rendered ${out.output}: ${out.hits.found} found, ${out.hits.missing} missing${errors}`,
        tone: out.hits.missing > 0 || errors ? 'warn' : 'ok',
      };
    }
    case 'add_output': {
      if (!done(part.state)) return { text: 'Adding an output', tone: 'running' };
      const out = part.output as OutputChangeResult;
      if (!out.ok) return { text: `Output not added: ${firstLine(out.error)}`, tone: 'warn' };
      return { text: `Added output ${out.output.label}: ${out.output.formats.map((f) => f.toUpperCase()).join(' and ')}`, tone: 'ok' };
    }
    case 'remove_output': {
      if (!done(part.state)) return { text: 'Removing an output', tone: 'running' };
      const out = part.output as OutputChangeResult;
      if (!out.ok) return { text: `Output not removed: ${firstLine(out.error)}`, tone: 'warn' };
      return { text: `Removed output ${out.output.label}`, tone: 'ok' };
    }
    case 'list_jobs': {
      if (!done(part.state)) return { text: 'Listing jobs', tone: 'running' };
      const out = part.output as ListJobsResult;
      if (!out.ok) return { text: firstLine(out.error), tone: 'warn' };
      return { text: `Listed ${plural(out.jobs.length, 'other job')}`, tone: 'ok' };
    }
    case 'read_job_files': {
      if (!done(part.state)) return { text: 'Reading another job', tone: 'running' };
      const out = part.output as ReadJobFilesResult;
      if (!out.ok) return { text: firstLine(out.error), tone: 'warn' };
      const templates = out.outputs.filter((output) => output.templateHtml !== null).length;
      const files = [out.definitionYaml !== null && 'definition', templates > 0 && plural(templates, 'template')].filter(Boolean);
      return { text: `Read job ${out.name}: ${files.length > 0 ? files.join(' and ') : 'no files yet'}`, tone: 'ok' };
    }
    case 'read_carbone_reference': {
      const name = (part.input as { name?: string } | undefined)?.name ?? '';
      if (!done(part.state)) return { text: `Reading the Carbone reference ${name}`.trim(), tone: 'running' };
      const out = part.output as ReadCarboneReferenceResult;
      if (!out.ok) return { text: firstLine(out.error), tone: 'warn' };
      return { text: `Read the Carbone reference ${out.name}`, tone: 'ok' };
    }
    default:
      return { text: done(part.state) ? part.toolName : `Running ${part.toolName}`, tone: done(part.state) ? 'ok' : 'running' };
  }
}

/** What a finished tool call changed in the draft, so the editors should drop their drafts: null when nothing. */
export function savedFile(part: ToolPartLike): 'yaml' | 'html' | 'outputs' | null {
  if (!done(part.state)) return null;
  const out = (part.output ?? {}) as { ok?: boolean; path?: string };
  if (part.toolName === 'write_definition' && out.ok === true) return 'yaml';
  if (part.toolName === 'write_template' && typeof out.path === 'string') return 'html';
  if ((part.toolName === 'write_word_template' || part.toolName === 'edit_word_template') && typeof (part.output as { file?: unknown }).file === 'object') return 'outputs';
  if ((part.toolName === 'add_output' || part.toolName === 'remove_output') && out.ok === true) return 'outputs';
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

/** The parts of a chat message `chatActivity` looks at. */
export interface MessageLike {
  role: string;
  parts: { type: string; state?: string; text?: string }[];
}

/**
 * What to say while the chat is busy but nothing on screen is moving: before the first
 * token, between steps (after a tool returned, while the model decides what is next) and
 * while hidden reasoning runs. Null when the user can already see progress (a tool
 * running, text or reasoning streaming in) or the chat is idle.
 *
 * @param messages - The chat messages
 * @param status - The chat status from useChat
 */
export function chatActivity(messages: MessageLike[], status: string): string | null {
  if (status === 'submitted') {
    return 'Thinking';
  }
  if (status !== 'streaming') {
    return null;
  }
  const last = messages.at(-1);
  const part = last?.role === 'assistant' ? last.parts.at(-1) : undefined;
  if (!part || part.type === 'step-start') {
    return 'Thinking';
  }
  if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
    // A running tool shows its own spinner; once it returned, the model reads the result.
    return part.state === 'input-streaming' || part.state === 'input-available' ? null : 'Reading the result';
  }
  if (part.type === 'text' || part.type === 'reasoning') {
    // Streaming text is visible progress; empty (hidden) reasoning is not.
    return part.state === 'streaming' && part.text?.trim() ? null : 'Thinking';
  }
  return 'Working';
}
