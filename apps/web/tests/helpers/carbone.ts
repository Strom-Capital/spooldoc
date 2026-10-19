import { prepareHtml, type DocumentRender } from '@spooldoc/core';
import { vi } from 'vitest';
import type { DocumentRenderer } from '@/lib/server/documents';

/** What the fake Carbone answers for every PDF. */
export const PDF_BYTES = new TextEncoder().encode('%PDF-1.7 fixed');

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function valueAt(data: unknown, path: string): unknown {
  let current = data;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Stands in for Carbone, so no test needs a server: a PDF is `PDF_BYTES`; a DOCX is the
 * Word template as it was sent, tags and all; HTML is the template as Spooldoc would send
 * it, with plain `{d.path}` tags filled in (no loops or formatters). The calls say what
 * Spooldoc sent. Carbone itself is tested in packages/core/tests/carbone-live.test.ts.
 */
export const fakeCarbone = vi.fn<(input: DocumentRender) => Promise<Uint8Array>>(async (input) => {
  if (input.format === 'pdf') return PDF_BYTES;
  if (input.kind === 'docx') return input.template;
  const html = prepareHtml(input.template, { asset: input.asset }).replace(/\{d\.([\w.]+)\}/g, (_tag, path: string) => {
    const value = valueAt(input.data, path);
    return value === null || value === undefined || typeof value === 'object' ? '' : escape(String(value));
  });
  return new TextEncoder().encode(html);
});

/** The fake as the renderer type the server uses. */
export const fakeRenderer: DocumentRenderer = (input) => fakeCarbone(input);
