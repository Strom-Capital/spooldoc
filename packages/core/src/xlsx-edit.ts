import { strFromU8 } from "fflate";
import { rezip, unzipAll, type OfficeKind } from "./office-zip.js";
import { xmlAttribute } from "./xml.js";
import { readXlsx } from "./xlsx.js";
import { parseRange, relationships, sheetFiles } from "./xlsx-parts.js";

/**
 * Editing an Excel template's XML with `str_replace` rules: a text that occurs exactly
 * once in one part is replaced. This is how the agent changes an Excel file it did not
 * design, such as one the user made in Excel. The sheets, `xl/styles.xml` and
 * `xl/workbook.xml` can be edited. A sheet reads with its shared strings written into its
 * cells, and the styles with the index of each entry, so an edit needs no lookups; both
 * are put back as Excel keeps them before the file is saved. Every other file in the zip
 * comes out byte for byte the same.
 */

/** One part that can be edited, with its size as it reads. */
export interface XlsxPartInfo {
  name: string;
  /** The sheet's name, for a sheet. */
  sheet?: string;
  /** Characters of its XML, as `readXlsxPart` gives it. */
  size: number;
}

/** One `str_replace` edit: `find` occurs exactly once in `part`, as `readXlsxPart` gives it, and becomes `replace`. */
export interface XlsxEdit {
  part: string;
  find: string;
  replace: string;
}

/** Why an edit could not be made: which edit, when there are several, and what to do. */
export class XlsxEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxEditError";
  }
}

const EXCEL: OfficeKind = { name: "an Excel template", read: readXlsx, error: XlsxEditError };

const STYLES = "xl/styles.xml";
const WORKBOOK = "xl/workbook.xml";
const WORKBOOK_RELS = "xl/_rels/workbook.xml.rels";
const STRINGS = "xl/sharedStrings.xml";
const CALC_CHAIN = "xl/calcChain.xml";
const CONTENT_TYPES = "[Content_Types].xml";

/** The lists of `styles.xml`, each with its entries' element and, for the index comments, the name an index goes by. */
const STYLE_LISTS = [
  { list: "numFmts", entry: "numFmt" },
  { list: "fonts", entry: "font", index: "fontId" },
  { list: "fills", entry: "fill", index: "fillId" },
  { list: "borders", entry: "border", index: "borderId" },
  { list: "cellStyleXfs", entry: "xf" },
  { list: "cellXfs", entry: "xf", index: "s" },
  { list: "cellStyles", entry: "cellStyle" },
  { list: "dxfs", entry: "dxf", index: "dxfId" },
] as const;

const INDEX_COMMENT = /<!--(?:fontId|fillId|borderId|s|dxfId)=\d+-->/g;

/** Each list of `styles.xml` with where its content starts and ends, in the order of `STYLE_LISTS`. */
function styleLists(xml: string): { list: string; entry: string; index?: string; open: string; start: number; end: number }[] {
  return STYLE_LISTS.flatMap((s) => {
    const m = new RegExp(`<${s.list}\\b[^>]*?>`).exec(xml);
    if (!m || m[0].endsWith("/>")) return [];
    const start = m.index + m[0].length;
    const end = xml.indexOf(`</${s.list}>`, start);
    return end === -1 ? [] : [{ ...s, open: m[0], start, end }];
  });
}

/** Where each entry of a list starts. Entries do not nest in themselves, so every start in the list is one. */
function entryStarts(xml: string, entry: string, start: number, end: number): number[] {
  const re = new RegExp(`<${entry}(?=[\\s>/])`, "g");
  re.lastIndex = start;
  const out: number[] = [];
  for (let m = re.exec(xml); m && m.index < end; m = re.exec(xml)) out.push(m.index);
  return out;
}

