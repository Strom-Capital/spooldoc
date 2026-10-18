import 'server-only';

import { documentName, pageLayout, parseDefinition, renderTemplate, type Definition, type Sample } from '@spooldoc/core';
import { loadPdf } from './pdf';

/** One rendered document: its file name (without extension) and HTML. */
export interface RenderedDocument {
  index: number;
  name: string;
  html: string;
}

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

/**
 * Render every document of a sample to HTML.
 *
 * @throws Error with the template errors when a document does not render
 */
export function renderDocuments(def: Definition, html: string, documents: Record<string, unknown>[], sample: Sample): RenderedDocument[] {
  return documents.map((doc, index) => {
    const rendered = renderTemplate(html, { doc, documents, sample: { id: sample.id, splf: sample.splf } });
    if (rendered.errors.length > 0) {
      throw new Error(`Document ${index + 1}: ${rendered.errors.join('; ')}`);
    }
    return { index, name: fileNameFor(def, doc, index, sample.splf.name.toLowerCase()), html: rendered.html };
  });
}

/**
 * A rendered document as PDF bytes. A4, landscape for pages wider than 160 columns,
 * unless the template sets `@page { size }`.
 *
 * @throws PdfUnavailableError without Chromium, PdfTimeoutError, or a render error
 */
export async function htmlToPdf(html: string, pageWidth: number): Promise<Uint8Array> {
  const layout = pageLayout(html, pageWidth);
  const { renderPdf } = await loadPdf();
  return renderPdf(html, { format: layout.format, landscape: layout.landscape });
}

/** Parse a definition, or null when it does not parse. */
export function tryDefinition(yaml: string): Definition | null {
  try {
    return parseDefinition(yaml);
  } catch {
    return null;
  }
}
