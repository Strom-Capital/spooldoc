import 'server-only';

import { convertNunjucks, documentName, parseDefinition, renderDocument, starterTemplate, type Definition, type DocumentRender } from '@spooldoc/core';
import { log } from './log';
import { carboneServer, noteRenderFailure, renderingReady } from './rendering';

/**
 * The file name of a document: the definition's `output.name`, or `<fallback>-<n>`.
 */
export function fileNameFor(def: Definition | null, doc: Record<string, unknown>, index: number, fallback: string): string {
  if (def?.output?.name) {
    try {
      return documentName(def, doc, index);
    } catch {
      // keep the fallback
    }
  }
  return `${fallback}-${index + 1}`;
}

/** The Carbone template of an output: its own, converted from Nunjucks if it is from before Carbone, or the starter template. */
export function outputTemplate(source: string | null | undefined, def: Definition): string {
  return source === null || source === undefined ? starterTemplate(def) : convertNunjucks(source);
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