/** `styles.xml` with an index comment before each font, fill, border, cell format and differential format: `<!--s=7-->`. */
export function withStyleIndexes(xml: string): string {
  const inserts: { at: number; text: string }[] = [];
  for (const list of styleLists(xml)) {
    if (!list.index) continue;
    entryStarts(xml, list.entry, list.start, list.end).forEach((at, n) => inserts.push({ at, text: `<!--${list.index}=${n}-->` }));
  }
  inserts.sort((a, b) => a.at - b.at);
  let out = "";
  let from = 0;
  for (const insert of inserts) {
    out += xml.slice(from, insert.at) + insert.text;
    from = insert.at;
  }
  return out + xml.slice(from);
}

/** `styles.xml` without the index comments, and each list's `count` written to match its entries. */
function finishStyles(xml: string): string {
  const clean = xml.replace(INDEX_COMMENT, "");
  let out = "";
  let from = 0;
  for (const list of styleLists(clean)) {
    const count = entryStarts(clean, list.entry, list.start, list.end).length;
    const at = list.start - list.open.length;
    const open = /\scount="\d*"/.test(list.open) ? list.open.replace(/\scount="\d*"/, ` count="${count}"`) : list.open.replace(new RegExp(`^<${list.list}`), `<${list.list} count="${count}"`);
    out += clean.slice(from, at) + open;
    from = list.start;
  }
  return out + clean.slice(from);
}

/** The `<si>` entries of the shared strings: the XML inside each, in order. */
function sharedItems(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => m[1] ?? "");
}

const CELL_XML = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

/** A sheet with each shared string cell (`t="s"`) written as an inline string holding the shared string's XML, rich runs kept. */
function inlineStrings(xml: string, items: string[]): string {
  return xml.replace(CELL_XML, (whole, attributes: string, inner: string | undefined) => {
    if (inner === undefined || !/\st="s"/.test(attributes)) return whole;
    const v = /<v>\s*(\d+)\s*<\/v>/.exec(inner);
    const item = v ? items[Number(v[1])] : undefined;
    if (item === undefined) return whole;
    return `<c${attributes.replace(/\st="s"/, ' t="inlineStr"')}>${inner.replace(v![0], `<is>${item}</is>`)}</c>`;
  });
}

/** A sheet with each inline string cell written as a shared string, its index from `index`. */
function sharedStrings(xml: string, index: (item: string) => number): string {
  return xml.replace(CELL_XML, (whole, attributes: string, inner: string | undefined) => {
    if (inner === undefined || !/\st="inlineStr"/.test(attributes)) return whole;
    const is = /<is>([\s\S]*?)<\/is>|<is\/>/.exec(inner);
    if (!is) return whole;
    return `<c${attributes.replace(/\st="inlineStr"/, ' t="s"')}>${inner.replace(is[0], `<v>${index(is[1] ?? "")}</v>`)}</c>`;
  });
}

/** The formulas of a sheet, in order, to tell whether an edit changed them. */
const formulasOf = (xml: string): string[] => xml.match(/<f\b[^>]*?(?:\/>|>[\s\S]*?<\/f>)/g) ?? [];

/** The parts that can be edited, in order: each sheet with its name, then the styles and the workbook. */
function editableParts(files: Record<string, Uint8Array>): { name: string; sheet?: string }[] {
  const text = (name: string): string => (files[name] ? strFromU8(files[name]) : "");
  const sheets = sheetFiles(text(WORKBOOK), text(WORKBOOK_RELS)).filter((s) => files[s.file]);
  return [...sheets.map((s) => ({ name: s.file, sheet: s.name })), ...(files[STYLES] ? [{ name: STYLES }] : []), { name: WORKBOOK }];
}

/** A part's XML as it reads: a sheet with its shared strings inline, the styles with index comments, the workbook as it is. */
function readView(files: Record<string, Uint8Array>, part: string, isSheet: boolean, items: () => string[]): string {
  const xml = strFromU8(files[part]!);
  if (isSheet) return inlineStrings(xml, items());
  return part === STYLES ? withStyleIndexes(xml) : xml;
}

/** A message naming the part that does not exist and the parts that do. */
function noPart(part: string, parts: { name: string }[], n = ""): XlsxEditError {
  return new XlsxEditError(`${n}There is no part "${part}". The parts are ${parts.map((p) => p.name).join(", ")}.`);
}

