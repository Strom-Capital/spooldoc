import { strToU8, unzipSync, zipSync } from "fflate";
import type { Definition, ValueType } from "./definition.js";
import { short, tagParts, tagProblems, templatePaths, templateTags } from "./tags.js";
import { fieldLabel, MAX_TEMPLATE_FILE_BYTES, starterLayout, type StarterBlock, type StarterColumn } from "./template.js";
import { decodeXml, escapeXml, isOle, isZip, xmlAttribute } from "./xml.js";
import type { XlsxScope } from "./xlsx-scope.js";

/**
 * Excel templates: a `.xlsx` made in Excel with Carbone tags in its cells. Spooldoc reads
 * the tags out of the file to check them, and makes a starter template from a definition.
 * The file itself is only ever changed by the user, in Excel.
 */

/** The content type of an Excel workbook. */
export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export { XLSX_SCOPES, type XlsxScope } from "./xlsx-scope.js";

/** The most one part of the file (a sheet, the shared strings) may unzip to. */
const MAX_PART_BYTES = 32 * 1024 * 1024;

/** The last row of a sheet, for ranges over whole columns. */
const LAST_ROW = 1048576;

/** A cell of an Excel template that holds text. */
export interface XlsxCell {
  sheet: string;
  /** The cell, such as `B5`. */
  ref: string;
  /** 1-based. */
  row: number;
  text: string;
}

/** A sheet of an Excel template. */
export interface XlsxSheet {
  name: string;
  /** The merged ranges, such as `A1:C1`. */
  merges: string[];
  /** The number of cells with a formula. */
  formulas: number;
  /** True when the sheet has its own page setup: a paper size, orientation or scaling. The PDF follows it. */
  pageSetup: boolean;
}

/** What Spooldoc reads from an Excel template. */
export interface XlsxTemplate {
  sheets: XlsxSheet[];
  /** Every cell with text, sheet by sheet, row by row. */
  cells: XlsxCell[];
  /** The cells' text, one per line. */
  text: string;
}

/** A problem in an Excel template, and the cell it is in. */
export interface XlsxProblem {
  sheet: string;
  /** The cell, such as `B5`. */
  ref: string;
  message: string;
}

const NOT_XLSX = "The file is not an Excel workbook. Save it in Excel as an Excel Workbook (.xlsx) and upload it again.";

