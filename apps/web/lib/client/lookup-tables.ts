import { csvDate, numberText } from '@spooldoc/core/csv';
import { cellKind, type LookupTableCell, type LookupTableColumn } from '@spooldoc/core/lookups';
import { parseNumber } from '@spooldoc/core/values';
import { toast } from 'sonner';
import { errorText } from './api';
import { download } from './download';

/** A column as the table page edits it: its name and type, and its name when it was last saved. */
export interface EditColumn extends LookupTableColumn {
  /** The saved name, which jobs may print or key on; none for a column added since. */
  saved?: string;
}

/** A cell as the grid shows it: empty, a number with a decimal point and no exponent, a date as `YYYY-MM-DD`, or the text. */
export const cellText = (cell: LookupTableCell): string => (cell === null ? '' : typeof cell === 'number' ? numberText(cell) : cell);

/**
 * What a cell's text is in a column of the type: empty for blank text, a number as
 * `parseNumber` reads it (`1.5`, `1,5`, `1 234,50`), a date as `YYYY-MM-DD` or `DD.MM.YYYY`, or the text as it is.
 * `ok` is false when the text does not fit the type.
 */
export function parseCell(text: string, type: LookupTableColumn['type']): { cell: LookupTableCell; ok: boolean } {
  const trimmed = text.trim();
  if (trimmed === '') return { cell: null, ok: true };
  if (type === 'number') {
    const n = parseNumber(trimmed);
    return n === null ? { cell: null, ok: false } : { cell: n, ok: true };
  }
  if (type === 'date') {
    const date = csvDate(trimmed);
    return date === null ? { cell: null, ok: false } : { cell: date, ok: true };
  }
  return { cell: text, ok: true };
}

/** The cells, by row and column, that do not fit their column's type. */
export function badCells(columns: readonly LookupTableColumn[], rows: readonly (readonly string[])[]): { row: number; column: number }[] {
  const bad: { row: number; column: number }[] = [];
  for (const [r, row] of rows.entries()) {
    for (const [c, column] of columns.entries()) {
      if (!parseCell(row[c] ?? '', column.type).ok) bad.push({ row: r, column: c });
    }
  }
  return bad;
}

/** "2 cells do not fit their column. The first is row 12, column RATE, which takes a number." */
export function badCellsText(columns: readonly LookupTableColumn[], bad: readonly { row: number; column: number }[]): string | null {
  const first = bad[0];
  if (!first) return null;
  const column = columns[first.column]!;
  const count = bad.length === 1 ? 'A cell does not fit its column.' : `${bad.length.toLocaleString('en-US')} cells do not fit their column.`;
  return `${count} ${bad.length === 1 ? 'It' : 'The first'} is row ${first.row + 1}, column ${column.name}, which takes ${cellKind(column.type)}.`;
}

/** The rows as the API takes them: each cell typed by its column. Call only when `badCells` finds none. */
export const toCells = (columns: readonly LookupTableColumn[], rows: readonly (readonly string[])[]): LookupTableCell[][] =>
  rows.map((row) => columns.map((column, c) => parseCell(row[c] ?? '', column.type).cell));

/** The indexes of the rows that hold the filter text in any cell, ignoring case; every row for no filter. */
export function filterRows(rows: readonly (readonly string[])[], filter: string): number[] {
  const needle = filter.trim().toLowerCase();
  const all = rows.map((_, i) => i);
  if (!needle) return all;
  return all.filter((i) => rows[i]!.some((text) => text.toLowerCase().includes(needle)));
}

/** A new column's name: COLUMN_1, COLUMN_2, ..., one no other column has. */
export function newColumnName(columns: readonly { name: string }[]): string {
  for (let n = columns.length + 1; ; n++) {
    const name = `COLUMN_${n}`;
    if (!columns.some((c) => c.name === name)) return name;
  }
}

/** The label of a column type in the page: Text, Number or Date. */
export const TYPE_LABEL: Record<LookupTableColumn['type'], string> = { string: 'Text', number: 'Number', date: 'Date' };

/** The jobs by name, for a sentence: "MYJOB", "MYJOB and OTHERJOB", "A, B and C". */
export function jobNames(jobs: readonly { name: string }[]): string {
  const names = jobs.map((j) => j.name);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** Save a lookup table as a CSV file, as last saved. A failure shows as a toast. */
export async function downloadCsv(table: { id: string; name: string }): Promise<void> {
  try {
    const response = await fetch(`/api/lookup-tables/${table.id}/csv`);
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `The server answered HTTP ${response.status}. Try again.`);
    }
    await download(response, `${table.name}.csv`);
  } catch (err) {
    toast.error(`Could not download ${table.name}`, { description: errorText(err) });
  }
}

/**
 * A file's text: UTF-8, or Windows-1252 when the bytes are not UTF-8, as an older
 * spreadsheet saves CSV. `fallback` says the second was used.
 */
export function decodeCsv(bytes: ArrayBuffer | Uint8Array):{ text: string; fallback: boolean } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), fallback: false };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), fallback: true };
  }
}