/** The parts of an Excel template that can be read and edited: each sheet with its name, then `xl/styles.xml` and `xl/workbook.xml`. */
export function xlsxParts(bytes: Uint8Array): XlsxPartInfo[] {
  const files = unzipAll(bytes, EXCEL);
  let items: string[] | undefined;
  const strings = () => (items ??= sharedItems(files[STRINGS] ? strFromU8(files[STRINGS]) : ""));
  return editableParts(files).map((p) => ({ name: p.name, ...(p.sheet !== undefined ? { sheet: p.sheet } : {}), size: readView(files, p.name, p.sheet !== undefined, strings).length }));
}

/**
 * One part's XML as `editXlsx` matches it. In a sheet, each shared string cell is written
 * as an inline string, `<c r="A1" t="inlineStr"><is><t>Amount</t></is></c>`, with its rich
 * runs. In `xl/styles.xml`, a comment before each entry gives its index: `<!--fontId=3-->`,
 * `<!--fillId=2-->`, `<!--borderId=1-->`, `<!--s=7-->` for a cell format, `<!--dxfId=0-->`.
 */
export function readXlsxPart(bytes: Uint8Array, part: string): string {
  const files = unzipAll(bytes, EXCEL);
  const parts = editableParts(files);
  const found = parts.find((p) => p.name === part);
  if (!found) throw noPart(part, parts);
  return readView(files, part, found.sheet !== undefined, () => sharedItems(files[STRINGS] ? strFromU8(files[STRINGS]) : ""));
}

/** The `count` of a list in `styles.xml` after the edits, from its entries. */
function counts(styles: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const list of styleLists(styles)) out[list.list] = entryStarts(styles, list.entry, list.start, list.end).length;
  return out;
}

/** The tags of one list's entries, such as every `<xf ...>` of `cellXfs`. */
function entryTags(styles: string, name: string): string[] {
  const list = styleLists(styles).find((l) => l.list === name);
  if (!list) return [];
  return entryStarts(styles, list.entry, list.start, list.end).map((at) => styles.slice(at, styles.indexOf(">", at) + 1));
}

/** Checks that the styles' own references add up: each cell format's font, fill, border, number format and cell style. */
function checkStyles(styles: string): void {
  const n = counts(styles);
  const custom = new Set(entryTags(styles, "numFmts").map((tag) => Number(xmlAttribute(tag, "numFmtId"))));
  for (const [list, label] of [
    ["cellXfs", "s"],
    ["cellStyleXfs", "xfId"],
  ] as const) {
    entryTags(styles, list).forEach((tag, i) => {
      for (const [attribute, of, what] of [
        ["fontId", "fonts", "fonts"],
        ["fillId", "fills", "fills"],
        ["borderId", "borders", "borders"],
      ] as const) {
        const id = Number(xmlAttribute(tag, attribute) ?? 0);
        if (id >= (n[of] ?? 0)) {
          throw new XlsxEditError(
            `After the edits, the cell format ${label}=${i} in ${STYLES} has ${attribute}="${id}", but there are ${n[of] ?? 0} ${what} (${attribute}=0 to ${(n[of] ?? 0) - 1}). Use one of them, or add one to <${of}>. Nothing was saved.`,
          );
        }
      }
      const format = Number(xmlAttribute(tag, "numFmtId") ?? 0);
      if (format >= 164 && !custom.has(format)) {
        throw new XlsxEditError(`After the edits, the cell format ${label}=${i} in ${STYLES} has numFmtId="${format}", which <numFmts> does not define. Add <numFmt numFmtId="${format}" formatCode="..."/> to <numFmts>, or use a defined one. Nothing was saved.`);
      }
      const xfId = xmlAttribute(tag, "xfId");
      if (list === "cellXfs" && xfId !== undefined && Number(xfId) >= (n.cellStyleXfs ?? 0)) {
        throw new XlsxEditError(`After the edits, the cell format s=${i} in ${STYLES} has xfId="${xfId}", but there are ${n.cellStyleXfs ?? 0} entries in <cellStyleXfs>. Use xfId="0". Nothing was saved.`);
      }
    });
  }
}

