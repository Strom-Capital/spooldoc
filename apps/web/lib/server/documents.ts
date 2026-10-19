import 'server-only';

import { documentName, parseDefinition, renderDocument, starterTemplate, type Definition, type DocumentRender } from '@spooldoc/core';
import type { TemplateContent } from '@/lib/job-spec';
import { log } from './log';
import type { SampleTemplate } from './render';
import { carboneServer, noteRenderFailure, renderingReady } from './rendering';
import { getTemplateFile } from './template-files';

/**
 * The file name of the document of a page group: the definition's `output.name`, or `<fallback>-<n>`.
 */
export function fileNameFor(def: Definition | null, pageGroup: Record<string, unknown>, index: number, fallback: string): string {
  if (def?.output?.name) {
    try {
      return documentName(def, pageGroup, index);
    } catch {
      // keep the fallback
    }
  }
  return `${fallback}-${index + 1}`;
}

/** The HTML of a template: its own, or the starter template. */
export function templateHtml(source: string | null | undefined, def: Definition): string {
  return source === null || source === undefined ? starterTemplate(def) : source;
}

/**
 * A template's content as `renderSample` takes it: HTML as it is, a Word template with
 * its file read. Null when the Word file is gone.
 */
export async function sampleTemplate(template: TemplateContent): Promise<SampleTemplate | null> {
  if (template.kind === 'html') return { kind: 'html', source: template.source };
  if (template.fileId === null) return { kind: 'docx', file: null };
  const file = await getTemplateFile(template.fileId);
  return file ? { kind: 'docx', file } : null;
}

/** Renders one document to a file. */
export type DocumentRenderer = (input: DocumentRender) => Promise<Uint8Array>;

let override: DocumentRenderer | null = null;

/** Render with something else than Carbone, for tests. Null goes back to Carbone. */
export function setDocumentRenderer(next: DocumentRenderer | null): void {
  override = next;
}

/**
 * A renderer for the Carbone server set in Settings, for one run or preview. A render
 * that can't reach Carbone, or that Carbone refuses, is noted, so Settings and the setup
 * checklist show it.
 *
 * @throws CarboneError when no Carbone server can be used, such as Carbone Cloud without a key
 */
export async function documentRenderer(): Promise<DocumentRenderer> {
  if (override) return override;
  const server = await carboneServer();
  return async (input) => {
    try {
      return await renderDocument(server, input);
    } catch (error) {
      await noteRenderFailure(error);
      throw error;
    }
  };
}

/**
 * The renderer for a workbench preview, or null when the last check found Carbone not
 * working: with no working Carbone server there is no render to try.
 */
export async function previewRenderer(): Promise<DocumentRenderer | null> {
  if (override) return override;
  if (!(await renderingReady())) return null;
  try {
    return await documentRenderer();
  } catch (error) {
    log.warn('Could not use Carbone for a preview', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** Parse a definition, or null when it does not parse. */
export function tryDefinition(yaml: string): Definition | null {
  try {
    return parseDefinition(yaml);
  } catch {
    return null;
  }
}
