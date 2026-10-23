import type { Definition } from "./definition.js";
import {
  bindParameters,
  db2ValueType,
  LOOKUP_NAME,
  LOOKUP_TIMEOUT_SECONDS,
  lookupUntested,
  MAX_LOOKUP_ROWS,
  parameterValue,
  sqlParameters,
  type Lookup,
} from "./lookup-spec.js";
import { starterLayout } from "./template.js";
import { convertValue } from "./values.js";

/** A problem with one lookup of a job, by its index. */
export interface LookupProblem {
  index: number;
  message: string;
}

/** The names a definition gives a page group: its fields, and its tables with their columns. */
function shapeOf(def: Definition): { fields: Set<string>; tables: Map<string, Set<string>> } {
  const { fields, blocks } = starterLayout(def);
  return {
    fields: new Set(fields.map((f) => f.name)),
    tables: new Map(blocks.map((b) => [b.name, new Set(b.columns.map((c) => c.name))])),
  };
}

/** "once per page group" or "once per row of lines", for messages. */
export const lookupRuns = (lookup: Pick<Lookup, "for">): string => (lookup.for ? `once per row of ${lookup.for}` : "once per page group");

/**
 * What is wrong with a job's lookups, checked without the IBM i:
 *
 * - each name is one templates can read, is used once, and is no field or table of the
 *   definition (for a row lookup: no column of its table);
 * - `for` names a table of the definition;
 * - the SQL is there, and each parameter names a field of the page group, a column of
 *   the row, or a column of an earlier lookup that reads one row. A name that is both a
 *   column of the row and a field of the page group is a problem, so the user renames one.
 *
 * Without a definition (it does not parse), only the names and the SQL are checked.
 * Whether each lookup was tested is `lookupTestProblems`.
 */
export function lookupProblems(def: Definition | null, lookups: readonly Lookup[]): LookupProblem[] {
  const problems: LookupProblem[] = [];
  const shape = def ? shapeOf(def) : null;
  const seen = new Set<string>();
  lookups.forEach((lookup, index) => {
    const add = (message: string): void => {
      problems.push({ index, message });
    };
    const name = lookup.name.trim();
    const label = name || `Lookup ${index + 1}`;
    if (!name) add(`Lookup ${index + 1} has no name. Give it one, such as customer.`);
    else if (!LOOKUP_NAME.test(name)) add(`${name} is not a name templates can read. Use letters, digits and underscores, starting with a letter.`);
    else if (seen.has(name)) add(`Two lookups are named ${name}. Give each its own name.`);
    seen.add(name);
    const earlier = lookups.slice(0, index);
    const later = lookups.slice(index + 1);
    if (shape && name) {
      if (lookup.for !== undefined && !shape.tables.has(lookup.for)) {
        add(`${label} runs once per row of ${lookup.for}, but the definition has no table ${lookup.for}. Pick another table.`);
      } else if (lookup.for !== undefined) {
        if (shape.tables.get(lookup.for)!.has(name)) add(`${name} is already a column of ${lookup.for}. Give the lookup another name.`);
      } else if (shape.fields.has(name)) {
        add(`${name} is already a field of the definition. Give the lookup another name.`);
      } else if (shape.tables.has(name)) {
        add(`${name} is already a table of the definition. Give the lookup another name.`);
      }
    }
    if (!lookup.sql.trim()) {
      add(`Write the SQL of ${label}.`);
      return;
    }
    if (!shape) return;
    const rowColumns = lookup.for !== undefined ? shape.tables.get(lookup.for) : undefined;
    if (lookup.for !== undefined && !rowColumns) return;
    const reported = new Set<string>();
    for (const { name: parameter } of sqlParameters(lookup.sql)) {
      if (reported.has(parameter)) continue;
      reported.add(parameter);
      const problem = parameterProblem(parameter, lookup, shape, rowColumns, earlier, later);
      if (problem) add(problem);
    }
  });
  return problems;
}