/** A 1-based column number as letters: 1 is A, 27 is AA. */
export function columnName(column: number): string {
  let name = "";
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** The row and column of a cell reference such as `B5`, or undefined. */
function parseRef(ref: string): { row: number; column: number } | undefined {
  const m = /^\$?([A-Z]{1,3})\$?(\d{1,7})$/.exec(ref.toUpperCase());
  if (!m) return undefined;
  let column = 0;
  for (const c of m[1]!) column = column * 26 + c.charCodeAt(0) - 64;
  return { row: Number(m[2]), column };
}

/** A sheet name as a reference needs it: `Lines`, or `'Order lines'` with quotes. */
function sheetRef(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/** An XML element of a scan: its local name (without a prefix such as `x:`), its tag text, and where its content starts and ends. */
interface Element {
  name: string;
  tag: string;
  closing: boolean;
  empty: boolean;
  /** The text up to the next tag. */
  content: string;
}

/** Every element of some XML in order, in one pass. */
function* elements(xml: string): Generator<Element> {
  for (let i = xml.indexOf("<"); i !== -1; ) {
    const end = xml.indexOf(">", i);
    if (end === -1) return;
    const closing = xml[i + 1] === "/";
    const empty = xml[end - 1] === "/";
    let nameEnd = i + (closing ? 2 : 1);
    while (nameEnd < end && !" \t\r\n/".includes(xml[nameEnd] as string)) nameEnd++;
    const full = xml.slice(i + (closing ? 2 : 1), nameEnd);
    const next = xml.indexOf("<", end + 1);
    yield { name: full.slice(full.indexOf(":") + 1), tag: xml.slice(i, end + 1), closing, empty, content: xml.slice(end + 1, next === -1 ? xml.length : next) };
    i = next;
  }
}

/** The shared strings of a workbook, each with the text of all its runs joined. Phonetic runs are skipped. */
function readSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  let current: string | null = null;
  let phonetic = 0;
  for (const el of elements(xml)) {
    if (el.name === "si") {
      if (el.closing) {
        strings.push(current ?? "");
        current = null;
      } else if (el.empty) strings.push("");
      else current = "";
    } else if (el.name === "rPh") {
      if (!el.empty) phonetic += el.closing ? -1 : 1;
    } else if (el.name === "t" && !el.closing && !el.empty && current !== null && phonetic === 0) {
      current += decodeXml(el.content);
    }
  }
  return strings;
}

/** Reads one sheet: its text cells, merges, formulas and page setup. Rows and cells without `r` follow the one before. */
function readSheet(xml: string, name: string, strings: string[], cells: XlsxCell[]): XlsxSheet {
  const sheet: XlsxSheet = { name, merges: [], formulas: 0, pageSetup: false };
  let row = 0;
  let column = 0;
  let cell: { ref: string; row: number; type: string } | null = null;
  let value = "";
  let inline: string | null = null;
  let inValue = false;
  let phonetic = 0;
  let formula = false;
  for (const el of elements(xml)) {
    switch (el.name) {
      case "row":
        if (!el.closing) {
          row = Number(xmlAttribute(el.tag, "r")) || row + 1;
          column = 0;
        }
        break;
      case "c":
        if (el.closing) {
          if (cell) {
            const text = cell.type === "s" ? (strings[Number(value)] ?? "") : cell.type === "inlineStr" ? (inline ?? "") : !formula && cell.type === "str" ? value : "";
            if (formula) sheet.formulas++;
            else if (text !== "") cells.push({ sheet: name, ref: cell.ref, row: cell.row, text });
          }
          cell = null;
        } else {
          const ref = xmlAttribute(el.tag, "r");
          const at = ref ? parseRef(ref) : undefined;
          column = at ? at.column : column + 1;
          if (at) row = at.row;
          cell = el.empty ? null : { ref: `${columnName(column)}${row}`, row, type: xmlAttribute(el.tag, "t") ?? "n" };
          value = "";
          inline = null;
          formula = false;
        }
        break;
      case "f":
        if (cell && !el.closing) formula = true;
        break;
      case "v":
        inValue = !el.closing && !el.empty;
        if (inValue) value = decodeXml(el.content);
        break;
      case "is":
        if (cell && !el.closing && !el.empty) inline = "";
        break;
      case "rPh":
        if (!el.empty) phonetic += el.closing ? -1 : 1;
        break;
      case "t":
        if (inline !== null && !el.closing && !el.empty && phonetic === 0) inline += decodeXml(el.content);
        break;
      case "mergeCell": {
        const ref = xmlAttribute(el.tag, "ref");
        if (ref && !el.closing) sheet.merges.push(ref);
        break;
      }
      case "pageSetup":
        if (!el.closing && ["paperSize", "orientation", "fitToWidth", "fitToHeight", "scale"].some((a) => xmlAttribute(el.tag, a) !== undefined)) {
          sheet.pageSetup = true;
        }
        break;
    }
  }
  return sheet;
}

/** The file of each sheet, in the workbook's order, from `xl/workbook.xml` and its relationships. */
function sheetFiles(workbook: string, rels: string): { name: string; file: string }[] {
  const targets = new Map<string, string>();
  for (const el of elements(rels)) {
    if (el.name !== "Relationship" || el.closing) continue;
    const id = xmlAttribute(el.tag, "Id");
    const target = xmlAttribute(el.tag, "Target");
    if (!id || !target || !/\/worksheet$/.test(xmlAttribute(el.tag, "Type") ?? "")) continue;
    targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }
  const sheets: { name: string; file: string }[] = [];
  for (const el of elements(workbook)) {
    if (el.name !== "sheet" || el.closing) continue;
    const name = xmlAttribute(el.tag, "name");
    const file = targets.get(xmlAttribute(el.tag, "r:id") ?? "");
    if (name !== undefined && file) sheets.push({ name, file });
  }
  return sheets;
}

/** The parts of the zip `readXlsx` reads. */
const readPart = (name: string): boolean =>
  name === "xl/workbook.xml" || name === "xl/_rels/workbook.xml.rels" || name === "xl/sharedStrings.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(name);

/**
 * Reads an Excel template: the text of every cell of every sheet, with its sheet and cell,
 * and each sheet's merges, formulas and page setup.
 *
 * @throws Error saying what is wrong with the file and what to do, when it is not a `.xlsx`
 */
export function readXlsx(bytes: Uint8Array): XlsxTemplate {
  if (isOle(bytes)) {
    throw new Error("The file is an Excel 97-2003 workbook (.xls). Save it in Excel as an Excel Workbook (.xlsx) and upload it again.");
  }
  if (!isZip(bytes)) throw new Error(NOT_XLSX);
  let tooLarge = false;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        if (!readPart(file.name)) return false;
        if (file.originalSize > MAX_PART_BYTES) tooLarge = true;
        return !tooLarge;
      },
    });
  } catch {
    throw new Error("The file is damaged: it could not be unzipped. Save it in Excel again and upload it again.");
  }
  if (tooLarge) {
    throw new Error(`The file has a part larger than ${MAX_PART_BYTES / 1024 / 1024} MB unzipped. Spooldoc takes Excel templates up to that size.`);
  }
  const decoder = new TextDecoder("utf-8");
  const text = (name: string): string => (files[name] ? decoder.decode(files[name]) : "");
  if (!files["xl/workbook.xml"]) {
    throw new Error(`The file is a zip file, but not an Excel workbook: it has no xl/workbook.xml. ${NOT_XLSX}`);
  }
  const strings = readSharedStrings(text("xl/sharedStrings.xml"));
  const cells: XlsxCell[] = [];
  const sheets = sheetFiles(text("xl/workbook.xml"), text("xl/_rels/workbook.xml.rels"))
    .filter((s) => files[s.file])
    .map((s) => readSheet(text(s.file), s.name, strings, cells));
  if (sheets.length === 0) throw new Error(`The workbook has no sheets Spooldoc can read. ${NOT_XLSX}`);
  return { sheets, cells, text: cells.map((c) => c.text).join("\n") };
}

