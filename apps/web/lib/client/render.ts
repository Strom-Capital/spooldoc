import type {
  CodePageSource,
  DocxProblem,
  ExtractResult,
  FieldHit,
  LookupMiss,
  LookupProblem,
  LookupTrace,
  PageRange,
  Sample,
  SamplePage,
  TemplateProblem,
  XlsxProblem,
} from '@spooldoc/core';
import type { XlsxScope } from '@/lib/job-spec';
import type { TemplateFileView } from '@/lib/types';

export type { FieldHit, SamplePage };

/** A sample as the API returns it: no raw bytes, with where its code page came from. */
export type SampleView = Omit<Sample, 'rawBase64'> & { codePageSource: CodePageSource | null };

/** `GET/POST /api/render/[id]`. Mirrors lib/server/render.ts. */
export interface RenderResult {
  sample: SampleView;
  definition?: { type: string; yaml: string; error?: string };
  /**
   * The template and what is wrong with it: `problems` from Spooldoc's tag check (by line
   * for HTML, by part for Word, by sheet and cell for Excel), or `error` from Carbone with
   * its own text in `detail`. An Excel template also says which sheets have no page setup.
   */
  template?:
    | { kind: 'html'; html: string; error?: string; detail?: string; problems?: TemplateProblem[]; generated?: boolean }
    | { kind: 'docx'; file: TemplateFileView | null; error?: string; detail?: string; problems?: DocxProblem[]; generated?: boolean }
    | {
        kind: 'xlsx';
        file: TemplateFileView | null;
        scope: XlsxScope;
        noPageSetup?: string[];
        error?: string;
        detail?: string;
        problems?: XlsxProblem[];
        generated?: boolean;
      };
  /** Carbone is not connected or did not answer, so nothing was rendered. */
  carbone?: { error: string; detail?: string };
  extract?: ExtractResult;
  /** The name of each page group's document, from the definition's output name. */
  names?: string[];
  /** The rendered HTML, from an HTML template. */
  html?: string;
  /** The rendered PDF in base64, from a Word or Excel template. */
  pdf?: string;
  /** 0-based index of the rendered page group. */
  pageGroup: number;
  /** Why the definition's `match` rules do not accept this file (runs skip such files). */
  mismatch?: string[];
  /** The job's lookups for the page group shown, when it has some. */
  lookups?: LookupsPreview;
  errors: string[];
}

/** What the preview shows of the lookups of one page group. Mirrors lib/server/lookups.ts. */
export interface LookupsPreview {
  /** Each time a lookup ran for the page group shown. */
  traces: LookupTrace[];
  /** Lookups that found no row in it and warn. */
  misses: LookupMiss[];
  /** What is wrong with the lookups, checked without the IBM i. */
  problems: LookupProblem[];
  /** The lookups that ran: the ones before the first that is untested. */
  ran: string[];
  /** The page group shown, with the lookups' values. */
  pageGroup?: Record<string, unknown>;
  error?: { message: string; lookup?: string; code?: string; detail?: string };
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
  return `${hit.pageGroup}:${hit.name}:${hit.page}:${hit.line}:${hit.column}`;
}

/**
 * The page group `page` is printed in: `current` when it is one of them (XML page groups can
 * share a page), else the first. -1 when the page is in none, like a skipped first page.
 */
export function groupOfPage(ranges: PageRange[], page: number, current: number): number {
  const fits = (range: PageRange | undefined) => !!range && page >= range.first && page <= range.last;
  return fits(ranges[current]) ? current : ranges.findIndex(fits);
}

/**
 * A field hit as the tag a template writes, with its page group, since a page can hold
 * more than one: `Page group 1: d.pg.invoiceNo = 260101`.
 */
export function hitLabel(hit: FieldHit): string {
  return `Page group ${hit.pageGroup + 1}: d.pg.${hit.name} = ${hit.value || (hit.status === 'missing' ? '(missing)' : '(empty)')}`;
}

/** The `type:` value of definition YAML, read with a regular expression (no YAML parser in the browser). */
export function yamlType(yaml: string): string | null {
  const match = /^type:\s*["']?([a-z0-9-]+)["']?\s*(#.*)?$/m.exec(yaml);
  return match?.[1] ?? null;
}
