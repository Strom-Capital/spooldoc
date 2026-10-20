import { unzipSync } from "fflate";
import type { Definition, ValueType } from "./definition.js";
import { short, tagParts, tagProblems, templatePaths, templateTags } from "./tags.js";
import { fieldLabel, MAX_TEMPLATE_FILE_BYTES, starterLayout, type StarterBlock, type StarterColumn } from "./template.js";
import { decodeXml, isOle, isZip, xmlAttribute } from "./xml.js";
import { buildXlsx, type XlsxDesign } from "./xlsx-design.js";
import { missingPrefixes } from "./xlsx-formula.js";
import { columnName, elements, LAST_ROW, parseRange, parseRef, relationships, relsOf, sheetFiles } from "./xlsx-parts.js";
import type { XlsxScope } from "./xlsx-scope.js";

/**
 * Excel templates: a `.xlsx` with Carbone tags in its cells, made in Excel, designed by the
 * agent (`buildXlsx`) or edited by it (`editXlsx`). Spooldoc reads the tags out of the file
 * to check them, reads the cells of an XLSX Carbone made, and makes a starter template
 * from a definition.
 */

/** The content type of an Excel workbook. */
export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export { XLSX_SCOPES, type XlsxScope } from "./xlsx-scope.js";
export { columnName };

/** The most one part of the file (a sheet, the shared strings) may unzip to. */
const MAX_PART_BYTES = 32 * 1024 * 1024;

/** A cell of an Excel template that holds text. */
export interface XlsxCell {
  sheet: string;
  /** The cell, such as `B5`. */
  ref: string;
  /** 1-based. */
  row: number;
  text: string;
  /** True when the text is an inline string (`t="inlineStr"`), not a shared one. */
  inline?: true;
}

/** A formula of an Excel template, as the file stores it: without `=`, newer functions with their prefix. */
export interface XlsxFormula {
  sheet: string;
  ref: string;
  /** 1-based. */
  row: number;
  formula: string;
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
  /** The ranges with conditional formatting, as the file writes them (`A2:A9 C2:C9`). */
  conditionalFormatting: string[];
  /** The ranges with data validation, as the file writes them. */
  dataValidations: string[];
  /** The cells with a note (a comment in the file). */
  notes: string[];
  /** The Excel tables on the sheet, with their ranges. */
  tables: { name: string; ref: string }[];
}