/** Checks a sheet against the styles: every cell, row and column style and conditional format, and that merges do not overlap. */
function checkSheet(part: string, xml: string, styles: Record<string, number>): void {
  const cellFormats = styles.cellXfs ?? 0;
  const tooFar = (what: string, index: number) =>
    new XlsxEditError(
      `After the edits, ${what} in ${part} has style ${index}, but ${STYLES} has ${cellFormats} cell formats (s=0 to s=${cellFormats - 1}). Use one of them, or add one to <cellXfs>. Nothing was saved.`,
    );
  for (const m of xml.matchAll(/<c\b([^>]*?)\/?>/g)) {
    const s = xmlAttribute(m[0], "s");
    if (s !== undefined && Number(s) >= cellFormats) throw tooFar(`the cell ${xmlAttribute(m[0], "r") ?? ""}`.trim(), Number(s));
  }
  for (const m of xml.matchAll(/<row\b[^>]*>/g)) {
    const s = xmlAttribute(m[0], "s");
    if (s !== undefined && Number(s) >= cellFormats) throw tooFar(`row ${xmlAttribute(m[0], "r") ?? ""}`.trim(), Number(s));
  }
  for (const m of xml.matchAll(/<col\b[^>]*>/g)) {
    const s = xmlAttribute(m[0], "style");
    if (s !== undefined && Number(s) >= cellFormats) throw tooFar(`the column ${xmlAttribute(m[0], "min") ?? ""}`.trim(), Number(s));
  }
  const dxfs = styles.dxfs ?? 0;
  for (const m of xml.matchAll(/<cfRule\b[^>]*>/g)) {
    const id = xmlAttribute(m[0], "dxfId");
    if (id !== undefined && Number(id) >= dxfs) {
      throw new XlsxEditError(
        `After the edits, a conditional format in ${part} has dxfId="${id}", but ${STYLES} has ${dxfs} differential formats${dxfs > 0 ? ` (dxfId=0 to ${dxfs - 1})` : ""}. Use one of them, or add a <dxf> to <dxfs>. Nothing was saved.`,
      );
    }
  }
  const merges = [...xml.matchAll(/<mergeCell\b[^>]*>/g)].map((m) => xmlAttribute(m[0], "ref") ?? "");
  const boxes = merges.map((ref) => parseRange(ref));
  boxes.forEach((box, i) => {
    if (!box) throw new XlsxEditError(`After the edits, ${part} has a merge "${merges[i]}" that is not a range. Write it as A1:C1. Nothing was saved.`);
    const j = boxes.findIndex((other, k) => k < i && other && other.left <= box.right && box.left <= other.right && other.top <= box.bottom && box.top <= other.bottom);
    if (j !== -1) throw new XlsxEditError(`After the edits, the merges ${merges[j]} and ${merges[i]} in ${part} overlap. Merged ranges cannot overlap: change or remove one. Nothing was saved.`);
  });
}

/** Checks the workbook: every sheet has its relationship, and every local name a sheet. */
function checkWorkbook(workbook: string, rels: string): void {
  const ids = new Set(relationships(rels, WORKBOOK).map((r) => r.id));
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]);
  for (const tag of sheets) {
    const id = xmlAttribute(tag, "r:id");
    if (!id || !ids.has(id)) {
      throw new XlsxEditError(`After the edits, the sheet "${xmlAttribute(tag, "name") ?? ""}" in ${WORKBOOK} has r:id="${id ?? ""}", which ${WORKBOOK_RELS} does not have. Keep each sheet's r:id as it was. Nothing was saved.`);
    }
  }
  for (const m of workbook.matchAll(/<definedName\b[^>]*>/g)) {
    const local = xmlAttribute(m[0], "localSheetId");
    if (local !== undefined && !(Number(local) >= 0 && Number(local) < sheets.length)) {
      throw new XlsxEditError(
        `After the edits, the name ${xmlAttribute(m[0], "name") ?? ""} in ${WORKBOOK} has localSheetId="${local}", but the workbook has ${sheets.length} sheets (0 to ${sheets.length - 1}). Nothing was saved.`,
      );
    }
  }
}

