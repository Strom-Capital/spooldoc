import type { Definition, FieldAnchor, PageRule, TextField, TextSource, ValueType } from "./definition.js";
import type { Sample, SamplePage } from "./sample.js";
import { convertValue } from "./values.js";
import { extractXml } from "./xmlspool.js";

/** Where one extracted value came from. Columns and lines are 1-based; 0 when unknown. */
export interface FieldHit {
  /** 0-based index into `pageGroups`. */
  pageGroup: number;
  /** Field name, or `table[row].column` for table and record cells. */
  name: string;
  /** Sample page number. */
  page: number;
  line: number;
  column: number;
  length: number;
  /** The text exactly as printed at line/column/length. */
  value: string;
  status: "found" | "missing" | "empty";
}

/** The sample pages one page group is printed on, 1-based and inclusive. */
export interface PageRange {
  first: number;
  last: number;
}

/** Result of `extract`. */
export interface ExtractResult {
  pageGroups: Record<string, unknown>[];
  /** The pages of each page group, in the order of `pageGroups`. XML page groups can share a page. */
  pageRanges: PageRange[];
  hits: FieldHit[];
  warnings: string[];
}

interface Located {
  line: number;
  column: number;
  length: number;
  value: string;
}

/** Trims `raw` (which starts at 1-based `column`) and returns the trimmed span. */
function span(raw: string, line: number, column: number): Located {
  const lead = raw.length - raw.trimStart().length;
  const value = raw.trim();
  return { line, column: column + lead, length: value.length, value };
}

/** Finds an anchor on a page. Returns null when the label or pattern is not on the page. */
export function locateAnchor(page: SamplePage, anchor: FieldAnchor): Located | null {
  if (anchor.after !== undefined) {
    const label = anchor.after;
    for (const l of page.lines) {
      const idx = l.text.indexOf(label);
      if (idx < 0) continue;
      const start = idx + label.length;
      let raw: string;
      if (anchor.length !== undefined) {
        raw = l.text.slice(start, start + anchor.length);
      } else {
        // Value runs to the first gap of two or more spaces after it starts, or the end of the line.
        const rest = l.text.slice(start);
        const lead = rest.length - rest.trimStart().length;
        const gap = rest.slice(lead).search(/\s{2,}/);
        raw = gap < 0 ? rest : rest.slice(0, lead + gap);
      }
      return span(raw, l.no, start + 1);
    }
    return null;
  }
  if (anchor.regex !== undefined) {
    const re = new RegExp(anchor.regex, "d");
    for (const l of page.lines) {
      const m = re.exec(l.text);
      if (!m) continue;
      const group = anchor.group ?? (m.length > 1 ? 1 : 0);
      const indices = m.indices?.[group];
      const text = m[group];
      if (!indices || text === undefined) return { line: l.no, column: (m.index ?? 0) + 1, length: 0, value: "" };
      return span(text, l.no, indices[0] + 1);
    }
    return null;
  }
  if (anchor.line !== undefined && anchor.column !== undefined && anchor.length !== undefined) {
    const text = page.lines.find((l) => l.no === anchor.line)?.text ?? "";
    return span(text.slice(anchor.column - 1, anchor.column - 1 + anchor.length), anchor.line, anchor.column);
  }
  return null;
}

function pagesForRule(pages: SamplePage[], rule: PageRule | undefined): SamplePage[] {
  if (rule === undefined || rule === "first") return pages.slice(0, 1);
  if (rule === "last") return pages.slice(-1);
  if (rule === "all") return pages;
  const p = pages[rule - 1];
  return p ? [p] : [];
}

const lineMap = (page: SamplePage): Map<number, string> => new Map(page.lines.map((l) => [l.no, l.text]));

class Collector {
  readonly hits: FieldHit[] = [];
  readonly warnings: string[] = [];

  /** Records a located value, converts it and returns the typed value. */
  value(group: number, name: string, page: number, loc: Located, type: ValueType | undefined, warnEmpty: boolean): unknown {
    const status = loc.value === "" ? "empty" : "found";
    this.hits.push({ pageGroup: group, name, page, line: loc.line, column: loc.column, length: loc.length, value: loc.value, status });
    if (status === "empty" && warnEmpty) this.warnings.push(`page group ${group + 1}: field ${name} is empty (page ${page}, line ${loc.line})`);
    const { value, ok } = convertValue(loc.value, type);
    if (!ok) this.warnings.push(`page group ${group + 1}: ${name} value ${JSON.stringify(loc.value)} is not a valid ${type}`);
    return value;
  }

  missing(group: number, name: string, page: number): null {
    this.hits.push({ pageGroup: group, name, page, line: 0, column: 0, length: 0, value: "", status: "missing" });
    this.warnings.push(`page group ${group + 1}: field ${name} not found`);
    return null;
  }
}

/** Groups pages into page groups by the split field: a new page group starts when its value changes. */
function splitPageGroups(pages: SamplePage[], text: TextSource): SamplePage[][] {
  const splitName = text.split?.field;
  const splitField = splitName ? text.fields?.find((f) => f.name === splitName) : undefined;
  if (!splitField) return pages.length ? [pages] : [];
  const groups: SamplePage[][] = [];
  let current: SamplePage[] | null = null;
  let key: string | null = null;
  for (const page of pages) {
    const v = locateAnchor(page, splitField.anchor)?.value || null;
    if (!current || (v !== null && v !== key)) {
      current = [];
      groups.push(current);
      if (v !== null) key = v;
    }
    current.push(page);
  }
  return groups;
}

