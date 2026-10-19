import { nunjucksSpans, type NunjucksSpan } from "./convert.js";
import type { Definition } from "./definition.js";

/**
 * Spooldoc's own check of a Carbone template, before every render. Carbone answers 200
 * and prints the wrong thing for several mistakes: a field that is not in the data, quotes
 * it does not accept, Nunjucks left over from an older template, a tag that is never
 * closed. The check reads the tags out of the template text.
 */

/** A problem in a template, on a 1-based line. */
export interface TemplateProblem {
  line: number;
  message: string;
}

/** Options for `checkTemplate`. */
export interface CheckOptions {
  /** The uploaded asset names. Without it, `{asset('name')}` is not checked. */
  assets?: readonly string[];
}

/** Where a tag can start: `{d.`, `{d[`, `{d:`, `{d}`, the same for `c` and `o`, `{#`, `{$` and `{t(`. */
const TAG_START = /\{(?:[dco](?=[.[:}\s])|#|\$|t\()/g;

/** `{asset('name')}`: an uploaded image or font, written into the template as a data URI before it is sent. */
export const ASSET_TAG = /\{asset\(\s*(['"])([^'"{}]*)\1\s*\)\}/g;

const MAX_TAG = 1000;

/** The 1-based line of an index in `text`. */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = text.indexOf("\n"); i !== -1 && i < index; i = text.indexOf("\n", i + 1)) line++;
  return line;
}

/** A short version of a snippet for a message. */
const short = (text: string): string => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > 60 ? `${one.slice(0, 57)}...` : one;
};

/** `text` with the ranges replaced by spaces (newlines kept), so later scans skip them and lines stay right. */
function blank(text: string, ranges: [number, number][]): string {
  let out = text;
  for (const [start, end] of ranges) out = out.slice(0, start) + out.slice(start, end).replace(/[^\n]/g, " ") + out.slice(end);
  return out;
}

/** A tag in a template: its text with the braces, and where it starts. */
export interface TemplateTag {
  text: string;
  index: number;
  /** False when the tag has no closing `}` on its line. */
  closed: boolean;
}

/** The Carbone tags in a template, in order. Nunjucks syntax is skipped. */
export function templateTags(template: string): TemplateTag[] {
  const text = blank(template, nunjucksSpans(template).map((span) => [span.start, span.end]));
  const tags: TemplateTag[] = [];
  for (const m of text.matchAll(TAG_START)) {
    const start = m.index;
    let end = start + 1;
    let closed = false;
    while (end < text.length && end - start < MAX_TAG) {
      const c = text[end];
      if (c === "}") {
        closed = true;
        break;
      }
      if (c === "{" || c === "\n") break;
      end++;
    }
    tags.push({ text: template.slice(start, closed ? end + 1 : end), index: start, closed });
  }
  return tags;
}

/** True when a template reads `d.<root>`, such as `documents`. */
export function templateUses(template: string, root: string): boolean {
  return templateTags(template).some((tag) => new RegExp(`(^|[^.\\w])d\\.${root}\\b`).test(tag.text));
}

/** The path of a `d` tag, before its formatters: `{d.doc.lines[i].amount:formatN(2)}` gives `d.doc.lines[i].amount`. */
function tagPath(tag: string): string {
  const inner = tag.slice(1, tag.endsWith("}") ? -1 : undefined);
  let depth = 0;
  let quote = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "'") quote = !quote;
    else if (quote) continue;
    else if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth--;
    else if (c === ":" && depth === 0) return inner.slice(0, i).trim();
  }
  return inner.trim();
}

/**
 * A data path as the check compares it: without `d.`, every `[...]` as `[]`, and without a
 * trailing `[]` (the `[i+1]` row). `d.doc.lines[i].amount` gives `doc.lines[].amount`.
 * Undefined for paths the check does not follow, such as `..` to a parent.
 */
function normalPath(path: string): string | undefined {
  if (path === "d" || path.includes("..")) return undefined;
  if (!path.startsWith("d.")) return path.startsWith("d[") ? "[]" : undefined;
  return path
    .slice(2)
    .replace(/\[[^\]]*\]/g, "[]")
    .replace(/\s+/g, "")
    .replace(/\[\]$/, "");
}

