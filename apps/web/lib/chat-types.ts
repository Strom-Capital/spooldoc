/**
 * Results of the chat tools, shared by the server (lib/server/chat.ts) and the chat panel.
 * Nothing here holds a session, a key or an absolute path.
 */

import type { Format, TemplateKind } from './job-spec';

/** Names of the tools the model can call. */
export const CHAT_TOOL_NAMES = [
  'read_sample_page',
  'write_definition',
  'write_template',
  'write_word_template',
  'read_word_template',
  'edit_word_template',
  'render_preview',
  'add_template',
  'remove_template',
  'list_jobs',
  'read_job_files',
  'read_carbone_reference',
  'ask_user',
] as const;
export type ChatToolName = (typeof CHAT_TOOL_NAMES)[number];

/** Tools whose result changes what the workbench shows. */
export const SYNC_TOOLS: readonly ChatToolName[] = [
  'write_definition',
  'write_template',
  'write_word_template',
  'edit_word_template',
  'render_preview',
  'add_template',
  'remove_template',
];

/** A tool call that could not do its work; the model reads `error` and tries again. */
export interface ToolFailure {
  ok: false;
  error: string;
}

/** `read_sample_page`. */
export type ReadPageResult = { page: number; of: number; lines: string } | ToolFailure;

/** One top-level field of the first page group after extraction. */
export interface FieldReport {
  name: string;
  status: 'found' | 'missing' | 'empty';
  /** The value in the first page group (masked when masking is on). Tables show the row count. */
  value: string;
}

/** `write_definition`. */
export type WriteDefinitionResult =
  | {
      ok: true;
      type: string;
      path: string;
      pageGroups: number;
      fields: FieldReport[];
      missing: string[];
      warnings: string[];
      preview: string;
    }
  | ToolFailure;

/** One of the job's templates as the tools report it. */
export interface TemplateListing {
  id: string;
  name: string;
  formats: Format[];
  /** An HTML template, or a Word template. */
  kind: TemplateKind;
  /** `starter` when the template has no content of its own yet. */
  content: 'saved' | 'starter';
}

/** `write_template`: `template` is the name of the template written, `templateId` its id. */
export type WriteTemplateResult =
  | { ok: boolean; path: string; template: string; templateId: string; errors: string[]; warnings: string[]; textPreview: string }
  | ToolFailure;

/**
 * What the model was shown of a rendered Word template, besides its text: a PDF of every
 * page, a PNG of page 1 when the document has more pages than a preview takes, or nothing
 * when the model takes no files or the render failed.
 */
export type WordView = 'pdf' | 'png' | null;

/** A Word template file the agent made, as tool results report it. */
export interface WordFileListing {
  id: string;
  name: string;
  size: number;
}

/**
 * `write_word_template` and `edit_word_template`: the file saved, the tag check's and
 * Carbone's errors, the text of the first document and what the model was shown of it.
 */
export type WordTemplateResult =
  | {
      ok: boolean;
      template: string;
      templateId: string;
      file: WordFileListing;
      errors: string[];
      textPreview: string;
      view: WordView;
      /** Pages of the first document, when it was rendered to PDF. */
      pages: number | null;
      /** Why the model sees less than every page, when it does. */
      note?: string;
    }
  | ToolFailure;

/** `read_word_template`: the parts of the file, or one part's XML from `from`. */
export type ReadWordTemplateResult =
  | { ok: true; template: string; file: string | null; parts: { name: string; size: number }[] }
  | { ok: true; template: string; file: string | null; part: string; size: number; from: number; xml: string; more: boolean }
  | ToolFailure;

/** `add_template` and `remove_template`: the template added or removed, and the job's templates after. */
export type TemplateChangeResult = { ok: true; template: TemplateListing; templates: TemplateListing[] } | ToolFailure;

/** `render_preview`. */
export type RenderPreviewResult =
  | {
      ok: true;
      /** The name of the template rendered. */
      template: string;
      templateId: string;
      pageGroup: number;
      pageGroups: number;
      /** `starter` when the template has no content of its own yet and the starter was used. */
      content: 'saved' | 'starter';
      hits: { found: number; missing: number; empty: number };
      missing: string[];
      templateErrors: string[];
      textPreview: string;
      /** For a Word template: what the model was shown of the document, its pages and why it sees less. */
      view?: WordView;
      pages?: number | null;
      note?: string;
    }
  | ToolFailure;

/** One of the other jobs, as `list_jobs` reports it. */
export interface JobListing {
  id: string;
  name: string;
  /** The `type` of its definition, or null when it has none or it does not parse. */
  type: string | null;
  /** The names of its templates. */
  templates: string[];
  /** True when any of its templates has content of its own (not the starter). */
  hasOwnContent: boolean;
}

/** `list_jobs`. */
export type ListJobsResult = { ok: true; jobs: JobListing[] } | ToolFailure;

/**
 * One template of another job: its name, formats and content. `html` is an HTML template's
 * text, `fileId` a Word template's file; null for the starter.
 */
export interface JobTemplateFiles {
  id: string;
  name: string;
  formats: Format[];
  kind: TemplateKind;
  html: string | null;
  fileId: string | null;
}

/** `read_job_files`. */
export type ReadJobFilesResult = { ok: true; id: string; name: string; definitionYaml: string | null; templates: JobTemplateFiles[] } | ToolFailure;

/** `read_carbone_reference`: one reference file of the Carbone Skill. */
export type ReadCarboneReferenceResult = { ok: true; name: string; text: string } | ToolFailure;

/** One answer `ask_user` offers: a short label, and a line on what it means. */
export interface AskUserOption {
  label: string;
  description?: string;
  /** The answer the agent recommends. Only the first may be. */
  recommended?: boolean;
}

/** What `ask_user` takes: a question and 2 to 4 answers, shown as buttons. */
export interface AskUserInput {
  question: string;
  options: AskUserOption[];
}

/** `ask_user`: the question is on screen, and the answer comes in the user's next message. */
export type AskUserResult = { ok: true; asked: true } | ToolFailure;
