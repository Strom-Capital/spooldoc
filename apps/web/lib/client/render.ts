import type { CodePageSource, ExtractResult, FieldHit, Sample, SamplePage } from '@spooldoc/core';

export type { FieldHit, SamplePage };

/** A sample as the API returns it: no raw bytes, with where its code page came from. */
export type SampleView = Omit<Sample, 'rawBase64'> & { codePageSource: CodePageSource | null };

/** `GET/POST /api/render/[id]`. Mirrors lib/server/render.ts. */
export interface RenderResult {
  sample: SampleView;
  definition?: { type: string; yaml: string; error?: string };
  template?: { html: string; error?: string; generated?: boolean };
  extract?: ExtractResult;
  /** One name per extracted document, from the definition output name. */
  names?: string[];
  html?: string;
  document: number;
  /** Why the definition's `match` rules do not accept this file (runs skip such files). */
  mismatch?: string[];
  errors: string[];
}

/** Dense text lines of a page: blank lines filled in, padded to `width`. Same as core's `pageText`. */
export function pageLines(page: SamplePage, width: number): string[] {
  const last = page.lines.reduce((max, line) => Math.max(max, line.no), 0);
  const byNo = new Map(page.lines.map((line) => [line.no, line.text]));
  const out: string[] = [];
  for (let n = 1; n <= last; n++) {
    out.push((byNo.get(n) ?? '').padEnd(width, ' '));
  }
  return out;
}

/** A stable key for a hit. */
export function hitKey(hit: FieldHit): string {
  return `${hit.document}:${hit.name}:${hit.page}:${hit.line}:${hit.column}`;
}

/** `documents[0].invoiceNo = 260101` */
export function hitLabel(hit: FieldHit): string {
  return `documents[${hit.document}].${hit.name} = ${hit.value || (hit.status === 'missing' ? '(missing)' : '(empty)')}`;
}

/** The `type:` value of definition YAML, read with a regular expression (no YAML parser in the browser). */
export function yamlType(yaml: string): string | null {
  const match = /^type:\s*["']?([a-z0-9-]+)["']?\s*(#.*)?$/m.exec(yaml);
  return match?.[1] ?? null;
}