/** A relationship Id not used yet in a `.rels` part. */
function freeId(rels: string): string {
  const used = new Set([...rels.matchAll(/\sId="([^"]*)"/g)].map((m) => m[1]));
  let n = 1;
  while (used.has(`rId${n}`)) n++;
  return `rId${n}`;
}

/**
 * Applies edits to an Excel template, in order, all or none. Each part an edit touches is
 * read as `readXlsxPart` gives it, edited, and put back as Excel keeps it:
 *
 * - in each edited sheet, every inline string cell becomes a shared string again: an
 *   existing `<si>` with the same XML when there is one, else a new one at the end of
 *   `xl/sharedStrings.xml`, so no other sheet's indices change;
 * - `xl/styles.xml` loses its index comments, and each list's `count` matches its entries;
 * - when an edit changes a sheet's formulas, `xl/calcChain.xml` is dropped, and Excel
 *   builds it again.
 *
 * Then the references are checked (cell styles, fonts, fills, borders, number formats,
 * differential formats, sheet relationships, local names, overlapping merges), every
 * changed part must be well-formed, and the file must still read as an Excel template.
 * Every other file is kept as it was.
 *
 * @returns The new file
 * @throws XlsxEditError saying which edit failed and why
 */
export function editXlsx(bytes: Uint8Array, edits: readonly XlsxEdit[]): Uint8Array {
  if (edits.length === 0) throw new XlsxEditError("Give at least one edit.");
  const files = unzipAll(bytes, EXCEL);
  const text = (name: string): string => (files[name] ? strFromU8(files[name]) : "");
  const parts = editableParts(files);
  const items = sharedItems(text(STRINGS));
  const views = new Map<string, string>();
  const edited = new Map<string, string>();
  edits.forEach((edit, i) => {
    const n = edits.length > 1 ? `Edit ${i + 1}: ` : "";
    const part = parts.find((p) => p.name === edit.part);
    if (!part) throw noPart(edit.part, parts, n);
    if (!edit.find) throw new XlsxEditError(`${n}find is empty. Give text that occurs once in ${edit.part}.`);
    if (!views.has(edit.part)) views.set(edit.part, readView(files, edit.part, part.sheet !== undefined, () => items));
    const xml = edited.get(edit.part) ?? views.get(edit.part)!;
    const first = xml.indexOf(edit.find);
    if (first === -1) {
      throw new XlsxEditError(
        `${n}The text to find is not in ${edit.part}. Read the part again: shared strings are written into their cells as inline strings, ${STYLES} has index comments, and & < > are written &amp; &lt; &gt;.`,
      );
    }
    if (xml.indexOf(edit.find, first + 1) !== -1) {
      throw new XlsxEditError(`${n}The text to find occurs more than once in ${edit.part}. Give more of the text around it, such as the cell's r="B5".`);
    }
    edited.set(edit.part, xml.slice(0, first) + edit.replace + xml.slice(first + edit.find.length));
  });

  const changed = new Map<string, string | null>();
  // Shared strings: an existing item with the same XML, else a new one at the end.
  const index = new Map<string, number>();
  items.forEach((item, n) => {
    if (!index.has(item)) index.set(item, n);
  });
  const added: string[] = [];
  const share = (item: string): number => {
    let n = index.get(item);
    if (n === undefined) {
      n = items.length + added.length;
      added.push(item);
      index.set(item, n);
    }
    return n;
  };
  let formulasChanged = false;
  for (const part of parts) {
    const xml = edited.get(part.name);
    if (xml === undefined) continue;
    if (part.sheet !== undefined) {
      const shared = sharedStrings(xml, share);
      if (formulasOf(views.get(part.name)!).join("\n") !== formulasOf(shared).join("\n")) formulasChanged = true;
      changed.set(part.name, shared);
    } else if (part.name === STYLES) {
      changed.set(part.name, finishStyles(xml));
    } else {
      changed.set(part.name, xml);
    }
  }

  // The sheets as they will be saved, to count string cells and check styles.
  const sheetXml = parts.filter((p) => p.sheet !== undefined).map((p) => ({ name: p.name, xml: (changed.get(p.name) as string | undefined) ?? text(p.name) }));
  const stringCells = sheetXml.reduce((sum, s) => sum + (s.xml.match(/<c\b[^>]*?\st="s"/g)?.length ?? 0), 0);
  const unique = items.length + added.length;
  const sst = text(STRINGS);
  if (files[STRINGS]) {
    const root = /<sst\b[^>]*?\/?>/.exec(sst);
    if (root && (added.length > 0 || xmlAttribute(root[0], "count") !== String(stringCells) || xmlAttribute(root[0], "uniqueCount") !== String(unique))) {
      const counted = (tag: string, name: string, value: number) =>
        new RegExp(`\\s${name}="\\d*"`).test(tag) ? tag.replace(new RegExp(`\\s${name}="\\d*"`), ` ${name}="${value}"`) : tag.replace(/^<sst\b/, `<sst ${name}="${value}"`);
      let open = counted(counted(root[0], "uniqueCount", unique), "count", stringCells);
      const more = added.map((item) => `<si>${item}</si>`).join("");
      let rest = sst.slice(root.index + root[0].length);
      if (open.endsWith("/>")) {
        open = `${open.slice(0, -2)}>`;
        rest = `${more}</sst>${rest}`;
      } else {
        const close = rest.lastIndexOf("</sst>");
        rest = rest.slice(0, close) + more + rest.slice(close);
      }
      changed.set(STRINGS, sst.slice(0, root.index) + open + rest);
    }
  } else if (added.length > 0) {
    // A workbook without shared strings gets the part, its relationship and its content type.
    files[STRINGS] = new Uint8Array();
    changed.set(
      STRINGS,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${stringCells}" uniqueCount="${unique}">${added.map((item) => `<si>${item}</si>`).join("")}</sst>`,
    );
    const rels = text(WORKBOOK_RELS);
    changed.set(
      WORKBOOK_RELS,
      rels.replace(
        "</Relationships>",
        `<Relationship Id="${freeId(rels)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
      ),
    );
    const types = text(CONTENT_TYPES);
    if (!types.includes('PartName="/xl/sharedStrings.xml"')) {
      changed.set(
        CONTENT_TYPES,
        types.replace("</Types>", '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'),
      );
    }
  }

  if (formulasChanged && files[CALC_CHAIN]) {
    changed.set(CALC_CHAIN, null);
    const rels = (changed.get(WORKBOOK_RELS) as string | undefined) ?? text(WORKBOOK_RELS);
    changed.set(WORKBOOK_RELS, rels.replace(/<Relationship\b[^>]*Type="[^"]*\/calcChain"[^>]*\/>/g, ""));
    const types = (changed.get(CONTENT_TYPES) as string | undefined) ?? text(CONTENT_TYPES);
    changed.set(CONTENT_TYPES, types.replace(/<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/g, ""));
  }

  // References: the edited parts, and every sheet when the styles changed.
  const styles = (changed.get(STYLES) as string | undefined) ?? text(STYLES);
  const styleCounts = counts(styles);
  if (changed.has(STYLES)) checkStyles(styles);
  for (const sheet of sheetXml) if (changed.has(STYLES) || changed.has(sheet.name)) checkSheet(sheet.name, sheet.xml, styleCounts);
  if (changed.has(WORKBOOK)) checkWorkbook(changed.get(WORKBOOK) as string, (changed.get(WORKBOOK_RELS) as string | undefined) ?? text(WORKBOOK_RELS));
  return rezip(files, changed, EXCEL);
}