function isBody(no: number, text: TextSource): boolean {
  const header = text.header?.lines ?? 0;
  const footer = text.footer?.fromLine;
  return no > header && (footer === undefined || no < footer);
}

function extractField(c: Collector, group: number, pages: SamplePage[], field: TextField): unknown {
  const candidates = pagesForRule(pages, field.page);
  for (const page of candidates) {
    const loc = locateAnchor(page, field.anchor);
    if (loc) return c.value(group, field.name, page.no, loc, field.type, false);
  }
  return c.missing(group, field.name, candidates[0]?.no ?? pages[0]?.no ?? 0);
}

function extractTables(c: Collector, group: number, pages: SamplePage[], text: TextSource, out: Record<string, unknown>): void {
  for (const table of text.tables ?? []) {
    const headerRe = new RegExp(table.header.pattern);
    const untilRe = table.until ? new RegExp(table.until.pattern) : null;
    const skipRe = table.skip ? new RegExp(table.skip.pattern) : null;
    const rows: Record<string, unknown>[] = [];
    for (const page of pages) {
      const headerLine = page.lines.find((l) => headerRe.test(l.text));
      if (!headerLine) continue;
      for (const l of page.lines) {
        if (l.no <= headerLine.no || !isBody(l.no, text)) continue;
        if (untilRe?.test(l.text)) break;
        if (l.text.trim() === "" || skipRe?.test(l.text)) continue;
        const row: Record<string, unknown> = {};
        const index = rows.length;
        for (const col of table.columns) {
          const raw = l.text.slice(col.column - 1, col.column - 1 + col.length);
          row[col.name] = c.value(group, `${table.name}[${index}].${col.name}`, page.no, span(raw, l.no, col.column), col.type, false);
        }
        rows.push(row);
      }
    }
    out[table.name] = rows;
  }
}

function extractRecords(c: Collector, group: number, pages: SamplePage[], text: TextSource, out: Record<string, unknown>): void {
  for (const rec of text.records ?? []) {
    const startRe = new RegExp(rec.start.pattern);
    const items: Record<string, unknown>[] = [];
    for (const page of pages) {
      const lines = lineMap(page);
      let next = 0;
      for (const l of page.lines) {
        if (l.no < next || !isBody(l.no, text) || !startRe.test(l.text)) continue;
        const item: Record<string, unknown> = {};
        const index = items.length;
        for (const col of rec.columns) {
          const no = l.no + col.line - 1;
          const raw = (lines.get(no) ?? "").slice(col.column - 1, col.column - 1 + col.length);
          item[col.name] = c.value(group, `${rec.name}[${index}].${col.name}`, page.no, span(raw, no, col.column), col.type, false);
        }
        items.push(item);
        next = l.no + rec.lines;
      }
    }
    out[rec.name] = items;
  }
}

/**
 * Extracts the page groups of a sample as JSON with a definition. Text definitions read positioned
 * text; XML definitions go through `extractXml`. Never throws for missing values: those
 * become hits with status `missing` and a warning.
 */
export function extract(def: Definition, sample: Sample): ExtractResult {
  if (def.source === "xml") return extractXml(def, sample);
  const text = def.text;
  if (!text) return { pageGroups: [], pageRanges: [], hits: [], warnings: ["definition has no text section"] };
  const c = new Collector();
  const pages = text.skipFirstPage ? sample.pages.slice(1) : sample.pages;
  const groups = splitPageGroups(pages, text);
  const pageGroups = groups.map((groupPages, group) => {
    const out: Record<string, unknown> = {};
    for (const field of text.fields ?? []) out[field.name] = extractField(c, group, groupPages, field);
    extractTables(c, group, groupPages, text, out);
    extractRecords(c, group, groupPages, text, out);
    return out;
  });
  if (pageGroups.length === 0) c.warnings.push("no pages to extract from");
  const pageRanges = groups.map((groupPages) => ({ first: groupPages[0]!.no, last: groupPages.at(-1)!.no }));
  return { pageGroups, pageRanges, hits: c.hits, warnings: c.warnings };
}

/**
 * Why a definition's `match` rules do not accept the sample, one line per rule that
 * fails, such as `spooled file name is SPDPICK, not SPDXML`. Empty when it matches (no
 * rules accept everything).
 */
export function matchProblems(def: Definition, sample: Sample): string[] {
  const m = def.match;
  if (!m) return [];
  const problems: string[] = [];
  if (m.splf !== undefined && m.splf !== sample.splf.name) {
    problems.push(`spooled file name is ${sample.splf.name}, not ${m.splf}`);
  }
  if (m.queue !== undefined && m.queue !== sample.attributes.queue.name) {
    problems.push(`output queue is ${sample.attributes.queue.name}, not ${m.queue}`);
  }
  if (m.userData !== undefined && m.userData !== sample.attributes.userData) {
    problems.push(`user data is ${sample.attributes.userData || "empty"}, not ${m.userData}`);
  }
  if (m.page1 !== undefined) {
    const first = sample.pages[0];
    const t = first ? first.lines.map((l) => l.text).join("\n") : "";
    if (!new RegExp(m.page1, "m").test(t)) problems.push(`page 1 does not match /${m.page1}/`);
  }
  return problems;
}

/** True when a definition's `match` rules accept the sample (no rules accepts everything). */
export function matchesSample(def: Definition, sample: Sample): boolean {
  return matchProblems(def, sample).length === 0;
}