/** Why a file is not an Excel template Spooldoc can use, or null when it is one. */
export function xlsxProblem(bytes: Uint8Array): string | null {
  if (bytes.length > MAX_TEMPLATE_FILE_BYTES) return `The file is too large: Excel templates can be at most ${MAX_TEMPLATE_FILE_BYTES / 1024 / 1024} MB.`;
  try {
    readXlsx(bytes);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Whether Carbone should pass the XLSX through LibreOffice (`hardRefresh`): when the
 * template has formulas, so their values are stored and previews and mail viewers show
 * them, or numbers written with `:formatN`, since an empty value otherwise leaves a number
 * cell with no number in it. LibreOffice takes about 40 ms more.
 */
export function xlsxHardRefresh(template: XlsxTemplate): boolean {
  return template.sheets.some((s) => s.formulas > 0) || template.cells.some((c) => c.text.includes(":formatN"));
}

/** The type of every field and column, by the path the check compares (`pg.lines[].amount`). */
function fieldTypes(def: Definition): Map<string, ValueType> {
  const { fields, blocks } = starterLayout(def);
  const types = new Map<string, ValueType>();
  for (const root of ["pg", "pgs[]"]) {
    for (const f of fields) if (f.type) types.set(`${root}.${f.name}`, f.type);
    for (const b of blocks) for (const c of b.columns) if (c.type) types.set(`${root}.${b.name}[].${c.name}`, c.type);
  }
  return types;
}

/** A tag for a value in an Excel cell: a number as a number cell, a date as an Excel date serial, text as it is. */
export function xlsxValueTag(path: string, type?: ValueType): string {
  if (type === "number") return `{${path}:formatN}`;
  if (type === "date") return `{${path}:formatD(X):div(86400):add(25569):formatN}`;
  return `{${path}}`;
}

/** `{asset('name')}`, or a start of one, in a cell. */
const ASSET_START = /\{asset\b/;

/** `pg.lines[].amount` as a tag with `[i]`, `{d.pg.lines[i].amount}`, written for an Excel cell of its type. */
const asTag = (path: string, type?: ValueType): string => xlsxValueTag(`d.${path.replace(/\[\]/g, "[i]")}`, type);

/**
 * Checks an Excel template's tags cell by cell, with the rules of `checkTemplate` (fields
 * that are not in the definition, quotes Carbone prints as text, tags never closed), and the
 * rules of Excel output:
 *
 * - a number field alone in a cell needs `:formatN`, or the cell is text and SUM gives 0;
 * - `:formatN` straight on a date field writes a number cell that holds no number;
 * - no merged cells in or below a loop row, since Carbone does not move them with the rows;
 * - in spooled file scope there is no `d.pg`, only `d.pgs[i]`;
 * - `{asset('name')}` is for HTML templates.
 *
 * Without a definition, fields and types are not checked.
 *
 * @returns The problems sheet by sheet, cell by cell; empty when the template is fine
 */
export function checkXlsx(template: XlsxTemplate, def?: Definition | null, scope: XlsxScope = "splf"): XlsxProblem[] {
  const known = def ? templatePaths(def) : undefined;
  const types = def ? fieldTypes(def) : new Map<string, ValueType>();
  const problems: XlsxProblem[] = [];
  const seen = new Set<string>();
  const add = (sheet: string, ref: string, message: string): void => {
    const key = `${sheet}\n${ref}\n${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    problems.push({ sheet, ref, message });
  };
  const firstLoopRow = new Map<string, number>();
  /** In spooled file scope, the cells that read `d.pg`: one problem names the first and counts the rest. */
  const pageGroupCells: { cell: XlsxCell; tag: string; path: string }[] = [];
  for (const cell of template.cells) {
    if (!cell.text.includes("{")) continue;
    const tags = templateTags(cell.text);
    if (tags.some((t) => /\[\s*i\s*(\+\s*1\s*)?\]/.test(t.text))) {
      firstLoopRow.set(cell.sheet, Math.min(firstLoopRow.get(cell.sheet) ?? Infinity, cell.row));
    }
    const pageGroupTags = new Set<number>();
    for (const tag of tags) {
      if (!tag.closed || !tag.text.startsWith("{d")) continue;
      const { path, formatters } = tagParts(tag.text);
      if (path === undefined) continue;
      if (scope === "splf" && (path === "pg" || path.startsWith("pg.") || path.startsWith("pg["))) {
        pageGroupTags.add(tag.index);
        if (!pageGroupCells.some((c) => c.cell === cell)) pageGroupCells.push({ cell, tag: tag.text, path });
        continue;
      }
      const type = types.get(path);
      const alone = tags.length === 1 && cell.text.trim() === tag.text;
      if (type === "number" && alone && !formatters.includes("formatN")) {
        add(cell.sheet, cell.ref, `${short(tag.text)} is a number, but without :formatN the cell is text and SUM gives 0. Write ${short(tag.text.slice(0, -1))}:formatN} and give the cell a number format such as #,##0.00.`);
      }
      const n = formatters.indexOf("formatN");
      if (type === "date" && n !== -1 && !formatters.slice(0, n).includes("formatD")) {
        add(
          cell.sheet,
          cell.ref,
          `${short(tag.text)} writes a date as a number cell that holds no number, which Excel can call damaged. For a date cell, write ${asTag(path, "date")} and give the cell a date format such as dd.mm.yyyy.`,
        );
      }
    }
    for (const problem of tagProblems(cell.text, known)) if (!pageGroupTags.has(problem.index)) add(cell.sheet, cell.ref, problem.message);
    const asset = ASSET_START.exec(cell.text);
    if (asset) {
      add(cell.sheet, cell.ref, `${short(cell.text.slice(asset.index, asset.index + 40))} is for HTML templates. In Excel, insert the picture itself, above any loop.`);
    }
  }
  const [first, ...others] = pageGroupCells;
  if (first) {
    const near = first.path.startsWith("pg.") ? `pgs[].${first.path.slice(3)}` : undefined;
    const example = near && known?.has(near) ? `, such as {d.${near.replace(/\[\]/g, "[i]")}}` : "";
    const more = others.length === 0 ? "" : ` and ${others.length === 1 ? "1 other cell" : `${others.length} other cells`}`;
    add(
      first.cell.sheet,
      first.cell.ref,
      `${short(first.tag)}${more} read one page group, but this template gets every page group in one file: use d.pgs[i]${example}, or make one file per page group.`,
    );
  }
  for (const sheet of template.sheets) {
    const loop = firstLoopRow.get(sheet.name);
    if (loop === undefined) continue;
    for (const merge of sheet.merges) {
      const [from = "", to = from] = merge.split(":");
      const start = parseRef(from);
      const end = parseRef(to);
      if (!start || !end || end.row < loop) continue;
      add(
        sheet.name,
        from,
        `The cells ${merge} are merged in or below the loop on row ${loop}. Carbone does not move merged cells with the rows it adds: unmerge them, or move them above the loop.`,
      );
    }
  }
  const order = new Map(template.sheets.map((s, i) => [s.name, i]));
  const row = (p: XlsxProblem): number => parseRef(p.ref)?.row ?? 0;
  const column = (p: XlsxProblem): number => parseRef(p.ref)?.column ?? 0;
  return problems.sort((a, b) => (order.get(a.sheet) ?? 0) - (order.get(b.sheet) ?? 0) || row(a) - row(b) || column(a) - column(b));
}

