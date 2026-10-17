/**
 * Results of the chat tools, shared by the server (lib/server/chat.ts) and the chat panel.
 * Nothing here holds a session, a key or an absolute path.
 */

/** Names of the tools the model can call. */
export const CHAT_TOOL_NAMES = ['read_sample_page', 'write_definition', 'write_template', 'render_preview'] as const;
export type ChatToolName = (typeof CHAT_TOOL_NAMES)[number];

/** Tools whose result changes what the workbench shows. */
export const SYNC_TOOLS: readonly ChatToolName[] = ['write_definition', 'write_template', 'render_preview'];

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

/** `write_template`. */
export type WriteTemplateResult =
  | { ok: boolean; path: string; errors: string[]; warnings: string[]; textPreview: string }
  | ToolFailure;

/** `render_preview`. */
export type RenderPreviewResult =
  | {
      ok: true;
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
