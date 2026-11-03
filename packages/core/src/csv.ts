import {
  LOOKUP_NAME,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  type LookupTableCell,
  type LookupTableColumn,
} from "./lookup-spec.js";
import { parseDate } from "./values.js";

/*
 * CSV for lookup tables: read what a spreadsheet saves or a user pastes, and write what a
 * spreadsheet opens. Imports nothing but the lookup spec, so the browser can import it as
 * `@spooldoc/core/csv`.
 */

/** The delimiters a CSV may use. */
export type CsvDelimiter = "," | ";" | "\t";

const DELIMITERS: readonly CsvDelimiter[] = [",", ";", "\t"];

/** "comma", "semicolon" or "tab", for messages and the import preview. */
export const delimiterName = (delimiter: CsvDelimiter): string => (delimiter === "," ? "comma" : delimiter === ";" ? "semicolon" : "tab");

/** Why a CSV could not be read: the message names the row or column and says what to do. */
export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

/** How many times each delimiter splits the first record, outside quotes. */
function firstRecordCounts(text: string): Map<CsvDelimiter, number> {
  const counts = new Map<CsvDelimiter, number>(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "\n" || c === "\r")) break;
    else if (!quoted && counts.has(c as CsvDelimiter)) counts.set(c as CsvDelimiter, counts.get(c as CsvDelimiter)! + 1);
  }
  return counts;
}

/**
 * The delimiter of a CSV: the one of comma, semicolon and tab that splits the first
 * record most often. Tab wins a tie, since pasted cells use it, then semicolon. One
 * column with none of them is comma.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const counts = firstRecordCounts(text.replace(/^﻿/, ""));
  let best: CsvDelimiter = ",";
  let most = 0;
  for (const d of ["\t", ";", ","] as const) {
    const n = counts.get(d)!;
    if (n > most) {
      best = d;
      most = n;
    }
  }
  return best;
}

/**
 * Splits CSV text into records of fields, as RFC 4180 reads it: a field in double quotes
 * may hold the delimiter, line breaks and doubled quotes. A BOM at the start is dropped.
 * Lines end in CRLF or LF. Empty lines are skipped.
 */
export function parseCsv(text: string, delimiter: CsvDelimiter = detectDelimiter(text)): string[][] {
  const s = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let wasQuoted = false;
  const endField = (): void => {
    record.push(field);
    field = "";
    wasQuoted = false;
  };
  const endRecord = (): void => {
    const quotedField = wasQuoted;
    endField();
    if (record.length > 1 || record[0] !== "" || quotedField) records.push(record);
    record = [];
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") {
      quoted = true;
      wasQuoted = true;
    } else if (c === delimiter) {
      endField();
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      endRecord();
    } else field += c;
  }
  if (quoted) throw new CsvError("A quoted field is not closed. Check the CSV for a missing double quote.");
  if (field !== "" || record.length > 0) endRecord();
  return records;
}

