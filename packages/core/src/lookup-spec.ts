import { z } from "zod";

/*
 * A lookup: one SELECT against Db2 for i that runs between extract and render. It takes
 * values of the page group as bound parameters and adds its rows to the page group's
 * data. This module imports nothing but zod, so the browser can import it as
 * `@spooldoc/core/lookups`.
 */

/** How many rows a lookup that reads all rows may return. More stops the run. */
export const MAX_LOOKUP_ROWS = 1000;

/** How long Db2 for i may run one lookup query before it is canceled. */
export const LOOKUP_TIMEOUT_SECONDS = 30;

/** A name templates can read: letters, digits and underscores, starting with a letter or underscore. */
export const LOOKUP_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A result column as Test found it, with the value type its Db2 type maps to. */
export const lookupColumnSchema = z
  .object({ name: z.string().min(1).max(128), type: z.enum(["string", "number", "date"]) })
  .strict();
export type LookupColumn = z.infer<typeof lookupColumnSchema>;

/** How many rows a lookup table may hold. */
export const MAX_TABLE_ROWS = 10_000;

/** How many columns a lookup table may have. */
export const MAX_TABLE_COLUMNS = 50;

/** How many characters a cell of a lookup table may hold. */
export const MAX_CELL_LENGTH = 1000;

/** How many key columns a table lookup may match on. */
export const MAX_LOOKUP_KEYS = 5;

/** A lookup table's name: lowercase letters, digits, hyphens and underscores, as asset names. */
export const LOOKUP_TABLE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** A parameter of a table lookup's key, without its colon: `termsCode` or `customer.LANG`. */
export const LOOKUP_PARAMETER = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/;

/** The fields every lookup has, whatever it reads from. */
const lookupFields = {
  /** The key of its value in the data: `{d.pg.customer.EMAIL}`. */
  name: z.string().max(64),
  /** A table of the definition: the lookup runs once per row of it. Omitted: once per page group. */
  for: z.string().max(64).optional(),
  /** `one`: the row as an object. `many`: every row as a list. */
  result: z.enum(["one", "many"]).default("one"),
  /** When no row is found: stop the run, warn and leave it empty, or leave it empty. */
  missing: z.enum(["fail", "warn", "empty"]).default("warn"),
};

/**
 * A lookup that runs one SELECT on Db2 for i. Lookups stored before lookup tables have no
 * `source`, and are this kind.
 */
export const db2LookupSchema = z
  .object({
    source: z.literal("db2").optional(),
    ...lookupFields,
    /** One SELECT, with parameters such as `:customerNo`. */
    sql: z.string().max(20_000),
    /** What the last Test found: the SQL it tested and its result columns. */
    checked: z.object({ sql: z.string(), columns: z.array(lookupColumnSchema) }).strict().optional(),
  })
  .strict();
export type Db2Lookup = z.infer<typeof db2LookupSchema>;

/** One key column of a table lookup: the column, and the parameter whose value it must equal. */
export const lookupKeySchema = z
  .object({
    /** A column of the lookup table. */
    column: z.string().max(128),
    /** A field of the page group, or a column of the row or of an earlier lookup, without the colon: `termsCode`. */
    param: z.string().max(200),
  })
  .strict();
export type LookupKey = z.infer<typeof lookupKeySchema>;

/** A lookup that matches rows of a lookup table kept in Spooldoc, with no SQL. */
export const tableLookupSchema = z
  .object({
    source: z.literal("table"),
    ...lookupFields,
    /** The lookup table's id; empty until one is picked. */
    table: z.string().max(64),
    /** The columns that must equal the values named. */
    key: z.array(lookupKeySchema).min(1).max(MAX_LOOKUP_KEYS, `A lookup matches on up to ${MAX_LOOKUP_KEYS} key columns.`),
    /** What the last Test found: the table and key it tested, the table's name then, and its columns. */
    checked: z
      .object({ table: z.string(), tableName: z.string().optional(), key: z.string(), columns: z.array(lookupColumnSchema) })
      .strict()
      .optional(),
  })
  .strict();
export type TableLookup = z.infer<typeof tableLookupSchema>;

/**
 * A lookup as a job stores it: a Db2 for i lookup, or a table lookup, by `source`. A stored
 * lookup without `source` is a Db2 for i lookup. Picking the kind by `source` keeps the
 * messages of each kind's own rules, such as the most key columns. A draft may hold one
 * that is not complete yet, such as a name that is not an identifier; `lookupProblems`
 * says what is wrong.
 */
export const lookupSchema = z.discriminatedUnion("source", [db2LookupSchema, tableLookupSchema]);
export type Lookup = Db2Lookup | TableLookup;

export const lookupsSchema = z.array(lookupSchema).max(20, "A job takes up to 20 lookups.");

