import { XMLParser } from "fast-xml-parser";
import type { Definition, ValueType, XmlValue } from "./definition.js";
import type { ExtractResult, FieldHit } from "./extract.js";
import type { Sample, SamplePage } from "./sample.js";
import { convertValue } from "./values.js";

/** True when the first non-blank text of the pages starts with `<`. */
export function detectXml(pages: SamplePage[]): boolean {
  for (const page of pages) {
    for (const l of page.lines) {
      const t = l.text.trim();
      if (t) return t.startsWith("<");
    }
  }
  return false;
}

interface Joined {
  text: string;
  /** Start offset in `text` of each printed line, in order. */
  segments: { offset: number; page: number; line: number }[];
}

/**
 * Joins all page text into one string. Lines are joined with a newline, except a line
 * that fills the page width, which is taken as wrapped and joined directly.
 */
function joinPages(pages: SamplePage[], width?: number): Joined {
  let text = "";
  const segments: Joined["segments"] = [];
  let wrapped = false;
  for (const page of pages) {
    for (const l of page.lines) {
      if (text && !wrapped) text += "\n";
      segments.push({ offset: text.length, page: page.no, line: l.no });
      text += l.text;
      wrapped = width !== undefined && l.text.length >= width;
    }
  }
  return { text, segments };
}

interface XmlGroupSpan {
  start: number;
  end: number;
}

function findPageGroups(text: string, rootName: string): XmlGroupSpan[] {
  const out: XmlGroupSpan[] = [];
  const esc = rootName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const open = new RegExp(`<${esc}(?=[\\s/>])`, "g");
  const close = `</${rootName}>`;
  let m: RegExpExecArray | null;
  while ((m = open.exec(text))) {
    const start = m.index;
    const selfClose = text.indexOf(">", start);
    if (selfClose > 0 && text[selfClose - 1] === "/") {
      out.push({ start, end: selfClose + 1 });
      open.lastIndex = selfClose + 1;
      continue;
    }
    const end = text.indexOf(close, start);
    if (end < 0) break;
    out.push({ start, end: end + close.length });
    open.lastIndex = end + close.length;
  }
  return out;
}

/**
 * Finds each `<root ...>...</root>` page group in the joined page text. Text outside a root
 * element, such as a printer footer line or an XML declaration, is dropped. Entities are
 * left as they are for the XML parser.
 */
export function joinXmlPageGroups(pages: SamplePage[], rootName: string, width?: number): string[] {
  const { text } = joinPages(pages, width);
  return findPageGroups(text, rootName).map((d) => text.slice(d.start, d.end));
}

interface Element {
  path: string;
  start: number;
  tagLength: number;
  end: number;
}

