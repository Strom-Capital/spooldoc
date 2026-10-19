/**
 * Results of the chat tools, shared by the server (lib/server/chat.ts) and the chat panel.
 * Nothing here holds a session, a key or an absolute path.
 */

import type { OutputFormat } from './job-spec';

/** Names of the tools the model can call. */
export const CHAT_TOOL_NAMES = [
  'read_sample_page',
  'write_definition',
  'write_template',
  'render_preview',
  'add_output',
  'remove_output',
  'list_jobs',
  'read_job_files',
] as const;
export type ChatToolName = (typeof CHAT_TOOL_NAMES)[number];

/** Tools whose result changes what the workbench shows. */
export const SYNC_TOOLS: readonly ChatToolName[] = ['write_definition', 'write_template', 'render_preview', 'add_output', 'remove_output'];

/** A tool call that could not do its work; the model reads `error` and tries again. */
export interface ToolFailure {
  ok: false;
  error: string;
}

/** `read_sample_page`. */
export type ReadPageResult = { page: number; of: number; lines: string } | ToolFailure;

/** One top-level field of the first document after extraction. */
export interface FieldReport {
  name: string;
  status: 'found' | 'missing' | 'empty';
  /** The value in the first document (masked when masking is on). Tables show the row count. */
  value: string;
}

/** `write_definition`. */
export type WriteDefinitionResult =
  | {
      ok: true;
      type: string;
      path: string;
      documents: number;
      fields: FieldReport[];
      missing: string[];
      warnings: string[];
      preview: string;
    }
  | ToolFailure;

/** One of the job's outputs as the tools report it. */
export interface OutputListing {
  id: string;
  label: string;
  formats: OutputFormat[];
  /** `starter` when the output has no template of its own yet. */
  template: 'saved' | 'starter';
}

/** `write_template`. `output` is the label of the output written. */
export type WriteTemplateResult =
  | { ok: boolean; path: string; output: string; errors: string[]; warnings: string[]; textPreview: string }
  | ToolFailure;

/** `add_output` and `remove_output`: the output added or removed, and the job's outputs after. */
export type OutputChangeResult = { ok: true; output: OutputListing; outputs: OutputListing[] } | ToolFailure;

/** `render_preview`. */
export type RenderPreviewResult =
  | {
      ok: true;
      /** The label of the output rendered. */
      output: string;
      document: number;
      documents: number;
      /** `starter` when there is no saved template yet and the starter template was used. */
      template: 'saved' | 'starter';
      hits: { found: number; missing: number; empty: number };
      missing: string[];
      templateErrors: string[];
      textPreview: string;
    }
  | ToolFailure;

/** One of the other jobs, as `list_jobs` reports it. */
export interface JobListing {
  id: string;
  name: string;
  /** The `type` of its definition, or null when it has none or it does not parse. */
  type: string | null;
  /** The labels of its outputs. */
  outputs: string[];
  /** True when any of its outputs has its own template (not the starter template). */
  hasTemplate: boolean;
}

/** `list_jobs`. */
export type ListJobsResult = { ok: true; jobs: JobListing[] } | ToolFailure;

/** One output of another job: its label, formats and template (null for the starter template). */
export interface JobOutputFiles {
  id: string;
  label: string;
  formats: OutputFormat[];
  templateHtml: string | null;
}

/** `read_job_files`. */
export type ReadJobFilesResult = { ok: true; id: string; name: string; definitionYaml: string | null; outputs: JobOutputFiles[] } | ToolFailure;