/** What is wrong with one parameter of a lookup, or null. */
function parameterProblem(
  parameter: string,
  lookup: Lookup,
  shape: { fields: Set<string>; tables: Map<string, Set<string>> },
  rowColumns: Set<string> | undefined,
  earlier: readonly Lookup[],
  later: readonly Lookup[],
): string | null {
  const [head = "", column] = parameter.split(".");
  const rowLookup = rowColumns ? earlier.find((l) => l.for === lookup.for && l.name === head) : undefined;
  const pageLookup = earlier.find((l) => l.for === undefined && l.name === head);
  const inRow = rowColumns !== undefined && (rowColumns.has(head) || rowLookup !== undefined);
  const inPage = shape.fields.has(head) || shape.tables.has(head) || pageLookup !== undefined;
  if (inRow && inPage) {
    return `:${parameter} is both a column of ${lookup.for} and a field of the page group. Rename one of them.`;
  }
  const from = rowLookup ?? (inRow ? undefined : pageLookup);
  if (from) {
    if (from.result === "many") return `:${parameter} reads every row of ${from.name}, and a parameter takes one value. Read one row in ${from.name}.`;
    if (column === undefined) return `:${parameter} is a whole row of ${from.name}. Name one of its columns, such as :${from.name}.${from.checked?.columns[0]?.name ?? "EMAIL"}.`;
    if (from.checked && !lookupUntested(from) && !from.checked.columns.some((c) => c.name === column)) {
      return `${from.name} has no column ${column}. Its columns are ${from.checked.columns.map((c) => c.name).join(", ")}.`;
    }
    return null;
  }
  if (inRow || shape.fields.has(head)) {
    return column === undefined ? null : `:${parameter} reads ${column} of ${head}, but ${head} is a single value. Write :${head}.`;
  }
  if (shape.tables.has(head)) {
    return `:${parameter} is the table ${head}, and a parameter takes one value. To run once per row, set Runs to once per row of ${head}.`;
  }
  if (later.some((l) => l.name === head)) return `:${parameter} reads ${head}, which runs after ${lookup.name || "this lookup"}. Move ${head} above it.`;
  const where = lookup.for ? `a field of the page group, a column of ${lookup.for}` : "a field of the page group";
  return `:${parameter} is not ${where} or an earlier lookup. Check the name against the definition.`;
}

/** Lookups that were never tested or changed since: one problem each. Saving a version needs none. */
export function lookupTestProblems(lookups: readonly Lookup[]): LookupProblem[] {
  return lookups.flatMap((lookup, index) => {
    if (!lookupUntested(lookup)) return [];
    const name = lookup.name.trim() || `Lookup ${index + 1}`;
    return [{ index, message: lookup.checked ? `${name} changed since its test. Test it again before you save this version.` : `Test lookup ${name} before you save this version.` }];
  });
}

/** A column of a query's result, with its Db2 for i type. */
export interface LookupQueryColumn {
  name: string;
  type: string;
}

/** What a lookup query returns: values as text, as the IBM i connection reads them. */
export interface LookupQueryResult {
  columns: LookupQueryColumn[];
  rows: Record<string, string | null>[];
  /** True when there were more rows than `maxRows`. */
  truncated: boolean;
}

/** Runs one query on the IBM i: SQL with `?` markers, the values for them, and the limits. */
export type LookupQuery = (
  sql: string,
  params: (string | number | null)[],
  options: { maxRows: number; timeoutSeconds: number },
) => Promise<LookupQueryResult>;

/** Query results by lookup SQL and parameters, so each distinct set of parameters runs once. A `Map` is one. */
export interface LookupCache {
  get(key: string): Promise<LookupQueryResult> | undefined;
  set(key: string, value: Promise<LookupQueryResult>): unknown;
  delete(key: string): unknown;
}

/** A bound parameter: its name in the SQL and the value it ran with. */
export interface BoundParameter {
  name: string;
  value: string | number | null;
}

/** One time a lookup ran (or came from the cache) for a page group, or a row of it. */
export interface LookupTrace {
  lookup: string;
  /** 0-based index of the page group. */
  pageGroup: number;
  /** 0-based row of the table, for a row lookup. */
  row?: number;
  parameters: BoundParameter[];
  rows: number;
  ms: number;
  /** True when the result came from the cache. */
  cached: boolean;
  /**
   * The earlier lookup that found no row and that this one reads a column of. The lookup
   * did not run: its value is left empty.
   */
  skippedFor?: string;
}

/** A lookup that found no row, when the lookup says to warn. */
export interface LookupMiss {
  lookup: string;
  pageGroup: number;
  /** "No row in customer for customerNo 10042 (invoice-260101)", and the later lookups this left empty: ". product is left empty" */
  text: string;
  /** Later lookups that read a column of this one, and so were left empty without running. */
  leftEmpty?: string[];
}

/** A miss while lookups run: its text without the later lookups it left empty. */
interface MissEntry {
  lookup: string;
  pageGroup: number;
  base: string;
  leftEmpty: string[];
}

/** "No row in customer ... (doc). product is left empty", the text of a miss. */
function missText(miss: MissEntry): string {
  if (miss.leftEmpty.length === 0) return miss.base;
  const names = miss.leftEmpty.length === 1 ? miss.leftEmpty[0]! : `${miss.leftEmpty.slice(0, -1).join(", ")} and ${miss.leftEmpty.at(-1)!}`;
  return `${miss.base}. ${names} ${miss.leftEmpty.length === 1 ? "is" : "are"} left empty`;
}