/** What Spooldoc reads from an Excel template. */
export interface XlsxTemplate {
  sheets: XlsxSheet[];
  /** Every cell with text, sheet by sheet, row by row. */
  cells: XlsxCell[];
  /** Every formula with its text, sheet by sheet, row by row. Cells that share another cell's formula are counted in `XlsxSheet.formulas` only. */
  formulas: XlsxFormula[];
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

/** A sheet name as a reference needs it: `Lines`, or `'Order lines'` with quotes. */
function sheetRef(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
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

/** One cell of a sheet as a scan finds it: its place, type, style, value text and formula. */
interface ScannedCell {
  ref: string;
  row: number;
  /** `t`, or `n` when not given. */
  type: string;
  /** `s`, the index in `cellXfs`, or 0. */
  style: number;
  /** The `<v>` text, the shared or inline string, or "" for none. */
  value: string;
  /** True when the cell has a `<v>` or an inline string. */
  hasValue: boolean;
  /** The formula's text; "" for a cell that shares another's formula. */
  formula?: string;
}

/** What a scan of a sheet finds besides its cells. */
interface SheetScan {
  merges: string[];
  pageSetup: boolean;
  conditionalFormatting: string[];
  dataValidations: string[];
  /** The `r:id` of each table part. */
  tableParts: string[];
}

/**
 * Scans one sheet in one pass: each cell (to `onCell`), merges, page setup, conditional
 * formatting, data validation and table parts. Rows and cells without `r` follow the one before.
 */
function scanSheet(xml: string, strings: string[], onCell: (cell: ScannedCell) => void): SheetScan {
  const scan: SheetScan = { merges: [], pageSetup: false, conditionalFormatting: [], dataValidations: [], tableParts: [] };
  let row = 0;
  let column = 0;
  let cell: ScannedCell | null = null;
  let inline: string | null = null;
  let phonetic = 0;
  /** Inside an `x14:conditionalFormatting` or `x14:dataValidation`, whose range is an `xm:sqref` element. */
  let extRange: string[] | null = null;
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
            if (cell.type === "s" && cell.hasValue) cell.value = strings[Number(cell.value)] ?? "";
            else if (cell.type === "inlineStr") {
              cell.value = inline ?? "";
              cell.hasValue = inline !== null;
            }
            onCell(cell);
          }
          cell = null;
        } else {
          const ref = xmlAttribute(el.tag, "r");
          const at = ref ? parseRef(ref) : undefined;
          column = at ? at.column : column + 1;
          if (at) row = at.row;
          cell = el.empty ? null : { ref: `${columnName(column)}${row}`, row, type: xmlAttribute(el.tag, "t") ?? "n", style: Number(xmlAttribute(el.tag, "s") ?? 0) || 0, value: "", hasValue: false };
          inline = null;
        }
        break;
      case "f":
        if (cell && !el.closing) cell.formula = el.empty ? "" : decodeXml(el.content);
        break;
      case "v":
        if (cell && !el.closing && !el.empty) {
          cell.value = decodeXml(el.content);
          cell.hasValue = true;
        }
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
        if (ref && !el.closing) scan.merges.push(ref);
        break;
      }
      case "pageSetup":
        if (!el.closing && ["paperSize", "orientation", "fitToWidth", "fitToHeight", "scale"].some((a) => xmlAttribute(el.tag, a) !== undefined)) {
          scan.pageSetup = true;
        }
        break;
      case "conditionalFormatting":
      case "dataValidation": {
        if (el.closing) {
          extRange = null;
          break;
        }
        const list = el.name === "conditionalFormatting" ? scan.conditionalFormatting : scan.dataValidations;
        const sqref = xmlAttribute(el.tag, "sqref");
        if (sqref) list.push(sqref);
        else if (!el.empty) extRange = list;
        break;
      }
      case "sqref":
        if (extRange && !el.closing && !el.empty && el.content.trim()) extRange.push(el.content.trim());
        break;
      case "tablePart": {
        const id = xmlAttribute(el.tag, "r:id");
        if (id && !el.closing) scan.tableParts.push(id);
        break;
      }
    }
  }
  return scan;
}

/** The parts of the zip `readXlsx` reads: the workbook, sheets and strings, and the notes and tables sheets point to. */
const readPart = (name: string): boolean =>
  name === "xl/workbook.xml" ||
  name === "xl/_rels/workbook.xml.rels" ||
  name === "xl/sharedStrings.xml" ||
  name === "xl/styles.xml" ||
  /^xl\/worksheets\/[^/]+\.xml$/.test(name) ||
  /^xl\/worksheets\/_rels\/[^/]+\.xml\.rels$/.test(name) ||
  /^xl\/(?:[^/]+\/)?comments[^/]*\.xml$/.test(name) ||
  /^xl\/tables\/[^/]+\.xml$/.test(name);

/** The parts of an `.xlsx` that `readPart` takes, as text, within the limits. */
function unzipXlsx(bytes: Uint8Array): (name: string) => string | undefined {
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
  if (!files["xl/workbook.xml"]) {
    throw new Error(`The file is a zip file, but not an Excel workbook: it has no xl/workbook.xml. ${NOT_XLSX}`);
  }
  const decoder = new TextDecoder("utf-8");
  return (name) => (files[name] ? decoder.decode(files[name]) : undefined);
}

/** The sheets of an unzipped workbook that have a file, in the workbook's order. */
function workbookSheets(text: (name: string) => string | undefined): { name: string; file: string; xml: string }[] {
  const sheets = sheetFiles(text("xl/workbook.xml") ?? "", text("xl/_rels/workbook.xml.rels") ?? "").flatMap((s) => {
    const xml = text(s.file);
    return xml === undefined ? [] : [{ ...s, xml }];
  });
  if (sheets.length === 0) throw new Error(`The workbook has no sheets Spooldoc can read. ${NOT_XLSX}`);
  return sheets;
}

/**
 * Reads an Excel template: the text of every cell of every sheet, with its sheet and cell;
 * every formula; and each sheet's merges, page setup, conditional formatting and data
 * validation ranges, notes and Excel tables.
 *
 * @throws Error saying what is wrong with the file and what to do, when it is not a `.xlsx`
 */