/** Problems as text, one per line: "Lines!B5: ...". */
export function xlsxProblemText(problems: readonly XlsxProblem[]): string {
  return problems.map((p) => `${sheetRef(p.sheet)}!${p.ref}: ${p.message}`).join("\n");
}

/** The sheets that have no page setup of their own, so their PDF is US Letter portrait with columns cut. */
export function sheetsWithoutPageSetup(template: XlsxTemplate): string[] {
  return template.sheets.filter((s) => !s.pageSetup).map((s) => s.name);
}

// The starter template, written as SpreadsheetML.

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** The cell styles of the starter, by their index in `cellXfs`. */
const STYLE = { text: 0, header: 1, headerNumber: 2, number: 3, date: 4, title: 5, totalLabel: 6, total: 7, label: 8 } as const;

const STYLES = `${XML_HEAD}<styleSheet ${NS}>
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy"/></numFmts>
<fonts count="4"><font><sz val="10"/><color rgb="FF1A1A1A"/><name val="Arial"/><family val="2"/></font><font><b/><sz val="10"/><color rgb="FF1A1A1A"/><name val="Arial"/><family val="2"/></font><font><b/><sz val="14"/><color rgb="FF1A1A1A"/><name val="Arial"/><family val="2"/></font><font><sz val="10"/><color rgb="FF555555"/><name val="Arial"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8E8E8"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF333333"/></bottom><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF333333"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** A cell of the starter: text (which may hold tags) or a formula, with its style. */
type StarterCell = { text: string; style?: number } | { formula: string; style?: number } | null;

/** A sheet of the starter, before it is written as XML. */
interface StarterSheet {
  name: string;
  rows: StarterCell[][];
  /** Column widths, in characters. */
  widths: number[];
  /** The header row, 1-based: frozen, repeated on each printed page and filtered. */
  header?: { row: number; filter: boolean; printTitles: boolean };
}

/** About how many characters of Arial 10 fit across an A4 page in portrait, between the starter's margins. */
const PORTRAIT_CHARACTERS = 100;

/** The width of a column, in characters, for its label and values. */
function columnWidth(column: StarterColumn, label = fieldLabel(column.name)): number {
  const values = column.type === "date" ? 10 : column.type === "number" ? 12 : (column.length ?? 14);
  return Math.min(40, Math.max(8, label.length + 2, values + 2));
}

const cellStyle = (type?: ValueType): number => (type === "number" ? STYLE.number : type === "date" ? STYLE.date : STYLE.text);
const headerStyle = (type?: ValueType): number => (type === "number" ? STYLE.headerNumber : STYLE.header);

/** A text without its tags, such as a title `Invoice {d.pg.invoiceNo}`: `Invoice `. One pass with `indexOf`. */
export function withoutTags(text: string): string {
  let out = "";
  let from = 0;
  for (let open = text.indexOf("{"); open !== -1; open = text.indexOf("{", from)) {
    const close = text.indexOf("}", open + 1);
    if (close === -1) break;
    out += text.slice(from, open);
    from = close + 1;
  }
  return out + text.slice(from);
}

/** A sheet name Excel takes: at most 31 characters, none of `[]:*?/\`, and not one already used. */
function sheetName(wanted: string, used: Set<string>): string {
  const base = wanted.replace(/[[\]:*?/\\{}]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 31).trim() || "Sheet";
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} ${n}`;
  used.add(name.toLowerCase());
  return name;
}