/** The value of a lookup that found no row: every column empty, or an empty list. */
function emptyValue(lookup: Lookup, columns: readonly { name: string }[]): Record<string, null> | [] {
  return lookup.result === "many" ? [] : Object.fromEntries(columns.map((c) => [c.name, null]));
}

/** Why a lookup stopped: its message says what to do; `detail` is Db2 for i's own text. */
export class LookupError extends Error {
  constructor(
    readonly lookup: string,
    message: string,
    readonly pageGroup: number | null,
    readonly detail?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LookupError";
  }
}

/** True for a `LookupError`. */
export const isLookupError = (error: unknown): error is LookupError => error instanceof Error && error.name === "LookupError";

/** What `applyLookups` returns. */
export interface LookupsResult {
  /** The page groups with the lookups' values. Page groups not asked for are as they were. */
  groups: Record<string, unknown>[];
  traces: LookupTrace[];
  misses: LookupMiss[];
}

/** Options for `applyLookups`. */
export interface ApplyLookupsOptions {
  /** Results to reuse, and to add to; shared by every page group of a run. A new one by default. */
  cache?: LookupCache;
  /** The page groups to look up, by index; every page group by default. */
  only?: readonly number[];
  /** The document name of each page group, for messages. */
  names?: readonly string[];
}

/** A row's text values as typed values: numbers and dates as `extract` makes them, text without trailing blanks. */
function typedRow(row: Record<string, string | null>, columns: readonly LookupQueryColumn[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const types = new Map(columns.map((c) => [c.name, db2ValueType(c.type)]));
  for (const [name, text] of Object.entries(row)) {
    const type = types.get(name) ?? "string";
    if (text === null) out[name] = null;
    else if (type === "number") {
      const n = Number(text.trim());
      out[name] = text.trim() !== "" && Number.isFinite(n) ? n : convertValue(text.trim(), "number").value;
    } else if (type === "date") out[name] = convertValue(text.trim(), "date").value;
    else out[name] = text.trimEnd();
  }
  return out;
}

/** The rows of a query result as typed values, as a lookup adds them to the data. */
export function typedLookupRows(result: Pick<LookupQueryResult, "columns" | "rows">): Record<string, unknown>[] {
  return result.rows.map((row) => typedRow(row, result.columns));
}

/** A parameter's value as it is bound: a number, text, or null. */
export function boundValue(value: unknown): string | number | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);
  return undefined;
}

/** "customerNo 10042 and lang FI", for messages. */
export function parameterText(parameters: readonly BoundParameter[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const p of parameters) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    parts.push(`${p.name} ${p.value === null ? "(empty)" : String(p.value)}`);
  }
  return parts.join(" and ");
}

/**
 * Runs the lookups for page groups, in order, and adds each one's rows to the data: a
 * page group lookup under its name in the page group, a row lookup under its name in each
 * row of its table. `one` gives the row as an object (every column empty when there is
 * none), `many` the rows as a list. Each distinct SQL and set of parameters runs once,
 * through `cache`. Values are typed by their Db2 for i type.
 *
 * A lookup that reads a column of an earlier one that found no row, such as
 * `:customer.LANG`, does not run: its value is left empty, and the earlier lookup's miss
 * says so ("... product is left empty") instead of a warning per row. A parameter that is
 * empty because the page had no value is bound as NULL, and the lookup runs.
 *
 * @param query - Runs one query; the IBM i connection, or a stand-in in tests
 * @throws LookupError naming the lookup when a query fails, `one` finds more than one row,
 *   `many` finds more than 1,000 rows, or no row is found and the lookup says to stop
 */