export function readXlsx(bytes: Uint8Array): XlsxTemplate {
  const text = unzipXlsx(bytes);
  const strings = readSharedStrings(text("xl/sharedStrings.xml") ?? "");
  const cells: XlsxCell[] = [];
  const formulas: XlsxFormula[] = [];
  const sheets = workbookSheets(text).map(({ name, file, xml }): XlsxSheet => {
    let count = 0;
    const scan = scanSheet(xml, strings, (cell) => {
      if (cell.formula !== undefined) {
        count++;
        if (cell.formula) formulas.push({ sheet: name, ref: cell.ref, row: cell.row, formula: cell.formula });
      } else if (cell.value !== "" && (cell.type === "s" || cell.type === "inlineStr" || cell.type === "str")) {
        cells.push({ sheet: name, ref: cell.ref, row: cell.row, text: cell.value, ...(cell.type === "inlineStr" ? { inline: true as const } : {}) });
      }
    });
    const rels = relationships(text(relsOf(file)) ?? "", file);
    const notes: string[] = [];
    for (const rel of rels) {
      if (rel.type !== "comments" || rel.external) continue;
      for (const el of elements(text(rel.target) ?? "")) {
        const ref = el.name === "comment" && !el.closing ? xmlAttribute(el.tag, "ref") : undefined;
        if (ref) notes.push(ref);
      }
    }
    const tables = scan.tableParts.flatMap((id) => {
      const rel = rels.find((r) => r.id === id && !r.external);
      for (const el of elements(rel ? (text(rel.target) ?? "") : "")) {
        if (el.name !== "table" || el.closing) continue;
        const ref = xmlAttribute(el.tag, "ref");
        return ref ? [{ name: xmlAttribute(el.tag, "displayName") ?? xmlAttribute(el.tag, "name") ?? "", ref }] : [];
      }
      return [];
    });
    return {
      name,
      merges: scan.merges,
      formulas: count,
      pageSetup: scan.pageSetup,
      conditionalFormatting: scan.conditionalFormatting,
      dataValidations: scan.dataValidations,
      notes,
      tables,
    };
  });
  return { sheets, cells, formulas, text: cells.map((c) => c.text).join("\n") };
}

/** A cell of an XLSX as Excel or Carbone computed it. */
export interface XlsxValue {
  sheet: string;
  /** The cell, such as `B5`. */
  ref: string;
  /** As the file stores it: `n` a number, `s` a shared string, `b` a boolean, `e` an error, `str` a formula's text, `inlineStr` an inline string. */
  type: "n" | "s" | "b" | "e" | "str" | "inlineStr";
  /** The number, text or boolean; an error's text such as `#NAME?`; null for a formula cell with no stored value. */
  value: number | string | boolean | null;
  /** The formula, as the file stores it. */
  formula?: string;
  /** The number format, such as `#,##0.00` or `dd.mm.yyyy`, when it is not General. */
  format?: string;
  /** A number in a date or time format, as an ISO date (`2026-10-15`), time (`13:30:00`) or both (`2026-10-15 13:30:00`). */
  display?: string;
}

/** Excel's built-in number formats, by `numFmtId`. Ids 14 to 22 and 45 to 47 are dates and times. */
const BUILTIN_FORMATS: Record<number, string> = {
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  14: "mm-dd-yy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yy h:mm",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mmss.0",
  48: "##0.0E+0",
  49: "@",
};

/** The number format code of each cell format (`cellXfs`), by its index; undefined for General. */
function cellFormats(styles: string): (string | undefined)[] {
  const custom = new Map<number, string>();
  const formats: (string | undefined)[] = [];
  let inCellXfs = false;
  for (const el of elements(styles)) {
    if (el.name === "numFmt" && !el.closing) {
      const id = Number(xmlAttribute(el.tag, "numFmtId"));
      const code = xmlAttribute(el.tag, "formatCode");
      if (code !== undefined) custom.set(id, code);
    } else if (el.name === "cellXfs") {
      inCellXfs = !el.closing && !el.empty;
    } else if (el.name === "xf" && inCellXfs && !el.closing) {
      const id = Number(xmlAttribute(el.tag, "numFmtId") ?? 0);
      formats.push(id === 0 ? undefined : (custom.get(id) ?? BUILTIN_FORMATS[id]));
    }
  }
  return formats;
}

