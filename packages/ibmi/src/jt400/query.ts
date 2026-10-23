import {
  ConnectionError,
  type QueryColumn,
  type QueryDescription,
  type QueryOptions,
  type QueryParam,
  type QueryParameter,
  type QueryResult,
  type QueryRow,
} from "../connection.js";
import { assertSingleQuery } from "../query.js";
import { plain, type JavaObject } from "./bridge.js";

/*
 * Queries on a `java.sql.Connection` proxy from the `java` bridge. Methods without the
 * Sync suffix return promises and run on a worker thread: the ones that may wait on the
 * IBM i (prepare, execute, next) use them. Metadata and column values are already on this
 * side, so those calls are Sync.
 */

/** How long the PARSE_STATEMENT check may run. */
const PARSE_TIMEOUT_SECONDS = 30;

/** `ResultSetMetaData.columnNoNulls` and `columnNullable`; anything else is unknown. */
const nullable = (value: unknown): boolean | null => (Number(value) === 0 ? false : Number(value) === 1 ? true : null);

/** Fixed-length character types, which Db2 for i pads with blanks. */
const PADDED = new Set(["CHAR", "NCHAR", "GRAPHIC"]);

/** The columns of a `ResultSetMetaData`. */
function columnsOf(meta: JavaObject): QueryColumn[] {
  if (!meta) return [];
  const count = Number(meta.getColumnCountSync());
  const columns: QueryColumn[] = [];
  for (let i = 1; i <= count; i++) {
    columns.push({
      name: String(meta.getColumnLabelSync(i)),
      type: String(meta.getColumnTypeNameSync(i)).toUpperCase(),
      precision: Number(meta.getPrecisionSync(i)),
      scale: Number(meta.getScaleSync(i)),
      nullable: nullable(meta.isNullableSync(i)),
    });
  }
  return columns;
}

/** The parameter markers of a `ParameterMetaData`. */
function parametersOf(meta: JavaObject): QueryParameter[] {
  if (!meta) return [];
  const count = Number(meta.getParameterCountSync());
  const parameters: QueryParameter[] = [];
  for (let i = 1; i <= count; i++) {
    parameters.push({
      type: String(meta.getParameterTypeNameSync(i)).toUpperCase(),
      precision: Number(meta.getPrecisionSync(i)),
      scale: Number(meta.getScaleSync(i)),
      nullable: nullable(meta.isNullableSync(i)),
    });
  }
  return parameters;
}

/** Closes a statement or result set, ignoring a failure: the result is in hand already. */
function closeQuietly(object: JavaObject): void {
  try {
    object?.closeSync();
  } catch {
    // Closed already, or the connection dropped; the next call finds out.
  }
}

/** A whole number of at least `min`, from a caller's limit. */
const atLeast = (value: number, min: number): number => (Number.isFinite(value) ? Math.max(min, Math.floor(value)) : min);

/**
 * Runs one query with `?` markers bound to `params`, as text, which Db2 for i converts to
 * each marker's type. Fetches at most `maxRows + 1` rows, so `truncated` can say there were
 * more without reading them all.
 *
 * @param db - A `java.sql.Connection`, opened read only
 */
export async function runQuery(db: JavaObject, sql: string, params: readonly QueryParam[], options: QueryOptions): Promise<QueryResult> {
  assertSingleQuery(sql);
  const maxRows = atLeast(options.maxRows, 1);
  const statement = await db.prepareStatement(sql);
  let results: JavaObject = null;
  try {
    statement.setQueryTimeoutSync(atLeast(options.timeoutSeconds, 1));
    statement.setMaxRowsSync(maxRows + 1);
    statement.setFetchSizeSync(Math.min(maxRows + 1, 1000));
    params.forEach((value, i) => {
      if (value === null) statement.setNullSync(i + 1, 12 /* java.sql.Types.VARCHAR */);
      else statement.setStringSync(i + 1, String(value));
    });
    results = await statement.executeQuery();
    const columns = columnsOf(results.getMetaDataSync());
    const rows: QueryRow[] = [];
    while (rows.length <= maxRows && (await results.next())) {
      const row: QueryRow = {};
      columns.forEach((column, i) => {
        const value = plain(results.getStringSync(i + 1));
        const text = value === null ? null : String(value);
        row[column.name] = text !== null && PADDED.has(column.type) ? text.replace(/ +$/, "") : text;
      });
      rows.push(row);
    }
    const truncated = rows.length > maxRows;
    return { columns, rows: truncated ? rows.slice(0, maxRows) : rows, truncated };
  } finally {
    closeQuietly(results);
    closeQuietly(statement);
  }
}

/**
 * Checks a statement without running it. QSYS2.PARSE_STATEMENT gives its type, and anything
 * but a query is refused. A statement it cannot parse gives no rows; preparing it then
 * fails with Db2 for i's own syntax error. Preparing describes the columns and the
 * parameter markers, and reads no rows.
 *
 * @param db - A `java.sql.Connection`, opened read only
 */
export async function describeQuery(db: JavaObject, sql: string): Promise<QueryDescription> {
  assertSingleQuery(sql);
  const types = await runQuery(
    db,
    "SELECT DISTINCT SQL_STATEMENT_TYPE FROM TABLE(QSYS2.PARSE_STATEMENT(SQL_STATEMENT => ?, NAMING => '*SQL')) X",
    [sql],
    { maxRows: 10, timeoutSeconds: PARSE_TIMEOUT_SECONDS },
  );
  const other = types.rows.map((row) => (row.SQL_STATEMENT_TYPE ?? "").trim().toUpperCase()).find((type) => type && type !== "QUERY");
  if (other) throw new ConnectionError("query", `A lookup runs one SELECT statement only, and Db2 for i reads this one as ${other}.`);

  const statement = await db.prepareStatement(sql);
  try {
    return { columns: columnsOf(await statement.getMetaData()), parameters: parametersOf(await statement.getParameterMetaData()) };
  } finally {
    closeQuietly(statement);
  }
}