export async function applyLookups(
  groups: readonly Record<string, unknown>[],
  lookups: readonly Lookup[],
  query: LookupQuery,
  options: ApplyLookupsOptions = {},
): Promise<LookupsResult> {
  const cache: LookupCache = options.cache ?? new Map<string, Promise<LookupQueryResult>>();
  const only = options.only ? new Set(options.only) : null;
  const traces: LookupTrace[] = [];
  const misses: MissEntry[] = [];
  const missByText = new Map<string, MissEntry>();
  // The values of lookups that found no row, with the miss they warned of (null for one that did not warn).
  const empties = new WeakMap<object, MissEntry | null>();
  const out = groups.map((group, index) => (lookups.length > 0 && (!only || only.has(index)) ? structuredClone(group) : group));
  const bound = lookups.map((lookup) => bindParameters(lookup.sql));

  for (const [pageGroup, group] of out.entries()) {
    if (lookups.length === 0 || (only && !only.has(pageGroup))) continue;
    const where = options.names?.[pageGroup] ? ` (${options.names[pageGroup]})` : "";
    for (const [i, lookup] of lookups.entries()) {
      const { sql, names } = bound[i]!;
      const runOnce = async (scopes: Record<string, unknown>[], row?: number): Promise<unknown> => {
        // A column of an earlier lookup that found no row has no value to look up with.
        for (const name of names) {
          if (!name.includes(".")) continue;
          const head = name.slice(0, name.indexOf("."));
          const source = scopes.find((scope) => head in scope)?.[head];
          if (source === null || typeof source !== "object" || !empties.has(source)) continue;
          const miss = empties.get(source) ?? null;
          if (miss && !miss.leftEmpty.includes(lookup.name)) miss.leftEmpty.push(lookup.name);
          traces.push({ lookup: lookup.name, pageGroup, ...(row !== undefined ? { row } : {}), parameters: [], rows: 0, ms: 0, cached: false, skippedFor: head });
          const value = emptyValue(lookup, lookup.checked?.columns ?? []);
          empties.set(value, miss);
          return value;
        }
        const parameters: BoundParameter[] = names.map((name) => {
          const found = parameterValue(name, scopes);
          if (!found.found) {
            throw new LookupError(lookup.name, `Could not run ${lookup.name}: :${name} is not in the data of the page group${where}. Check the name against the definition.`, pageGroup);
          }
          const value = boundValue(found.value);
          if (value === undefined) {
            throw new LookupError(lookup.name, `Could not run ${lookup.name}: :${name} is a list or a row, and a parameter takes one value.`, pageGroup);
          }
          return { name, value };
        });
        const values = parameters.map((p) => p.value);
        const maxRows = lookup.result === "one" ? 1 : MAX_LOOKUP_ROWS;
        const key = `${lookup.result}\n${sql}\n${JSON.stringify(values)}`;
        let pending = cache.get(key);
        const cached = pending !== undefined;
        const started = performance.now();
        if (!pending) {
          pending = query(sql, values, { maxRows, timeoutSeconds: LOOKUP_TIMEOUT_SECONDS });
          cache.set(key, pending);
          // A failed query is tried again by the next page group that needs it.
          pending.catch(() => cache.delete(key));
        }
        let result: LookupQueryResult;
        try {
          result = await pending;
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          const detail = (error as { detail?: unknown } | null)?.detail;
          throw new LookupError(lookup.name, `Could not run ${lookup.name}: ${text}`, pageGroup, typeof detail === "string" ? detail : undefined, { cause: error });
        }
        traces.push({
          lookup: lookup.name,
          pageGroup,
          ...(row !== undefined ? { row } : {}),
          parameters,
          rows: result.rows.length,
          ms: Math.round(performance.now() - started),
          cached,
        });
        const forValues = parameters.length > 0 ? ` for ${parameterText(parameters)}` : "";
        if (result.truncated) {
          throw new LookupError(
            lookup.name,
            lookup.result === "one"
              ? `${lookup.name} returned more than one row${forValues}${where}. Add a condition, or FETCH FIRST 1 ROW ONLY.`
              : `${lookup.name} returned more than ${MAX_LOOKUP_ROWS.toLocaleString("en-US")} rows${forValues}${where}. A lookup reads at most ${MAX_LOOKUP_ROWS.toLocaleString("en-US")} rows. Add a condition.`,
            pageGroup,
          );
        }
        if (result.rows.length === 0) {
          const text = `No row in ${lookup.name}${forValues}${where}`;
          if (lookup.missing === "fail") {
            throw new LookupError(lookup.name, `${text}. Check the values, or set When no row is found to Warn and leave it empty.`, pageGroup);
          }
          let miss: MissEntry | null = null;
          if (lookup.missing === "warn") {
            miss = missByText.get(text) ?? null;
            if (!miss) {
              miss = { lookup: lookup.name, pageGroup, base: text, leftEmpty: [] };
              missByText.set(text, miss);
              misses.push(miss);
            }
          }
          const value = emptyValue(lookup, result.columns);
          empties.set(value, miss);
          return value;
        }
        const rows = result.rows.map((r) => typedRow(r, result.columns));
        if (lookup.result === "many") return rows;
        return rows[0]!;
      };

      if (lookup.for === undefined) {
        group[lookup.name] = await runOnce([group]);
        continue;
      }
      const table = group[lookup.for];
      if (!Array.isArray(table)) continue;
      for (const [row, item] of table.entries()) {
        if (item === null || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        record[lookup.name] = await runOnce([record, group], row);
      }
    }
  }
  return {
    groups: out,
    traces,
    misses: misses.map((m) => ({ lookup: m.lookup, pageGroup: m.pageGroup, text: missText(m), ...(m.leftEmpty.length > 0 ? { leftEmpty: m.leftEmpty } : {}) })),
  };
}
