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

/**
 * A lookup as a job stores it. A draft may hold one that is not complete yet, such as a
 * name that is not an identifier; `lookupProblems` says what is wrong.
 */
export const lookupSchema = z
  .object({
    /** The key of its value in the data: `{d.pg.customer.EMAIL}`. */
    name: z.string().max(64),
    /** A table of the definition: the lookup runs once per row of it. Omitted: once per page group. */
    for: z.string().max(64).optional(),
    /** One SELECT, with parameters such as `:customerNo`. */
    sql: z.string().max(20_000),
    /** `one`: the row as an object. `many`: every row as a list. */
    result: z.enum(["one", "many"]).default("one"),
    /** When no row is found: stop the run, warn and leave it empty, or leave it empty. */
    missing: z.enum(["fail", "warn", "empty"]).default("warn"),
    /** What the last Test found: the SQL it tested and its result columns. */
    checked: z.object({ sql: z.string(), columns: z.array(lookupColumnSchema) }).strict().optional(),
  })
  .strict();
export type Lookup = z.infer<typeof lookupSchema>;

export const lookupsSchema = z.array(lookupSchema).max(20, "A job takes up to 20 lookups.");

/** True for a lookup that was never tested, or whose SQL changed since its test. */
export const lookupUntested = (lookup: Pick<Lookup, "sql" | "checked">): boolean => lookup.checked?.sql !== lookup.sql;

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
