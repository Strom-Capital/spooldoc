import type {
  AskUserInput,
  AskUserOption,
  AskUserResult,
  ListJobsResult,
  ReadCarboneReferenceResult,
  ReadJobFilesResult,
  ReadPageResult,
  FileTemplateResult,
  ReadFileTemplateResult,
  RenderPreviewResult,
  TemplateChangeResult,
  WriteDefinitionResult,
  WriteTemplateResult,
} from '@/lib/chat-types';
import { formatList, KIND_NAMES } from '@/lib/job-spec';

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
 * "Wrote definition invoice: 6 page groups, 2 missing" or "Read page 4".
 *
 * @param part - The tool name, state, input and output of a tool UI part
 */
export function toolSummary(part: ToolPartLike): ToolSummary {
  if (part.state === 'output-error' || part.state === 'output-denied') {
    return { text: `${part.toolName} failed${part.errorText ? `: ${firstLine(part.errorText)}` : ''}`, tone: 'error' };
  }
  const input = (part.input ?? {}) as { page?: number };
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
        text: `Wrote definition ${out.type}: ${plural(out.pageGroups, 'page group')}, ${out.missing.length} missing`,
        tone: out.missing.length > 0 || out.pageGroups === 0 ? 'warn' : 'ok',
      };
    }
    case 'write_template': {
      if (!done(part.state)) return { text: 'Writing template', tone: 'running' };
      const out = part.output as WriteTemplateResult;
      if (!('path' in out)) return { text: `Template not saved: ${firstLine(out.error)}`, tone: 'warn' };
      return out.errors.length === 0
        ? { text: `Wrote ${out.template}: no errors`, tone: 'ok' }
        : { text: `Wrote ${out.template}: ${plural(out.errors.length, 'error')}`, tone: 'warn' };
    }
    case 'write_word_template':
    case 'edit_word_template':
    case 'write_excel_template':
    case 'edit_excel_template': {
      const app = part.toolName.includes('excel') ? 'Excel' : 'Word';
      const write = part.toolName.startsWith('write_');
      if (!done(part.state)) return { text: write ? `Designing ${app === 'Excel' ? 'an' : 'a'} ${app} template` : `Editing the ${app} template`, tone: 'running' };
      const out = part.output as FileTemplateResult;
      if (!('file' in out)) return { text: `${app} template not saved: ${firstLine(out.error)}`, tone: 'warn' };
      const verb = write ? 'Designed' : 'Edited';
      const seen = out.view === 'pdf' ? `, looked at ${plural(out.shownPages ?? out.pages ?? 1, 'page')}` : out.view === 'png' ? ', looked at page 1' : '';
      const errorCells = out.errorCells ? `, ${plural(out.errorCells, 'formula error')}` : '';
      if (out.errors.length > 0) return { text: `${verb} ${out.file.name} for ${out.template}: ${plural(out.errors.length, 'error')}`, tone: 'warn' };
      return { text: `${verb} ${out.file.name} for ${out.template}${seen}${errorCells}`, tone: errorCells ? 'warn' : 'ok' };
    }
    case 'read_word_template':
    case 'read_excel_template': {
      const app = part.toolName === 'read_excel_template' ? 'Excel' : 'Word';
      if (!done(part.state)) return { text: `Reading the ${app} template`, tone: 'running' };
      const out = part.output as ReadFileTemplateResult;
      if (!out.ok) return { text: firstLine(out.error), tone: 'warn' };
      const name = out.file ?? 'the starter template';
      if (!('part' in out)) return { text: `Read the parts of ${name}`, tone: 'ok' };
      return { text: `Read ${out.sheet ? `${out.sheet} (${out.part})` : out.part} of ${name}`, tone: 'ok' };
    }
    case 'render_preview': {
      if (!done(part.state)) return { text: 'Rendering', tone: 'running' };
      const out = part.output as RenderPreviewResult;
      if (!out.ok) return { text: `Not rendered: ${firstLine(out.error)}`, tone: 'warn' };
      const errors = out.templateErrors.length > 0 ? `, ${plural(out.templateErrors.length, 'template error')}` : '';
      return {
        text: `Rendered ${out.template}: ${out.hits.found} found, ${out.hits.missing} missing${errors}`,
        tone: out.hits.missing > 0 || errors ? 'warn' : 'ok',
      };
    }
    case 'add_template': {
      if (!done(part.state)) return { text: 'Adding a template', tone: 'running' };
      const out = part.output as TemplateChangeResult;
      if (!out.ok) return { text: `Template not added: ${firstLine(out.error)}`, tone: 'warn' };
      return { text: `Added ${KIND_NAMES[out.template.kind].name} ${out.template.name}: ${formatList(out.template.formats)}`, tone: 'ok' };
    }
    case 'remove_template': {
      if (!done(part.state)) return { text: 'Removing a template', tone: 'running' };
      const out = part.output as TemplateChangeResult;
      if (!out.ok) return { text: `Template not removed: ${firstLine(out.error)}`, tone: 'warn' };
      return { text: `Removed template ${out.template.name}`, tone: 'ok' };
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
      const templates = out.templates.filter((template) => template.html !== null || template.fileId !== null).length;
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
    case 'ask_user': {
      if (!done(part.state)) return { text: 'Asking a question', tone: 'running' };
      const out = part.output as AskUserResult;
      if (!out.ok) return { text: `Question not asked: ${firstLine(out.error)}`, tone: 'warn' };
      return { text: 'Asked a question', tone: 'ok' };
    }
    default:
      return { text: done(part.state) ? part.toolName : `Running ${part.toolName}`, tone: done(part.state) ? 'ok' : 'running' };
  }
}