/** Whether a number format shows a date, a time or both: its codes outside quotes, escapes and `[colour]` sections. */
function dateParts(format: string): { date: boolean; time: boolean } {
  const codes = format
    .split(";")[0]!
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[(?![hms]+\])[^\]]*\]/gi, "")
    .replace(/General/gi, "");
  const time = /[hs]/i.test(codes);
  return { date: /[dy]/i.test(codes) || (/m/i.test(codes) && !time), time };
}

/** A date serial as an ISO date, time, or both. Serials below 60 are a day off in Excel's 1900 calendar, which counts 29 February 1900. */
function serialDisplay(serial: number, parts: { date: boolean; time: boolean }, date1904: boolean): string {
  const days = serial + (date1904 ? 1462 : 0) + (!date1904 && serial < 60 ? 1 : 0);
  const iso = new Date(Math.round((days - 25569) * 86_400_000)).toISOString();
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 19);
  return parts.date && parts.time ? `${date} ${time}` : parts.time ? time : date;
}

const VALUE_TYPES = new Set(["n", "s", "b", "e", "str", "inlineStr"]);

/**
 * Reads the cells of an XLSX as Excel or Carbone computed them: every cell with a value or
 * a formula, sheet by sheet, row by row, with its type, value, formula and number format.
 * A number in a date format also comes as a readable ISO date in `display`. Cells with
 * only a style are left out. Rows and cells without `r` follow the one before.
 *
 * @throws Error saying what is wrong with the file, when it is not a `.xlsx`
 */