/** Labels for columns, with a column that has the same label as one before told apart by its list. */
function labels(columns: { column: StarterColumn; list?: string }[]): string[] {
  const seen = new Set<string>();
  return columns.map(({ column, list }) => {
    let label = fieldLabel(column.name);
    if (seen.has(label.toLowerCase()) && list) label = `${label} (${fieldLabel(list)})`;
    seen.add(label.toLowerCase());
    return label;
  });
}

/**
 * The flat sheet of a whole spooled file: the header row, then a row per line of `block` (or
 * per page group when there is no block), with the page group's fields repeated on each row.
 * It has no total row: one inside a filtered, sortable table gets in the way.
 */
function flatSheet(name: string, fields: StarterColumn[], block: StarterBlock | undefined): StarterSheet {
  const columns = [...fields.map((column) => ({ column, list: undefined as string | undefined })), ...(block?.columns ?? []).map((column) => ({ column, list: block!.name }))];
  const rows: StarterCell[][] = [];
  const names = labels(columns);
  rows.push(columns.map(({ column }, n) => ({ text: names[n]!, style: headerStyle(column.type) })));
  rows.push(
    columns.map(({ column, list }) => ({
      text: xlsxValueTag(list ? `d.pgs[i].${list}[i].${column.name}` : `d.pgs[i].${column.name}`, column.type),
      style: cellStyle(column.type),
    })),
  );
  rows.push([{ text: block ? `{d.pgs[i+1].${block.name}[i+1]}` : "{d.pgs[i+1]}" }]);
  return {
    name,
    rows,
    widths: columns.map(({ column }, n) => columnWidth(column, names[n])),
    header: { row: 1, filter: true, printTitles: true },
  };
}