/** The tools that save a Word or Excel file the template uses. */
const FILE_WRITES = new Set(['write_word_template', 'edit_word_template', 'write_excel_template', 'edit_excel_template']);

/** What a finished tool call changed in the draft, so the editors should drop their drafts: null when nothing. */
export function savedFile(part: ToolPartLike): 'yaml' | 'html' | 'templates' | null {
  if (!done(part.state)) return null;
  const out = (part.output ?? {}) as { ok?: boolean; path?: string };
  if (part.toolName === 'write_definition' && out.ok === true) return 'yaml';
  if (part.toolName === 'write_template' && typeof out.path === 'string') return 'html';
  if (FILE_WRITES.has(part.toolName) && typeof (part.output as { file?: unknown }).file === 'object') return 'templates';
  if ((part.toolName === 'add_template' || part.toolName === 'remove_template') && out.ok === true) return 'templates';
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
  return error.message || 'The request to the agent failed.';
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

/** A question `ask_user` put on screen: its text, and the answers to show as buttons (none when there are none to show). */
export interface AskedQuestion {
  question: string;
  options: AskUserOption[];
}

/**
 * The question of an `ask_user` call that was asked, or null while it streams in or when
 * it was turned down. Answers without a label are left out, so no empty button shows.
 *
 * @param part - The tool name, state, input and output of a tool UI part
 */
export function askedQuestion(part: ToolPartLike): AskedQuestion | null {
  if (part.toolName !== 'ask_user' || !done(part.state) || (part.output as AskUserResult | undefined)?.ok !== true) return null;
  const input = (part.input ?? {}) as Partial<AskUserInput>;
  if (typeof input.question !== 'string' || !input.question.trim()) return null;
  const options = (Array.isArray(input.options) ? input.options : []).filter(
    (option): option is AskUserOption => typeof option?.label === 'string' && option.label.trim().length > 0,
  );
  return { question: input.question, options };
}

/**
 * The answer to a question in message `index`: the text of the user's next message, or
 * null while there is none. A question is answered once, so its buttons work only before.
 *
 * @param messages - The chat messages
 * @param index - The index of the message with the question
 */
export function questionAnswer(messages: MessageLike[], index: number): string | null {
  const next = messages.slice(index + 1).find((message) => message.role === 'user');
  if (!next) return null;
  return next.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
    .trim();
}