/** A cell's text as a number, with a decimal point, or a decimal comma when `decimalComma`; null when it is not one. */
export function csvNumber(text: string, decimalComma: boolean): number | null {
  let s = text.trim().replace(/[\s ]/g, "");
  if (s === "") return null;
  // A code with a leading zero, such as 007, stays text.
  if (/^[-+]?0\d/.test(s)) return null;
  if (decimalComma) {
    if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "");
    if (s.includes(".")) return null;
    s = s.replace(",", ".");
  }
  if (!/^[-+]?(\d+(\.\d+)?|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** A cell's text as a date, `YYYY-MM-DD` or `DD.MM.YYYY`, in ISO form; null when it is not one. */
export const csvDate = (text: string): string | null => parseDate(text.trim());

/**
 * The type of each column, from its cells: number when every cell that is not empty is a
 * number, else date when every one is a date, else text. A column with no values is text.
 */
export function detectTypes(rows: readonly (readonly string[])[], columns: number, decimalComma: boolean): LookupTableColumn["type"][] {
  return Array.from({ length: columns }, (_, c) => {
    const values = rows.map((row) => (row[c] ?? "").trim()).filter((v) => v !== "");
    if (values.length === 0) return "string";
    if (values.every((v) => csvNumber(v, decimalComma) !== null)) return "number";
    if (values.every((v) => csvDate(v) !== null)) return "date";
    return "string";
  });
}

/** A cell's text as its column's type has it. Empty text is an empty cell. */
export function csvCell(text: string, type: LookupTableColumn["type"], decimalComma: boolean): LookupTableCell {
  if (text.trim() === "") return null;
  if (type === "number") return csvNumber(text, decimalComma);
  if (type === "date") return csvDate(text);
  return text;
}

/** What a CSV holds as a lookup table, and how it was read. */
export interface CsvTable {
  delimiter: CsvDelimiter;
  /** True when numbers were read with a decimal comma: the delimiter is a semicolon. */
  decimalComma: boolean;
  columns: LookupTableColumn[];
  rows: LookupTableCell[][];
}

/**
 * Reads a CSV with a header row as a lookup table: detects the delimiter, reads decimal
 * commas when it is a semicolon, and types each column.
 *
 * @throws CsvError naming the column or row when a header is not a name templates can
 *   read or is used twice, a row has more cells than the header, or the table is too big
 */
export function csvToTable(text: string): CsvTable {
  const delimiter = detectDelimiter(text);
  const decimalComma = delimiter === ";";
  const records = parseCsv(text, delimiter);
  const [header, ...body] = records;
  if (!header) throw new CsvError("The CSV is empty. Its first row names the columns, such as CODE,TEXT.");
  const names = header.map((h) => h.trim());
  if (names.length > MAX_TABLE_COLUMNS) throw new CsvError(`The CSV has ${names.length} columns. A table has up to ${MAX_TABLE_COLUMNS}.`);
  if (body.length > MAX_TABLE_ROWS) {
    throw new CsvError(`The CSV has ${body.length.toLocaleString("en-US")} rows. A table has up to ${MAX_TABLE_ROWS.toLocaleString("en-US")}.`);
  }
  const seen = new Set<string>();
  for (const [i, name] of names.entries()) {
    if (!name) throw new CsvError(`Column ${i + 1} of the CSV has no name. Name it in the first row.`);
    if (!LOOKUP_NAME.test(name)) {
      throw new CsvError(`Column ${i + 1} of the CSV is named "${name}", which templates cannot read. Use letters, digits and underscores, starting with a letter, such as ${suggestName(name)}.`);
    }
    if (seen.has(name)) throw new CsvError(`Two columns of the CSV are named ${name}. Give each its own name.`);
    seen.add(name);
  }
  const width = names.length;
  for (const [r, row] of body.entries()) {
    if (row.length > width && row.slice(width).some((cell) => cell.trim() !== "")) {
      throw new CsvError(`Row ${r + 2} of the CSV has ${row.length} cells, and the first row names ${width} columns. Check the delimiters and quotes in that row.`);
    }
  }
  const types = detectTypes(body, width, decimalComma);
  return {
    delimiter,
    decimalComma,
    columns: names.map((name, i) => ({ name, type: types[i]! })),
    rows: body.map((row) => types.map((type, c) => csvCell(row[c] ?? "", type, decimalComma))),
  };
}

/** A name templates can read made from a header: "Due date" gives DUE_DATE. */
function suggestName(header: string): string {
  const name = header
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  if (!name) return "COLUMN_1";
  return /^[0-9]/.test(name) ? `C_${name}` : name;
}

/** A field as CSV writes it: quoted when it holds a comma, a quote, a line break, or space at either end. */
function csvField(cell: LookupTableCell): string {
  if (cell === null) return "";
  const text = typeof cell === "number" ? String(cell) : cell;
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * A lookup table as CSV: UTF-8 with a BOM, so a spreadsheet reads ä and ö, comma
 * delimited, numbers with a decimal point, dates as `YYYY-MM-DD`, lines ending in CRLF.
 */
export function toCsv(columns: readonly Pick<LookupTableColumn, "name">[], rows: readonly (readonly LookupTableCell[])[]): string {
  const lines = [columns.map((c) => csvField(c.name)).join(","), ...rows.map((row) => columns.map((_, i) => csvField(row[i] ?? null)).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