/** A table of one page group: its header row, the loop row, the `[i+1]` row, and a total of each number column with SUM and INDIRECT. */
function blockRows(block: StarterBlock, firstRow: number): StarterCell[][] {
  const loop = firstRow + 1;
  const rows: StarterCell[][] = [
    block.columns.map((c) => ({ text: fieldLabel(c.name), style: headerStyle(c.type) })),
    block.columns.map((c) => ({ text: xlsxValueTag(`d.pg.${block.name}[i].${c.name}`, c.type), style: cellStyle(c.type) })),
    [{ text: `{d.pg.${block.name}[i+1]}` }],
  ];
  // The first column holds the label "Total", so it is not totalled.
  if (block.columns.some((c, n) => n > 0 && c.type === "number")) {
    rows.push(
      block.columns.map((c, n) => {
        const letter = columnName(n + 1);
        if (n > 0 && c.type === "number") return { formula: `SUM(INDIRECT("${letter}${loop}:${letter}"&ROW()-1))`, style: STYLE.total };
        return n === 0 ? { text: "Total", style: STYLE.totalLabel } : { text: "", style: STYLE.totalLabel };
      }),
    );
  }
  return rows;
}

/**
 * The sheets of one page group: the title and the fields, then the first table. Each further
 * table goes on a sheet of its own, since the start of a total's range would move with the
 * rows of the table above it.
 */
