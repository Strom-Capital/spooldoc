import nunjucks from "nunjucks";
import type { Definition } from "./definition.js";

/** Formats a number with two decimals and a thousands separator, optionally followed by a currency. */
export function formatMoney(value: unknown, currency?: string): string {
  const n = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return value === null || value === undefined ? "" : String(value);
  const sign = n < 0 ? "-" : "";
  const [int = "0", dec = "00"] = Math.abs(n).toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}.${dec}${currency ? ` ${currency}` : ""}`;
}

/** Formats an ISO date (`YYYY-MM-DD...`) with yyyy, MM and dd tokens. Default `dd.MM.yyyy`. */
export function formatDate(value: unknown, format = "dd.MM.yyyy"): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const [, y = "", mo = "", d = ""] = m;
  return format.replace(/yyyy/g, y).replace(/MM/g, mo).replace(/dd/g, d);
}

/** Pads a value to `width` on the left (default) or right. */
export function pad(value: unknown, width: number, side: "left" | "right" = "left", char = " "): string {
  const s = value === null || value === undefined ? "" : String(value);
  const c = char.length > 0 ? char[0] ?? " " : " ";
  return side === "right" ? s.padEnd(width, c) : s.padStart(width, c);
}

/** Property names that lead from a template value to `Function`, and from there to code in this process. */
const BLOCKED_MEMBERS = new Set(["constructor", "prototype", "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"]);

type MemberLookup = ((obj: unknown, val: unknown) => unknown) & { guarded?: true };

/**
 * Nunjucks has no sandbox: `{{ range.constructor("...")() }}` would run any code on the
 * server. Every `a.b` and `a["b"]` in a compiled template goes through
 * `runtime.memberLookup`, so the names that reach `Function` are refused there.
 */
function guardMemberLookup(): void {
  const runtime = nunjucks.runtime as unknown as { memberLookup: MemberLookup };
  const lookup = runtime.memberLookup;
  if (lookup.guarded) return;
  const guarded: MemberLookup = (obj, val) => {
    if (BLOCKED_MEMBERS.has(String(val))) throw new Error(`Templates cannot use ${JSON.stringify(String(val))}.`);
    return lookup(obj, val);
  };
  guarded.guarded = true;
  runtime.memberLookup = guarded;
}

function environment(autoescape: boolean): nunjucks.Environment {
  guardMemberLookup();
  const env = new nunjucks.Environment([], { autoescape, throwOnUndefined: false, trimBlocks: true, lstripBlocks: true });
  env.addFilter("money", (v: unknown, currency?: string) => formatMoney(v, currency));
  env.addFilter("date", (v: unknown, format?: string) => formatDate(v, format));
  env.addFilter("pad", (v: unknown, width: number, side?: "left" | "right", char?: string) => pad(v, width, side, char));
  return env;
}

let htmlEnv: nunjucks.Environment | null = null;
let textEnv: nunjucks.Environment | null = null;

/** Turns an asset name into what `asset('name')` prints (a data URI), or undefined when there is no such asset. */
export type AssetResolver = (name: string) => string | undefined;

/** Options for `renderTemplate`. */
export interface RenderOptions {
  /** Resolves `asset('name')`. Without it every `asset()` call is an error. */
  asset?: AssetResolver;
}

/**
 * Renders a Nunjucks (Jinja syntax) template with autoescape on. Errors are returned in
 * `errors`, never thrown. Filters: `money`, `date`, `pad`. Function: `asset(name)`, an
 * uploaded image or font as a data URI (an unknown name is an error).
 */
export function renderTemplate(html: string, data: unknown, options: RenderOptions = {}): { html: string; errors: string[] } {
  htmlEnv ??= environment(true);
  try {
    const asset = (name: unknown): string => {
      const uri = typeof name === "string" ? options.asset?.(name) : undefined;
      if (uri === undefined) throw new Error(`There is no asset named ${JSON.stringify(name)}. Upload it on the Assets page.`);
      return uri;
    };
    const ctx = { asset, ...(data !== null && typeof data === "object" ? (data as object) : { data }) };
    return { html: htmlEnv.renderString(html, ctx), errors: [] };
  } catch (err) {
    return { html: "", errors: [err instanceof Error ? err.message : String(err)] };
  }
}

/** Renders the definition's `output.name` (or `type-n`) for one document, as a filesystem-safe name. */
export function documentName(def: Definition, doc: Record<string, unknown>, index = 0): string {
  textEnv ??= environment(false);
  let name = `${def.type}-${index + 1}`;
  if (def.output?.name) {
    try {
      name = textEnv.renderString(def.output.name, doc);
    } catch {
      // keep the fallback name
    }
  }
  return name.trim().replace(/[^A-Za-z0-9._-]+/g, "_") || `${def.type}-${index + 1}`;
}

const label = (name: string): string =>
  name
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());

interface Block {
  name: string;
  columns: string[];
}

function tableHtml(block: Block): string {
  const head = block.columns.map((c) => `<th>${label(c)}</th>`).join("");
  const cells = block.columns.map((c) => `<td>{{ row.${c} }}</td>`).join("");
  return [
    `  <h2>${label(block.name)}</h2>`,
    `  <table>`,
    `    <thead><tr>${head}</tr></thead>`,
    `    <tbody>`,
    `      {% for row in doc.${block.name} %}`,
    `      <tr>${cells}</tr>`,
    `      {% endfor %}`,
    `    </tbody>`,
    `  </table>`,
  ].join("\n");
}

/**
 * A complete A4 HTML starter template for a definition: the fields in a header block and a
 * table for each table, record or group. Renders the document in `doc`; the data is
 * `{ doc, documents, sample: { id, splf } }`.
 */
export function starterTemplate(def: Definition): string {
  const fields: string[] = [];
  const blocks: Block[] = [];
  if (def.source === "text" && def.text) {
    for (const f of def.text.fields ?? []) fields.push(f.name);
    for (const t of def.text.tables ?? []) blocks.push({ name: t.name, columns: t.columns.map((c) => c.name) });
    for (const r of def.text.records ?? []) blocks.push({ name: r.name, columns: r.columns.map((c) => c.name) });
  } else if (def.xml) {
    fields.push(...Object.keys(def.xml.fields ?? {}));
    for (const [name, g] of Object.entries(def.xml.groups ?? {})) blocks.push({ name, columns: Object.keys(g.map) });
  }
  const title = def.output?.title ?? label(def.type);
  const rows = fields.map((f) => `    <dt>${label(f)}</dt><dd>{{ doc.${f} }}</dd>`).join("\n");
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
  tr { page-break-inside: avoid; }
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