/** The splf fields of a sample, as `sample.splf.*`. */
const SPLF_FIELDS = ["name", "number", "jobName", "jobUser", "jobNumber"];

/**
 * Every data path a template can use with this definition: `doc` and its fields and
 * lists, the same under `documents[]`, and `sample` with its id and spooled file.
 */
export function templatePaths(def: Definition): Set<string> {
  const fields: string[] = [];
  const lists: { name: string; columns: string[] }[] = [];
  if (def.source === "text" && def.text) {
    for (const f of def.text.fields ?? []) fields.push(f.name);
    for (const t of def.text.tables ?? []) lists.push({ name: t.name, columns: t.columns.map((c) => c.name) });
    for (const r of def.text.records ?? []) lists.push({ name: r.name, columns: r.columns.map((c) => c.name) });
  } else if (def.xml) {
    fields.push(...Object.keys(def.xml.fields ?? {}));
    for (const [name, g] of Object.entries(def.xml.groups ?? {})) lists.push({ name, columns: Object.keys(g.map) });
  }
  const paths = new Set<string>(["doc", "documents", "sample", "sample.id", "sample.splf", ...SPLF_FIELDS.map((f) => `sample.splf.${f}`)]);
  for (const root of ["doc", "documents[]"]) {
    paths.add(root.replace(/\[\]$/, ""));
    for (const f of fields) paths.add(`${root}.${f}`);
    for (const l of lists) {
      paths.add(`${root}.${l.name}`);
      for (const c of l.columns) paths.add(`${root}.${l.name}[].${c}`);
    }
  }
  return paths;
}

/** Levenshtein distance, for "did you mean". */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = row[j] as number;
      row[j] = Math.min(next + 1, (row[j - 1] as number) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = next;
    }
  }
  return row[b.length] as number;
}

/**
 * The known path an unknown one probably meant: the same path under `doc`, or a name
 * under the same parent that is a typo away or starts the same way.
 */
function closest(path: string, known: Set<string>): string | undefined {
  if (known.has(`doc.${path}`)) return `doc.${path}`;
  const cut = path.lastIndexOf(".");
  const parent = path.slice(0, cut + 1);
  const name = path.slice(cut + 1).toLowerCase();
  let best: { path: string; score: number } | undefined;
  for (const candidate of known) {
    if (!candidate.startsWith(parent) || candidate.slice(parent.length).includes(".")) continue;
    const other = candidate.slice(parent.length).toLowerCase();
    const d = distance(name, other);
    let common = 0;
    while (common < name.length && name[common] === other[common]) common++;
    const prefix = common >= Math.max(4, Math.ceil(Math.min(name.length, other.length) * 0.6));
    const score = d <= Math.max(2, Math.floor(name.length / 3)) ? d : prefix ? 100 + d : undefined;
    if (score !== undefined && (!best || score < best.score)) best = { path: candidate, score };
  }
  return best?.path;
}

/** `doc.lines[].amount` written back as a tag, `{d.doc.lines[i].amount}`. */
const asTag = (path: string): string => `{d.${path.replace(/\[\]/g, "[i]")}}`;

/** What to write instead of a Nunjucks span. */
function nunjucksHelp(span: NunjucksSpan): string {
  if (span.kind === "{") return "Write a Carbone tag such as {d.doc.invoiceNo} instead.";
  if (span.kind === "#") return "Write an HTML comment (<!-- -->) instead.";
  const word = /^[a-z]+/i.exec(span.inner.replace(/^-/, "").trimStart())?.[0] ?? "";
  if (word === "for" || word === "endfor") return "Write a loop as a row with [i] and a row with [i+1] instead.";
  if (["if", "elif", "else", "endif"].includes(word)) return "Write a condition with :showBegin and :showEnd instead.";
  return "Carbone has no statements like this. See the template docs for what to use.";
}