export function readXlsxValues(bytes: Uint8Array): XlsxValue[] {
  const text = unzipXlsx(bytes);
  const strings = readSharedStrings(text("xl/sharedStrings.xml") ?? "");
  const formats = cellFormats(text("xl/styles.xml") ?? "");
  const workbook = text("xl/workbook.xml") ?? "";
  const workbookPr = /<(?:\w+:)?workbookPr\b[^>]*>/.exec(workbook)?.[0];
  const date1904 = workbookPr !== undefined && /^(1|true)$/.test(xmlAttribute(workbookPr, "date1904") ?? "");
  const values: XlsxValue[] = [];
  for (const { name, xml } of workbookSheets(text)) {
    scanSheet(xml, strings, (cell) => {
      if (!cell.hasValue && cell.formula === undefined) return;
      // `d`, an ISO date cell, is rare: it comes as text.
      const type = (VALUE_TYPES.has(cell.type) ? cell.type : "str") as XlsxValue["type"];
      let value: XlsxValue["value"] = cell.hasValue ? cell.value : null;
      if (cell.hasValue && type === "n") value = Number(cell.value);
      else if (cell.hasValue && type === "b") value = cell.value === "1" || cell.value === "true";
      const format = formats[cell.style];
      const out: XlsxValue = { sheet: name, ref: cell.ref, type, value };
      if (cell.formula) out.formula = cell.formula;
      if (format !== undefined) out.format = format;
      if (format !== undefined && typeof value === "number" && Number.isFinite(value)) {
        const parts = dateParts(format);
        if (parts.date || parts.time) out.display = serialDisplay(value, parts, date1904);
      }
      values.push(out);
    });
  }
  return values;
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
 * - `:formatN` in an inline string cell stays text, so the tag must be a shared string;
 * - conditional formatting, data validation and Excel tables stay on the rows they cover,
 *   so a range that ends on the loop rows (the loop row to the `[i+1]` row) misses the
 *   rows Carbone adds: use whole columns or a far row;
 * - a note at or below the first loop row stays there while the rows move;
 * - a newer function such as XLOOKUP needs its `_xlfn.` prefix in the file, or
 *   LibreOffice computes `#NAME?`;
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
  const lastLoopRow = new Map<string, number>();
  /** In spooled file scope, the cells that read `d.pg`: one problem names the first and counts the rest. */
  const pageGroupCells: { cell: XlsxCell; tag: string; path: string }[] = [];
  for (const cell of template.cells) {
    if (!cell.text.includes("{")) continue;
    const tags = templateTags(cell.text);
    if (tags.some((t) => /\[\s*i\s*(\+\s*1\s*)?\]/.test(t.text))) {
      firstLoopRow.set(cell.sheet, Math.min(firstLoopRow.get(cell.sheet) ?? Infinity, cell.row));
      lastLoopRow.set(cell.sheet, Math.max(lastLoopRow.get(cell.sheet) ?? 0, cell.row));
    }
    if (cell.inline && cell.text.includes(":formatN")) {
      add(
        cell.sheet,
        cell.ref,
        "The cell is an inline string, so Carbone writes :formatN as text and SUM gives 0. Type the tag into the cell again in Excel, which saves it as a shared string.",
      );
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
  for (const formula of template.formulas) {
    for (const { name, prefixed } of missingPrefixes(formula.formula)) {
      add(formula.sheet, formula.ref, `${name} needs its prefix in the file, or LibreOffice computes #NAME?. Write ${prefixed} in the formula.`);
    }
  }
  for (const sheet of template.sheets) {
    const loop = firstLoopRow.get(sheet.name);
    if (loop === undefined) continue;
    const last = lastLoopRow.get(sheet.name)!;
    const rows = loop === last ? `the loop row ${loop}` : `the loop rows ${loop} to ${last}`;
    /** The first range of a list that ends on the loop rows, or undefined. */
    const onLoop = (sqref: string): string | undefined =>
      sqref.split(/\s+/).find((range) => {
        const at = parseRange(range);
        return at !== undefined && at.bottom >= loop && at.bottom <= last;
      });
    const firstCell = (range: string): string => range.replace(/\$/g, "").split(":")[0]!;
    for (const sqref of sheet.conditionalFormatting) {
      const range = onLoop(sqref);
      if (range) {
        add(
          sheet.name,
          firstCell(range),
          `The conditional formatting on ${range} ends on ${rows}, and Carbone does not stretch it over the rows it adds. Apply it to whole columns, or end it on a far row such as 10000.`,
        );
      }
    }
    for (const sqref of sheet.dataValidations) {
      const range = onLoop(sqref);
      if (range) {
        add(
          sheet.name,
          firstCell(range),
          `The data validation on ${range} ends on ${rows}, and Carbone does not stretch it over the rows it adds. Apply it to whole columns, or end it on a far row such as 10000.`,
        );
      }
    }
    for (const table of sheet.tables) {
      if (onLoop(table.ref)) {
        add(
          sheet.name,
          firstCell(table.ref),
          `The Excel table ${table.name} (${table.ref}) ends on ${rows}, and a table does not grow over the rows Carbone adds. Convert it to a range (Table Design, Convert to Range) and use a filter on whole columns.`,
        );
      }
    }
    for (const note of sheet.notes) {
      if ((parseRef(note)?.row ?? 0) >= loop) {
        add(sheet.name, note, `The note is at or below the loop on row ${loop}, and Carbone does not move notes with the rows it adds. Move it above the loop, or delete it.`);
      }
    }
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

// The starter template, written as a design for `buildXlsx`.

type SheetDesign = XlsxDesign["sheets"][number];
type CellDesign = NonNullable<SheetDesign["cells"]>[number];
type StyleDesign = NonNullable<CellDesign["style"]>;

/** The font of every cell of the starter, unless its style says otherwise. */
const STARTER_FONT = { name: "Arial", size: 10, color: "1A1A1A" };

const RULE = { style: "thin", color: "333333" } as const;
const HEADER: StyleDesign = { font: { bold: true }, fill: { type: "pattern", pattern: "solid", fgColor: "E8E8E8" }, border: { bottom: RULE } };
const NUMBER_FORMAT = "#,##0.00";

/** The cell styles of the starter. */
const STYLE = {
  header: HEADER,
  headerNumber: { ...HEADER, alignment: { horizontal: "right" } },
  number: { numFmt: NUMBER_FORMAT },
  date: { numFmt: "dd.mm.yyyy", alignment: { horizontal: "left" } },
  title: { font: { bold: true, size: 14 } },
  totalLabel: { font: { bold: true }, border: { top: RULE } },
  total: { numFmt: NUMBER_FORMAT, font: { bold: true }, border: { top: RULE } },
  label: { font: { color: "555555" } },
} satisfies Record<string, StyleDesign>;

/** "Page 1 of 2" at the right of each page's footer, in 8 points. */
const PAGE_FOOTER = "&R&8Page &P of &N";

/** A cell of the starter: text (which may hold tags) or a formula, with its style. */
type StarterCell = { text: string; style?: StyleDesign } | { formula: string; style?: StyleDesign } | null;

/** A sheet of the starter, before it is written as a design. */
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

const cellStyle = (type?: ValueType): StyleDesign | undefined => (type === "number" ? STYLE.number : type === "date" ? STYLE.date : undefined);
const headerStyle = (type?: ValueType): StyleDesign => (type === "number" ? STYLE.headerNumber : STYLE.header);

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

/** A sheet name Excel takes: at most 31 characters, none of `[]:*?/\`, no apostrophe at either end, not "History", and not one already used. */
function sheetName(wanted: string, used: Set<string>): string {
  const base =
    wanted
      .replace(/[[\]:*?/\\{}]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 31)
      .replace(/^[\s']+|[\s']+$/g, "") || "Sheet";
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()) || name.toLowerCase() === "history"; n++) name = `${base.slice(0, 28)} ${n}`;
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

/** One sheet of the starter as a design: its cells, column widths, header row and page setup. */
function sheetDesign(sheet: StarterSheet): SheetDesign {
  const lastColumn = columnName(Math.max(1, sheet.widths.length, ...sheet.rows.map((r) => r.length)));
  const landscape = sheet.widths.reduce((sum, w) => sum + w, 0) > PORTRAIT_CHARACTERS;
  const cells = sheet.rows.flatMap((row, r) =>
    row.flatMap((cell, c): CellDesign[] => {
      if (!cell) return [];
      const ref = `${columnName(c + 1)}${r + 1}`;
      const style = cell.style ? { style: cell.style } : {};
      if ("formula" in cell) return [{ ref, value: { formula: cell.formula }, ...style }];
      if (cell.text === "") return cell.style ? [{ ref, ...style }] : [];
      return [{ ref, value: cell.text, ...style }];
    }),
  );
  const header = sheet.header;
  return {
    name: sheet.name,
    ...(header ? { views: { frozen: { rows: header.row } } } : {}),
    columns: sheet.widths.map((width, n) => ({ ref: columnName(n + 1), width })),
    cells,
    ...(header?.filter ? { autoFilter: `A${header.row}:${lastColumn}${LAST_ROW}` } : {}),
    pageSetup: {
      paperSize: "A4",
      orientation: landscape ? "landscape" : "portrait",
      fitToWidth: 1,
      fitToHeight: 0,
      ...(header?.printTitles ? { printTitlesRow: `${header.row}:${header.row}` } : {}),
    },
    headerFooter: { oddFooter: PAGE_FOOTER },
  };
}

/**
 * The design of the Excel starter template for a definition, as `buildXlsx` takes it: see
 * `starterXlsx`.
 */
function starterXlsxDesign(def: Definition, scope: XlsxScope = "splf"): XlsxDesign {
  const { title, fields, blocks } = starterLayout(def);
  const used = new Set<string>();
  const usable = blocks.filter((b) => b.columns.length > 0);
  const sheets: StarterSheet[] =
    scope === "pageGroup"
      ? pageGroupSheets(title, fields, usable, used)
      : usable.length === 0
        ? [flatSheet(sheetName(withoutTags(title), used), fields, undefined)]
        : usable.map((block) => flatSheet(sheetName(fieldLabel(block.name), used), fields, block));
  return { defaultFont: STARTER_FONT, sheets: sheets.map(sheetDesign) };
}

/**
 * An Excel starter template for a definition, built from `starterLayout`, that keeps every
 * rule of Carbone's Excel output: numbers with `:formatN` in number-formatted cells, dates as
 * Excel serials in date-formatted cells, totals (per page group) that stay right when rows are added, no
 * merged cells, and a page setup on each sheet for the PDF: A4, landscape when the columns are
 * wider than portrait fits, one page wide, the header row on each page and "Page 1 of 2" in
 * the footer. The user opens it in Excel, styles it, and uploads it. It is a design written
 * with `buildXlsx`, as the agent's designs are.
 *
 * - `splf` (the default): a flat sheet per table, record or group, with a row per line and
 *   the page group's fields repeated on each row, and a frozen header row with a filter on
 *   the whole columns. No totals. Without a table, a row per page group.
 * - `pageGroup`: the title and the fields, then a table for each table, record or group,
 *   each with its total under it.
 */
export async function starterXlsx(def: Definition, scope: XlsxScope = "splf"): Promise<Uint8Array> {
  return buildXlsx(starterXlsxDesign(def, scope));
}