function pageGroupSheets(title: string, fields: StarterColumn[], blocks: StarterBlock[], used: Set<string>): StarterSheet[] {
  const rows: StarterCell[][] = [[{ text: title, style: STYLE.title }], []];
  for (const f of fields) rows.push([{ text: fieldLabel(f.name), style: STYLE.label }, { text: xlsxValueTag(`d.pg.${f.name}`, f.type), style: cellStyle(f.type) }]);
  const widths: number[] = [Math.max(8, ...fields.map((f) => fieldLabel(f.name).length + 2)), Math.max(12, ...fields.map((f) => columnWidth(f)))];
  const [first, ...rest] = blocks;
  if (first) {
    if (fields.length > 0) rows.push([]);
    rows.push([{ text: fieldLabel(first.name), style: STYLE.totalLabel }]);
    rows.push(...blockRows(first, rows.length + 1));
    first.columns.forEach((c, n) => (widths[n] = Math.max(widths[n] ?? 0, columnWidth(c))));
  }
  const name = sheetName(withoutTags(title), used);
  const sheets: StarterSheet[] = [{ name, rows, widths }];
  for (const block of rest) {
    sheets.push({ name: sheetName(fieldLabel(block.name), used), rows: blockRows(block, 1), widths: block.columns.map((c) => columnWidth(c)), header: { row: 1, filter: false, printTitles: true } });
  }
  return sheets;
}

/** One sheet as SpreadsheetML, with its strings added to `strings`. */
function sheetXml(sheet: StarterSheet, first: boolean, strings: Map<string, number>): string {
  const index = (text: string): number => {
    let n = strings.get(text);
    if (n === undefined) {
      n = strings.size;
      strings.set(text, n);
    }
    return n;
  };
  const lastColumn = Math.max(1, sheet.widths.length, ...sheet.rows.map((r) => r.length));
  const landscape = sheet.widths.reduce((sum, w) => sum + w, 0) > PORTRAIT_CHARACTERS;
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          if (!cell) return "";
          const ref = `${columnName(c + 1)}${r + 1}`;
          const style = cell.style ? ` s="${cell.style}"` : "";
          if ("formula" in cell) return `<c r="${ref}"${style}><f>${escapeXml(cell.formula)}</f></c>`;
          if (cell.text === "") return style ? `<c r="${ref}"${style}/>` : "";
          return `<c r="${ref}"${style} t="s"><v>${index(cell.text)}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const header = sheet.header;
  const pane = header
    ? `<pane ySplit="${header.row}" topLeftCell="A${header.row + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${header.row + 1}" sqref="A${header.row + 1}"/>`
    : "";
  const cols = sheet.widths.map((w, n) => `<col min="${n + 1}" max="${n + 1}" width="${w}" customWidth="1"/>`).join("");
  return [
    `${XML_HEAD}<worksheet ${NS}>`,
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`,
    `<dimension ref="A1:${columnName(lastColumn)}${Math.max(1, sheet.rows.length)}"/>`,
    `<sheetViews><sheetView workbookViewId="0"${first ? ' tabSelected="1"' : ""}>${pane}</sheetView></sheetViews>`,
    `<sheetFormatPr defaultRowHeight="12.75"/>`,
    cols ? `<cols>${cols}</cols>` : "",
    `<sheetData>${rows}</sheetData>`,
    header?.filter ? `<autoFilter ref="A${header.row}:${columnName(lastColumn)}${LAST_ROW}"/>` : "",
    `<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>`,
    `<pageSetup paperSize="9" orientation="${landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/>`,
    `<headerFooter><oddFooter>&amp;R&amp;8Page &amp;P of &amp;N</oddFooter></headerFooter>`,
    `</worksheet>`,
  ].join("");
}