/**
 * Checks a Carbone HTML template before it is rendered:
 *
 * - tags whose field is not in the definition (`{d.doc.invoiceNumber}`, `{d.doc.lines[i].ammount}`);
 * - smart quotes and double quotes inside tags;
 * - Nunjucks left over (`{{ }}`, `{% %}`, `{# #}`);
 * - tags that are never closed;
 * - `{asset('name')}` with a name that is not uploaded.
 *
 * Without a definition, fields are not checked.
 *
 * @returns The problems in line order; empty when the template is fine
 */
export function checkTemplate(template: string, def?: Definition | null, options: CheckOptions = {}): TemplateProblem[] {
  const problems: TemplateProblem[] = [];
  const add = (index: number, message: string): void => {
    problems.push({ line: lineAt(template, index), message });
  };

  const spans = nunjucksSpans(template);
  for (const span of spans) {
    const raw = template.slice(span.start, span.end);
    add(span.start, `${short(raw)} is Nunjucks, which templates no longer use. ${nunjucksHelp(span)}`);
  }
  // An opening {{ or {% with no end is Nunjucks too.
  const matched = blank(template, spans.map((span) => [span.start, span.end]));
  for (const m of matched.matchAll(/\{\{|\{%/g)) {
    add(m.index, `${short(template.slice(m.index, m.index + 40))} is Nunjucks, which templates no longer use, and it is not closed.`);
  }

  const assets = options.assets ? new Set(options.assets) : undefined;
  const assetRanges: [number, number][] = [];
  for (const m of template.matchAll(ASSET_TAG)) {
    assetRanges.push([m.index, m.index + m[0].length]);
    const name = m[2] ?? "";
    if (assets && !assets.has(name)) add(m.index, `There is no asset named "${name}". Upload it on the Assets page, or fix the name in ${short(m[0])}.`);
  }
  for (const m of blank(template, assetRanges).matchAll(/\{asset\b/g)) {
    add(m.index, `Write an asset as {asset('name')}, with the name in single quotes: ${short(template.slice(m.index, m.index + 40))}`);
  }

  const known = def ? templatePaths(def) : undefined;
  for (const tag of templateTags(template)) {
    if (!tag.closed) {
      add(tag.index, `This tag has no closing }: ${short(tag.text)}`);
      continue;
    }
    const inner = tag.text.slice(1, -1);
    if (/[‘’“”]/.test(inner)) {
      add(tag.index, `${short(tag.text)} has curly quotes, which Carbone prints as text. Use straight single quotes (').`);
    } else if (inner.includes('"')) {
      add(tag.index, `${short(tag.text)} has double quotes, which Carbone prints as text. Use single quotes (').`);
    }
    if (!known || !tag.text.startsWith("{d")) continue;
    const path = normalPath(tagPath(tag.text));
    if (path === undefined || known.has(path)) continue;
    if (path === "[]") {
      add(tag.index, `${short(tag.text)} reads d as a list, but d is { doc, documents, sample }. Start the tag with d.doc.`);
      continue;
    }
    // .att and .val after a list read an object's keys and values.
    if (/\[\]\.(att|val)$/.test(path) && known.has(path.replace(/\[\]\.(att|val)$/, ""))) continue;
    const near = closest(path, known);
    const hint = near
      ? ` Did you mean ${asTag(near)}?`
      : path.startsWith("doc.") || path.startsWith("documents")
        ? " Check the name against the definition's fields."
        : " The data has doc, documents and sample.";
    add(tag.index, `${short(tag.text)} is not in the data.${hint}`);
  }

  const seen = new Set<string>();
  return problems
    .sort((a, b) => a.line - b.line)
    .filter((p) => {
      const key = `${p.line}\n${p.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Problems as text, one per line: "Line 12: ...". */
export function problemText(problems: readonly TemplateProblem[]): string {
  return problems.map((p) => `Line ${p.line}: ${p.message}`).join("\n");
}