/** True for a lookup that reads a lookup table. */
export const isTableLookup = (lookup: Lookup): lookup is TableLookup => lookup.source === "table";

/** A table lookup's key as one string, to tell whether it changed since its test. */
export const lookupKeyText = (key: readonly LookupKey[]): string => JSON.stringify(key.map((k) => [k.column, k.param]));

/** What a lookup reads, as a string that changes whenever the lookup needs another test. */
export const lookupSubject = (lookup: Lookup): string => (lookup.source === "table" ? `${lookup.table}\n${lookupKeyText(lookup.key)}` : lookup.sql);

/** What a lookup's last Test read, in the form of `lookupSubject`; undefined when it was never tested. */
export function checkedSubject(lookup: Lookup): string | undefined {
  if (lookup.source === "table") return lookup.checked ? `${lookup.checked.table}\n${lookup.checked.key}` : undefined;
  return lookup.checked?.sql;
}

/** True for a lookup that was never tested, or that changed since its test: its SQL, or its table and key. */
export const lookupUntested = (lookup: Lookup): boolean => checkedSubject(lookup) !== lookupSubject(lookup);

/** The value names a lookup reads: its SQL's parameters, or its key's parameters, in order. */
export function lookupParameterNames(lookup: Lookup): string[] {
  if (lookup.source === "table") return lookup.key.map((k) => k.param.trim().replace(/^:/, ""));
  return sqlParameters(lookup.sql).map((p) => p.name);
}

/** A column of a lookup table: a name templates can read, and its type. */
export const lookupTableColumnSchema = z
  .object({
    name: z
      .string()
      .min(1, "Give each column a name.")
      .max(128)
      .regex(LOOKUP_NAME, "Column names use letters, digits and underscores, starting with a letter."),
    type: z.enum(["string", "number", "date"]),
  })
  .strict();
export type LookupTableColumn = z.infer<typeof lookupTableColumnSchema>;

/** A cell: text, a number, a date as `YYYY-MM-DD`, or empty. */
export type LookupTableCell = string | number | null;

/** True for `YYYY-MM-DD` that names a real day. */
export function isIsoDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Whether a cell fits its column's type. Empty fits every type. */
export function cellFits(cell: LookupTableCell, type: LookupTableColumn["type"]): boolean {
  if (cell === null) return true;
  if (type === "number") return typeof cell === "number" && Number.isFinite(cell);
  if (type === "date") return typeof cell === "string" && isIsoDate(cell);
  return typeof cell === "string";
}

/** What a column of the type holds, for messages: "a number". */
export const cellKind = (type: LookupTableColumn["type"]): string => (type === "number" ? "a number" : type === "date" ? "a date, YYYY-MM-DD" : "text");

/**
 * The columns and rows of a lookup table, as stored and as the API takes them. Rows are
 * positional, one cell per column, and each cell fits its column's type.
 */
export const lookupTableContentSchema = z
  .object({
    columns: z
      .array(lookupTableColumnSchema)
      .min(1, "A table needs at least one column.")
      .max(MAX_TABLE_COLUMNS, `A table has up to ${MAX_TABLE_COLUMNS} columns.`),
    rows: z
      .array(z.array(z.union([z.string(), z.number(), z.null()])))
      .max(MAX_TABLE_ROWS, `A table has up to ${MAX_TABLE_ROWS.toLocaleString("en-US")} rows.`),
  })
  .strict()
  .superRefine((table, ctx) => {
    const seen = new Set<string>();
    for (const column of table.columns) {
      if (seen.has(column.name)) {
        ctx.addIssue({ code: "custom", message: `Two columns are named ${column.name}. Give each its own name.`, path: ["columns"] });
        return;
      }
      seen.add(column.name);
    }
    for (const [r, row] of table.rows.entries()) {
      if (row.length !== table.columns.length) {
        ctx.addIssue({ code: "custom", message: `Row ${r + 1} has ${row.length} cells, and the table has ${table.columns.length} columns.`, path: ["rows", r] });
        return;
      }
      for (const [c, cell] of row.entries()) {
        const column = table.columns[c]!;
        if (typeof cell === "string" && cell.length > MAX_CELL_LENGTH) {
          ctx.addIssue({ code: "custom", message: `Row ${r + 1}, column ${column.name} holds more than ${MAX_CELL_LENGTH.toLocaleString("en-US")} characters, the most a cell takes.`, path: ["rows", r, c] });
          return;
        }
        if (!cellFits(cell, column.type)) {
          ctx.addIssue({ code: "custom", message: `Row ${r + 1}, column ${column.name} is not ${cellKind(column.type)}.`, path: ["rows", r, c] });
          return;
        }
      }
    }
  });
export type LookupTableContent = z.infer<typeof lookupTableContentSchema>;

