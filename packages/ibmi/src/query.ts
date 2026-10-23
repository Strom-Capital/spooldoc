import { ConnectionError } from "./connection.js";

/** The context of a query error, which `toConnectionError` classifies with the query rules. */
export const QUERY_CONTEXT = "The query";

/** Keywords a single query can start with. */
const QUERY_STARTS = new Set(["SELECT", "WITH", "VALUES"]);

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

/**
 * Why a statement cannot be a lookup query, checked here without the IBM i: it must start
 * with SELECT, WITH or VALUES, have no `;` (one statement only) and no data change in a
 * FROM (`FINAL TABLE (INSERT ...)` and friends). Null when it passes. Db2 for i checks
 * the rest when the statement is described or run.
 */
export function singleQueryProblem(sql: string): string | null {
  const code = sqlOutsideLiterals(sql);
  const first = /^[\s(]*([A-Za-z]+)/.exec(code)?.[1]?.toUpperCase();
  if (!first) return "The query is empty. A lookup runs one SELECT statement.";
  if (!QUERY_STARTS.has(first)) return `A lookup runs one SELECT statement only, and this one is ${first}. Use SELECT, WITH or VALUES.`;
  if (code.includes(";")) return "A lookup runs one SELECT statement only. Remove the semicolon and anything after it.";
  if (/\b(FINAL|NEW|OLD)\s+TABLE\s*\(/i.test(code)) return "A lookup reads data only. Remove the INSERT, UPDATE or DELETE in the FROM clause.";
  return null;
}

/** Throws a `ConnectionError` with code "query" when `singleQueryProblem` finds a problem. */
export function assertSingleQuery(sql: string): void {
  const problem = singleQueryProblem(sql);
  if (problem) throw new ConnectionError("query", problem);
}