/** A small tag scanner: every element with its slash path from the document root and its offsets. */
function scanElements(xml: string, base: number): Element[] {
  const out: Element[] = [];
  const stack: { name: string; el: Element }[] = [];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[?!][^>]*>|<(\/?)([A-Za-z_][\w.:-]*)[^>]*?(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const name = m[2];
    if (!name) continue;
    if (m[1]) {
      for (let i = stack.length - 1; i >= 0; i--) {
        const top = stack[i];
        if (top && top.name === name) {
          top.el.end = base + m.index + m[0].length;
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const path = [...stack.map((s) => s.name), name].join("/");
    const el: Element = { path, start: base + m.index, tagLength: m[0].length, end: base + m.index + m[0].length };
    out.push(el);
    if (!m[3]) stack.push({ name, el });
  }
  return out;
}

const valuePath = (v: XmlValue): string => (typeof v === "string" ? v : v.path);
const valueType = (v: XmlValue): ValueType | undefined => (typeof v === "string" ? undefined : v.type);
const segmentsOf = (p: string): string[] => p.split("/").filter(Boolean);

function getPath(node: unknown, path: string): unknown {
  let cur: unknown = node;
  for (const seg of segmentsOf(path)) {
    if (Array.isArray(cur)) cur = cur[0];
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  if (Array.isArray(cur)) cur = cur[0];
  return cur;
}

function textOf(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && "#text" in v) return String((v as Record<string, unknown>)["#text"]);
  if (typeof v === "object") return "";
  return undefined;
}

/** Extracts the page groups of XML printed into a spooled file. Same result shape as `extract`. */
export function extractXml(def: Definition, sample: Sample): ExtractResult {
  const xml = def.xml;
  const hits: FieldHit[] = [];
  const warnings: string[] = [];
  if (!xml) return { pageGroups: [], hits, warnings: ["definition has no xml section"] };
  const joined = joinPages(sample.pages, sample.attributes.pageWidth);
  const spans = findPageGroups(joined.text, xml.pageGroup);
  if (spans.length === 0) warnings.push(`no <${xml.pageGroup}> element found`);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    parseTagValue: false,
    processEntities: true,
    trimValues: true,
  });

  const locate = (offset: number): { page: number; line: number; column: number } => {
    let seg = joined.segments[0];
    for (const s of joined.segments) {
      if (s.offset > offset) break;
      seg = s;
    }
    return seg ? { page: seg.page, line: seg.line, column: offset - seg.offset + 1 } : { page: 0, line: 0, column: 0 };
  };

  const pageGroups = spans.map((span, group) => {
    const out: Record<string, unknown> = {};
    const source = joined.text.slice(span.start, span.end);
    let root: unknown;
    try {
      root = (parser.parse(source) as Record<string, unknown>)[xml.pageGroup];
    } catch (err) {
      warnings.push(`page group ${group + 1}: XML does not parse: ${err instanceof Error ? err.message : String(err)}`);
      root = undefined;
    }
    const elements = scanElements(source, span.start);
    const rootPrefix = `${xml.pageGroup}/`;
    const hitFor = (name: string, el: Element | undefined, value: string | undefined): void => {
      if (value === undefined) {
        const page = el ? locate(el.start).page : (locate(span.start).page);
        hits.push({ pageGroup: group, name, page, line: 0, column: 0, length: 0, value: "", status: "missing" });
        warnings.push(`page group ${group + 1}: field ${name} not found`);
        return;
      }
      const status = value.trim() === "" ? "empty" : "found";
      if (!el) {
        hits.push({ pageGroup: group, name, page: locate(span.start).page, line: 0, column: 0, length: 0, value, status });
        return;
      }
      const at = locate(el.start);
      hits.push({ pageGroup: group, name, page: at.page, line: at.line, column: at.column, length: el.tagLength, value, status });
    };
    const typed = (name: string, value: string | undefined, type: ValueType | undefined): unknown => {
      if (value === undefined) return null;
      const r = convertValue(value.trim(), type);
      if (!r.ok) warnings.push(`page group ${group + 1}: ${name} value ${JSON.stringify(value)} is not a valid ${type}`);
      return r.value;
    };

    for (const [name, v] of Object.entries(xml.fields ?? {})) {
      const p = rootPrefix + segmentsOf(valuePath(v)).join("/");
      const value = textOf(getPath(root, valuePath(v)));
      hitFor(name, elements.find((e) => e.path === p), value);
      out[name] = typed(name, value, valueType(v));
    }
    for (const [name, group] of Object.entries(xml.groups ?? {})) {
      const segs = segmentsOf(group.path);
      const parent = getPath(root, segs.slice(0, -1).join("/"));
      const last = segs.at(-1) ?? "";
      let items: unknown = parent && typeof parent === "object" ? (parent as Record<string, unknown>)[last] : undefined;
      if (items === undefined || items === null || items === "") items = [];
      const list = Array.isArray(items) ? items : [items];
      const itemEls = elements.filter((e) => e.path === rootPrefix + segs.join("/"));
      out[name] = list.map((item, index) => {
        const row: Record<string, unknown> = {};
        const itemEl = itemEls[index];
        for (const [col, v] of Object.entries(group.map)) {
          const p = `${itemEl?.path ?? ""}/${segmentsOf(valuePath(v)).join("/")}`;
          const el = itemEl ? elements.find((e) => e.path === p && e.start >= itemEl.start && e.start < itemEl.end) : undefined;
          const value = textOf(getPath(item, valuePath(v)));
          hitFor(`${name}[${index}].${col}`, el, value);
          row[col] = typed(`${name}[${index}].${col}`, value, valueType(v));
        }
        return row;
      });
    }
    return out;
  });
  return { pageGroups, hits, warnings };
}
