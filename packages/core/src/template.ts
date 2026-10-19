import { convertNamePattern } from "./convert.js";
import type { Definition, ValueType } from "./definition.js";
import { firstTag } from "./html.js";
import { pageLayout } from "./pagesize.js";
import { ASSET_TAG, templateUses } from "./tags.js";

/** Turns an asset name into its data URI, or undefined when there is no such asset. */
export type AssetResolver = (name: string) => string | undefined;

/** What a template's `d` holds: the document, every document of the spooled file, and the sample. */
export interface TemplateData {
  doc: Record<string, unknown>;
  documents?: Record<string, unknown>[];
  sample: { id: string; splf: unknown };
}

/**
 * The data for one document. `documents` is only sent when the template reads it, so a
 * spooled file with many documents does not send all of them with each one.
 */
export function templateData(template: string, doc: Record<string, unknown>, documents: Record<string, unknown>[], sample: { id: string; splf: unknown }): TemplateData {
  return { doc, ...(templateUses(template, "documents") ? { documents } : {}), sample: { id: sample.id, splf: sample.splf } };
}

/** CSS that hides Carbone's PDF header, footer and options in HTML output; Carbone leaves those elements in. */
export const HIDE_PDF_ELEMENTS = "carbone-pdf-header, carbone-pdf-footer, carbone-pdf-options { display: none; }";

/** Options for `prepareHtml`. */
export interface PrepareOptions {
  /** Resolves `{asset('name')}`. */
  asset?: AssetResolver;
  /** Make landscape PDF pages, when the template sets no `@page` size. */
  landscape?: boolean;
}

/** Inserts `html` after the first opening tag of each name in turn, or at the start. */
function insertAfter(text: string, names: string[], html: string): string {
  for (const name of names) {
    const tag = firstTag(text, name);
    if (tag) return text.slice(0, tag.end) + html + text.slice(tag.end);
  }
  return html + text;
}

/**
 * The template as Spooldoc sends it to Carbone:
 *
 * - `{asset('name')}` written as the asset's data URI;
 * - always a full HTML document (Carbone reads a fragment as XML and fails);
 * - CSS that hides `<carbone-pdf-header>`, `<carbone-pdf-footer>` and `<carbone-pdf-options>` in HTML output;
 * - `<carbone-pdf-options landscape="true">` when asked for, since a template's `@page` size wins in Carbone anyway.
 *
 * @throws Error naming the asset when one is not uploaded
 */
export function prepareHtml(template: string, options: PrepareOptions = {}): string {
  let html = template.replace(ASSET_TAG, (_tag, _quote: string, name: string) => {
    const uri = options.asset?.(name);
    if (uri === undefined) throw new Error(`There is no asset named "${name}". Upload it on the Assets page.`);
    return uri;
  });
  if (!/<html[\s>]/i.test(html)) {
    html = `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n</head>\n<body>\n${html}\n</body>\n</html>\n`;
  }
  const style = `<style>${HIDE_PDF_ELEMENTS}</style>`;
  const head = firstTag(html, "head", true);
  html = head ? `${html.slice(0, head.start)}${style}\n${html.slice(head.start)}` : insertAfter(html, ["body", "html"], style);
  if (options.landscape && !/<carbone-pdf-options\b/i.test(html)) {
    html = insertAfter(html, ["body", "html"], '\n<carbone-pdf-options landscape="true"></carbone-pdf-options>');
  }
  return html;
}

/**
 * Send `landscape` for a PDF only when the template sets no `@page` size, since the CSS
 * wins in Carbone: landscape above 160 columns, else portrait.
 */
export function pdfLandscape(template: string, pageWidth?: number | null): boolean {
  const layout = pageLayout(template, pageWidth);
  return !layout.fromTemplate && layout.landscape;
}