/** A lookup table as runs, the preview and Test read it. */
export interface LookupTableData extends LookupTableContent {
  id: string;
  name: string;
  /** Goes up by one on every save. */
  revision: number;
}

/**
 * The statement with string constants, delimited names and comments blanked out, so what
 * is left is keywords, names and punctuation. Blanking keeps every offset. An unclosed
 * string or comment runs to the end, which Db2 for i reports as a syntax error.
 */
export function sqlOutsideLiterals(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const next = sql[i + 1];
    let end = i + 1;
    if (c === "'" || c === '"') {
      // A doubled quote inside is the quote itself.
      end = i + 1;
      for (;;) {
        const at = sql.indexOf(c, end);
        if (at < 0) {
          end = sql.length;
          break;
        }
        if (sql[at + 1] === c) {
          end = at + 2;
          continue;
        }
        end = at + 1;
        break;
      }
    } else if (c === "-" && next === "-") {
      const at = sql.indexOf("\n", i);
      end = at < 0 ? sql.length : at;
    } else if (c === "/" && next === "*") {
      const at = sql.indexOf("*/", i + 2);
      end = at < 0 ? sql.length : at + 2;
    } else {
      out += c;
      i++;
      continue;
    }
    out += sql.slice(i, end).replace(/[^\n]/g, " ");
    i = end;
  }
  return out;
}

/** A parameter in a lookup's SQL: its name, such as `customerNo` or `customer.LANG`, and where it is. */
export interface SqlParameter {
  name: string;
  /** Offset of the colon. */
  start: number;
  /** Offset after the name. */
  end: number;
}

/** `:name` and `:lookup.COLUMN`, not after a letter, digit or colon. */
const PARAMETER = /(?<![\w:]):([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)/g;

/** The parameters of a lookup's SQL, in order. A `:` inside a string constant, a delimited name or a comment is not one. */
export function sqlParameters(sql: string): SqlParameter[] {
  return [...sqlOutsideLiterals(sql).matchAll(PARAMETER)].map((m) => ({ name: m[1]!, start: m.index, end: m.index + m[0].length }));
}

/**
 * The SQL with each parameter replaced by a `?` marker, and the names in the order of the
 * markers. A name used twice is bound twice. The values are bound, never written into
 * the SQL.
 */
export function bindParameters(sql: string): { sql: string; names: string[] } {
  const parameters = sqlParameters(sql);
  let out = "";
  let from = 0;
  for (const p of parameters) {
    out += `${sql.slice(from, p.start)}?`;
    from = p.end;
  }
  return { sql: out + sql.slice(from), names: parameters.map((p) => p.name) };
}

/** The value type a Db2 for i column type maps to: numbers to `number`, DATE to `date`, the rest to `string`. */
export function db2ValueType(type: string): LookupColumn["type"] {
  const t = type.toUpperCase();
  if (/^(DECIMAL|NUMERIC|INTEGER|INT|SMALLINT|BIGINT|REAL|DOUBLE|FLOAT|DECFLOAT)\b/.test(t)) return "number";
  if (t === "DATE") return "date";
  return "string";
}

/** A path a lookup adds to the data, relative to the page group, as the template check compares it. */
export interface LookupDataPath {
  /** `customer`, `customer.EMAIL`, `contacts[].EMAIL`, or for a row lookup `lines[].product.PRICE`. */
  path: string;
  /** The column's value type; none for the lookup itself. */
  type?: LookupColumn["type"];
}

/**
 * The paths the lookups add to a page group: each lookup's own, and its columns as its
 * last Test found them. A lookup that was never tested adds no columns.
 */
export function lookupDataPaths(lookups: readonly Lookup[]): LookupDataPath[] {
  const paths: LookupDataPath[] = [];
  for (const lookup of lookups) {
    if (!LOOKUP_NAME.test(lookup.name)) continue;
    const base = lookup.for ? `${lookup.for}[].${lookup.name}` : lookup.name;
    paths.push({ path: base });
    for (const column of lookup.checked?.columns ?? []) {
      paths.push({ path: lookup.result === "many" ? `${base}[].${column.name}` : `${base}.${column.name}`, type: column.type });
    }
  }
  return paths;
}

/** A value at a dotted path such as `customer.LANG`, looked up in each scope in turn: the row first, then the page group. */
export function parameterValue(name: string, scopes: readonly Record<string, unknown>[]): { found: boolean; value: unknown } {
  const [head = "", ...rest] = name.split(".");
  for (const scope of scopes) {
    if (!(head in scope)) continue;
    let value: unknown = scope[head];
    for (const part of rest) {
      if (value === null || typeof value !== "object" || Array.isArray(value) || !(part in value)) return { found: false, value: undefined };
      value = (value as Record<string, unknown>)[part];
    }
    return { found: true, value };
  }
  return { found: false, value: undefined };
}