/**
 * An Excel starter template for a definition, built from `starterLayout`, that keeps every
 * rule of Carbone's Excel output: numbers with `:formatN` in number-formatted cells, dates as
 * Excel serials in date-formatted cells, totals (per page group) that stay right when rows are added, no
 * merged cells, and a page setup on each sheet for the PDF: A4, landscape when the columns are
 * wider than portrait fits, one page wide, the header row on each page and "Page 1 of 2" in
 * the footer. The user opens it in Excel, styles it, and uploads it.
 *
 * - `splf` (the default): a flat sheet per table, record or group, with a row per line and
 *   the page group's fields repeated on each row, and a frozen header row with a filter on
 *   the whole columns. No totals. Without a table, a row per page group.
 * - `pageGroup`: the title and the fields, then a table for each table, record or group,
 *   each with its total under it.
 */
export function starterXlsx(def: Definition, scope: XlsxScope = "splf"): Uint8Array {
  const { title, fields, blocks } = starterLayout(def);
  const used = new Set<string>();
  const usable = blocks.filter((b) => b.columns.length > 0);
  const sheets: StarterSheet[] =
    scope === "pageGroup"
      ? pageGroupSheets(title, fields, usable, used)
      : usable.length === 0
        ? [flatSheet(sheetName(withoutTags(title), used), fields, undefined)]
        : usable.map((block) => flatSheet(sheetName(fieldLabel(block.name), used), fields, block));
  const strings = new Map<string, number>();
  const sheetFilesXml = sheets.map((sheet, n) => sheetXml(sheet, n === 0, strings));
  const defined = sheets.flatMap((sheet, n) => {
    const h = sheet.header;
    if (!h) return [];
    const ref = sheetRef(sheet.name);
    const last = columnName(Math.max(1, sheet.widths.length));
    return [
      ...(h.filter ? [`<definedName name="_xlnm._FilterDatabase" localSheetId="${n}" hidden="1">${escapeXml(`${ref}!$A$${h.row}:$${last}$${LAST_ROW}`)}</definedName>`] : []),
      ...(h.printTitles ? [`<definedName name="_xlnm.Print_Titles" localSheetId="${n}">${escapeXml(`${ref}!$${h.row}:$${h.row}`)}</definedName>`] : []),
    ];
  });
  const shared = [...strings.keys()].map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`).join("");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map((_, n) => `<Override PartName="/xl/worksheets/sheet${n + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join(
          "",
        )}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    ),
    "docProps/core.xml": strToU8(
      `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>Spooldoc</dc:creator></cp:coreProperties>`,
    ),
    "docProps/app.xml": strToU8(
      `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Spooldoc</Application></Properties>`,
    ),
    "xl/workbook.xml": strToU8(
      `${XML_HEAD}<workbook ${NS}><bookViews><workbookView/></bookViews><sheets>${sheets
        .map((sheet, n) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${n + 1}" r:id="rId${n + 1}"/>`)
        .join("")}</sheets>${defined.length > 0 ? `<definedNames>${defined.join("")}</definedNames>` : ""}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, n) => `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n + 1}.xml"/>`)
        .join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    ),
    "xl/styles.xml": strToU8(STYLES),
    "xl/sharedStrings.xml": strToU8(`${XML_HEAD}<sst ${NS} count="${strings.size}" uniqueCount="${strings.size}">${shared}</sst>`),
  };
  sheetFilesXml.forEach((xml, n) => (files[`xl/worksheets/sheet${n + 1}.xml`] = strToU8(xml)));
  return zipSync(files, { level: 6 });
}