/** A value at a path such as `doc.lines[0].item`, or undefined. */
function valueAt(data: unknown, path: string): unknown {
  let current: unknown = data;
  for (const part of path.split(/\.|\[(\d+)\]/).filter((p) => p !== undefined && p !== "")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Tags in a file name pattern: `{d.doc.invoiceNo}`, plain paths without formatters. */
const NAME_TAG = /\{d\.([A-Za-z_][\w.[\]]*)\}/g;

/** Problems with a file name pattern: Nunjucks the converter can't map, or tags with formatters. */
export function namePatternProblems(pattern: string): string[] {
  const converted = convertNamePattern(pattern);
  const rest = converted.replace(NAME_TAG, "");
  const nunjucks = [rest.indexOf("{{"), rest.indexOf("{%")].filter((i) => i !== -1);
  if (nunjucks.length > 0) {
    const start = Math.min(...nunjucks);
    const close = rest.indexOf("}", start + 2);
    const snippet = rest.slice(start, close === -1 ? start + 40 : rest[close + 1] === "}" ? close + 2 : close + 1);
    return [`write fields as {d.doc.invoiceNo}, not ${snippet}`];
  }
  if (/\{d[.:[]/.test(rest)) return ["file names take plain tags such as {d.doc.invoiceNo}, without formatters"];
  return [];
}

/**
 * Renders the definition's `output.name` (or `type-n`) for one document, as a
 * filesystem-safe name. The pattern takes tags like `{d.doc.invoiceNo}`; a pattern from
 * before Carbone (`invoice-{{ invoiceNo }}`) is converted first.
 */
export function documentName(def: Definition, doc: Record<string, unknown>, index = 0): string {
  const fallback = `${def.type}-${index + 1}`;
  let name = fallback;
  if (def.output?.name) {
    const pattern = convertNamePattern(def.output.name);
    name = pattern.replace(NAME_TAG, (_tag, path: string) => {
      const value = valueAt({ doc }, path);
      return value === null || value === undefined || typeof value === "object" ? "" : String(value);
    });
  }
  return name.trim().replace(/[^A-Za-z0-9._-]+/g, "_") || fallback;
}

const label = (name: string): string =>
  name
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());

interface Column {
  name: string;
  type?: ValueType;
}

interface Block {
  name: string;
  columns: Column[];
}

/** A tag for a value, formatted by its type: dates as `15.10.2026`, numbers with two decimals. */
function valueTag(path: string, type?: ValueType): string {
  if (type === "date") return `{${path}:formatD('DD.MM.YYYY')}`;
  if (type === "number") return `{${path}:formatN(2)}`;
  return `{${path}}`;
}

function tableHtml(block: Block): string {
  const num = (c: Column): string => (c.type === "number" ? ' class="num"' : "");
  const head = block.columns.map((c) => `<th${num(c)}>${label(c.name)}</th>`).join("");
  const cells = block.columns.map((c) => `<td${num(c)}>${valueTag(`d.doc.${block.name}[i].${c.name}`, c.type)}</td>`).join("");
  return [
    `  <h2>${label(block.name)}</h2>`,
    `  <table>`,
    `    <thead><tr>${head}</tr></thead>`,
    `    <tbody>`,
    `      <tr>${cells}</tr>`,
    `      <tr><td>{d.doc.${block.name}[i+1]}</td></tr>`,
    `    </tbody>`,
    `  </table>`,
  ].join("\n");
}

const xmlType = (value: string | { type?: ValueType }): ValueType | undefined => (typeof value === "string" ? undefined : value.type);

/**
 * A complete A4 HTML starter template for a definition, in Carbone tags: the fields in a
 * header block, each shown only when it has a value, and a table for each table, record or
 * group. Data is `d` = `{ doc, documents, sample }`.
 */
export function starterTemplate(def: Definition): string {
  const fields: Column[] = [];
  const blocks: Block[] = [];
  if (def.source === "text" && def.text) {
    for (const f of def.text.fields ?? []) fields.push({ name: f.name, type: f.type });
    for (const t of def.text.tables ?? []) blocks.push({ name: t.name, columns: t.columns.map((c) => ({ name: c.name, type: c.type })) });
    for (const r of def.text.records ?? []) blocks.push({ name: r.name, columns: r.columns.map((c) => ({ name: c.name, type: c.type })) });
  } else if (def.xml) {
    for (const [name, value] of Object.entries(def.xml.fields ?? {})) fields.push({ name, type: xmlType(value) });
    for (const [name, g] of Object.entries(def.xml.groups ?? {})) {
      blocks.push({ name, columns: Object.entries(g.map).map(([column, value]) => ({ name: column, type: xmlType(value) })) });
    }
  }
  const title = def.output?.title ?? label(def.type);
  const rows = fields
    .map((f) => `    {d.doc.${f.name}:ifNEM:showBegin}<dt>${label(f.name)}</dt><dd>${valueTag(`d.doc.${f.name}`, f.type)}</dd>{d.doc.${f.name}:showEnd}`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 10pt; color: #1a1a1a; margin: 0; }
  h1 { font-size: 18pt; margin: 0 0 6mm; }
  h2 { font-size: 11pt; margin: 6mm 0 2mm; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 1mm 6mm; margin: 0; }
  dt { color: #555; }
  dd { margin: 0; white-space: pre-line; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 1.5mm 2mm; border-bottom: 0.2mm solid #ccc; vertical-align: top; }
  th { font-weight: 600; border-bottom: 0.4mm solid #333; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  tr { page-break-inside: avoid; }
  /* Carbone's PDF header, footer and options show in the PDF only. */
  ${HIDE_PDF_ELEMENTS}
</style>
</head>
<body>
  <h1>${title}</h1>
  <dl>
${rows}
  </dl>
${blocks.map(tableHtml).join("\n")}
</body>
</html>
`;
}
