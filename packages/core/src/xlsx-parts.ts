import { xmlAttribute } from "./xml.js";

/**
 * Finding one's way in an `.xlsx`: scanning its XML, the file of each sheet, and the
 * parts a sheet points to through its relationships. Shared by the reader and the edit.
 */

/** An XML element of a scan: its local name (without a prefix such as `x:`), its tag text, and where its content starts and ends. */
export interface Element {
  name: string;
  tag: string;
  closing: boolean;
  empty: boolean;
  /** The text up to the next tag. */
  content: string;
  /** Where the tag starts in the XML. */
  start: number;
  /** Where the tag ends in the XML: just after its `>`. */
  end: number;
}

/** Every element of some XML in order, in one pass. Comments and declarations come as elements named `!--` and `?xml`. */
export function* elements(xml: string): Generator<Element> {
  for (let i = xml.indexOf("<"); i !== -1; ) {
    const end = xml.indexOf(">", i);
    if (end === -1) return;
    const closing = xml[i + 1] === "/";
    const empty = xml[end - 1] === "/";
    let nameEnd = i + (closing ? 2 : 1);
    while (nameEnd < end && !" \t\r\n/".includes(xml[nameEnd] as string)) nameEnd++;
    const full = xml.slice(i + (closing ? 2 : 1), nameEnd);
    const next = xml.indexOf("<", end + 1);
    yield { name: full.slice(full.indexOf(":") + 1), tag: xml.slice(i, end + 1), closing, empty, content: xml.slice(end + 1, next === -1 ? xml.length : next), start: i, end: end + 1 };
    i = next;
  }
}

/** A relationship's target as a path in the zip, from the folder of the part that points to it. */
export function relTarget(target: string, from: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = from.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}

/** The relationships part of a part: `xl/worksheets/_rels/sheet1.xml.rels` for `xl/worksheets/sheet1.xml`. */
export function relsOf(part: string): string {
  const slash = part.lastIndexOf("/");
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

/** One relationship of a part. */
export interface Relationship {
  id: string;
  /** The last part of the type, such as `worksheet` or `comments`. */
  type: string;
  /** The target as a path in the zip, or the URL of an external target. */
  target: string;
  external: boolean;
}

/** The relationships in a `.rels` part, for the part at `from`. */
export function relationships(rels: string, from: string): Relationship[] {
  const out: Relationship[] = [];
  for (const el of elements(rels)) {
    if (el.name !== "Relationship" || el.closing) continue;
    const id = xmlAttribute(el.tag, "Id");
    const target = xmlAttribute(el.tag, "Target");
    if (!id || target === undefined) continue;
    const external = xmlAttribute(el.tag, "TargetMode") === "External";
    out.push({ id, type: (xmlAttribute(el.tag, "Type") ?? "").replace(/^.*\//, ""), target: external ? target : relTarget(target, from), external });
  }
  return out;
}

/** The file of each sheet, in the workbook's order, from `xl/workbook.xml` and its relationships. */
export function sheetFiles(workbook: string, rels: string): { name: string; file: string }[] {
  const targets = new Map<string, string>();
  for (const rel of relationships(rels, "xl/workbook.xml")) if (rel.type === "worksheet" && !rel.external) targets.set(rel.id, rel.target);
  const sheets: { name: string; file: string }[] = [];
  for (const el of elements(workbook)) {
    if (el.name !== "sheet" || el.closing) continue;
    const name = xmlAttribute(el.tag, "name");
    const file = targets.get(xmlAttribute(el.tag, "r:id") ?? "");
    if (name !== undefined && file) sheets.push({ name, file });
  }
  return sheets;
}

/** The row and column of a cell reference such as `B5` or `$B$5`, or undefined. */
export function parseRef(ref: string): { row: number; column: number } | undefined {
  const m = /^\$?([A-Z]{1,3})\$?(\d{1,7})$/.exec(ref.toUpperCase());
  if (!m) return undefined;
  let column = 0;
  for (const c of m[1]!) column = column * 26 + c.charCodeAt(0) - 64;
  return { row: Number(m[2]), column };
}

/** A 1-based column number as letters: 1 is A, 27 is AA. */
export function columnName(column: number): string {
  let name = "";
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** The column number of letters such as `AB`, or 0. */
export function columnNumber(letters: string): number {
  let column = 0;
  for (const c of letters.toUpperCase()) {
    if (c < "A" || c > "Z") return 0;
    column = column * 26 + c.charCodeAt(0) - 64;
  }
  return column;
}

/** The last row and column of a sheet. */
export const LAST_ROW = 1048576;
export const LAST_COLUMN = 16384;

/** A range such as `A2:F9`, `A:F`, `2:9` or `B5`, as its corners, or undefined. Whole columns and rows reach the sheet's edge. */
export function parseRange(range: string): { top: number; left: number; bottom: number; right: number } | undefined {
  const [from = "", to = from, extra] = range.replace(/\$/g, "").split(":");
  if (extra !== undefined) return undefined;
  if (/^[A-Za-z]{1,3}$/.test(from) && /^[A-Za-z]{1,3}$/.test(to)) {
    const left = columnNumber(from);
    const right = columnNumber(to);
    return left > 0 && right > 0 ? { top: 1, left: Math.min(left, right), bottom: LAST_ROW, right: Math.max(left, right) } : undefined;
  }
  if (/^\d{1,7}$/.test(from) && /^\d{1,7}$/.test(to)) {
    const top = Number(from);
    const bottom = Number(to);
    return top > 0 && bottom > 0 ? { top: Math.min(top, bottom), left: 1, bottom: Math.max(top, bottom), right: LAST_COLUMN } : undefined;
  }
  const a = parseRef(from);
  const b = parseRef(to);
  if (!a || !b) return undefined;
  return { top: Math.min(a.row, b.row), left: Math.min(a.column, b.column), bottom: Math.max(a.row, b.row), right: Math.max(a.column, b.column) };
}
