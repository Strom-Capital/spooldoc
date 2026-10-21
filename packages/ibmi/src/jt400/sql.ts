import type {
  OutputQueue,
  OutputQueueFilter,
  QueueFileCount,
  QueueFileCountFilter,
  QueueRef,
  SpooledFileEntry,
  SpooledFileFilter,
} from "../connection.js";
import { ATTRIBUTE_DEFAULTS, positiveInt, splitJobName, sqlTimestamp, toNumber, toText } from "../attributes.js";

/** An SQL statement with parameter marker values. */
export interface SqlQuery {
  sql: string;
  params: (string | number)[];
}

/** A result row as returned by the SQL bridge. */
export type Row = Record<string, unknown>;

/** Default and maximum `limit` for `spooledFilesQuery`. */
export const SPOOLED_FILE_LIMIT = { default: 200, max: 10000 } as const;

/** The escape character used in LIKE patterns. */
export const LIKE_ESCAPE = "\\";

/** A LIKE pattern for an upper-cased "contains" match, with `%`, `_` and the escape character escaped. */
export function containsPattern(value: string): string {
  const escaped = value.trim().toUpperCase().replace(/[\\%_]/g, (c) => `${LIKE_ESCAPE}${c}`);
  return `%${escaped}%`;
}

const likeClause = (column: string): string => `UPPER(${column}) LIKE ? ESCAPE '${LIKE_ESCAPE}'`;

/** True for a CCSID that names a code page: a whole number from 1 to 65533, not 65535. */
function isTextCcsid(ccsid: number | undefined): ccsid is number {
  return typeof ccsid === "number" && Number.isInteger(ccsid) && ccsid >= 1 && ccsid <= 65533;
}

/**
 * The CCSID to read queue text with. QSYS2.OUTPUT_QUEUE_INFO tags TEXT_DESCRIPTION as
 * CCSID 37, but the bytes are in the CCSID of the job that set the text, which is the
 * system's language CCSID. That is the server job's default CCSID; when it is unknown or
 * 65535, `fallback` (SPOOLDOC_DEFAULT_CCSID). Null keeps the text as the view tags it, and
 * so does 37, which is the tag already.
 *
 * @param defaultCcsid - The server job's DEFAULT_CCSID, 0 when unknown
 * @param fallback - The CCSID to use when the default is unknown or 65535
 */
export function queueTextCcsid(defaultCcsid: number, fallback?: number): number | null {
  const ccsid = isTextCcsid(defaultCcsid) ? defaultCcsid : isTextCcsid(fallback) ? fallback : null;
  return ccsid === 37 ? null : ccsid;
}

/**
 * Output queues from QSYS2.OUTPUT_QUEUE_INFO, ordered by library and name. With
 * `textCcsid`, the text is read as raw bytes and tagged with that CCSID (see
 * `queueTextCcsid`). It is a validated integer written into the statement.
 */
export function outputQueuesQuery(filter: OutputQueueFilter = {}, textCcsid: number | null = null): SqlQuery {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.library?.trim()) {
    where.push(likeClause("OUTPUT_QUEUE_LIBRARY_NAME"));
    params.push(containsPattern(filter.library));
  }
  if (filter.name?.trim()) {
    where.push(likeClause("OUTPUT_QUEUE_NAME"));
    params.push(containsPattern(filter.name));
  }
  const libraries = [...new Set((filter.libraries ?? []).map((lib) => lib.trim().toUpperCase()).filter(Boolean))];
  if (libraries.length > 0) {
    where.push(`OUTPUT_QUEUE_LIBRARY_NAME IN (${libraries.map(() => "?").join(", ")})`);
    params.push(...libraries);
  }
  const text = isTextCcsid(textCcsid ?? undefined)
    ? `CAST(CAST(TEXT_DESCRIPTION AS VARCHAR(50) CCSID 65535) AS VARCHAR(50) CCSID ${textCcsid}) AS TEXT_DESCRIPTION`
    : "TEXT_DESCRIPTION";
  const sql = [
    `SELECT OUTPUT_QUEUE_LIBRARY_NAME, OUTPUT_QUEUE_NAME, NUMBER_OF_FILES, ${text}, DATA_QUEUE_LIBRARY, DATA_QUEUE_NAME`,
    "FROM QSYS2.OUTPUT_QUEUE_INFO",
    ...(where.length ? [`WHERE ${where.join(" AND ")}`] : []),
    "ORDER BY OUTPUT_QUEUE_LIBRARY_NAME, OUTPUT_QUEUE_NAME",
  ].join("\n");
  return { sql, params };
}

/**
 * Spooled files of one queue, newest first, from the QSYS2.OUTPUT_QUEUE_ENTRIES table
 * function (the view form scans every queue on the system before filtering).
 * The limit is a validated integer written into the statement.
 */
export function spooledFilesQuery(queue: QueueRef, filter: SpooledFileFilter = {}): SqlQuery {
  const params: (string | number)[] = [queue.library.trim().toUpperCase(), queue.name.trim().toUpperCase()];
  const where: string[] = [];
  if (filter.name?.trim()) {
    where.push(likeClause("SPOOLED_FILE_NAME"));
    params.push(containsPattern(filter.name));
  }
  if (filter.userData?.trim()) {
    where.push(likeClause("COALESCE(USER_DATA, '')"));
    params.push(containsPattern(filter.userData));
  }
  if (filter.job?.trim()) {
    where.push(likeClause("JOB_NAME"));
    params.push(containsPattern(filter.job));
  }
  if (filter.jobName?.trim()) {
    // JOB_NAME is number/user/name and the name has no slash: text after the second slash is in the name.
    where.push(likeClause("JOB_NAME"));
    params.push(`%/%/${containsPattern(filter.jobName).slice(1)}`);
  }
  if (filter.jobUser?.trim()) {
    where.push(likeClause("USER_NAME"));
    params.push(containsPattern(filter.jobUser));
  }
  if (filter.formType?.trim()) {
    where.push(likeClause("COALESCE(FORM_TYPE, '')"));
    params.push(containsPattern(filter.formType));
  }
  const statuses = [...new Set((filter.status ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (statuses.length > 0) {
    where.push(`STATUS IN (${statuses.map(() => "?").join(", ")})`);
    params.push(...statuses);
  }
  const limit = Math.min(positiveInt(filter.limit, SPOOLED_FILE_LIMIT.default), SPOOLED_FILE_LIMIT.max);
  const sql = [
    "SELECT SPOOLED_FILE_NAME, FILE_NUMBER, JOB_NAME, USER_DATA, FORM_TYPE, DEVICE_TYPE, TOTAL_PAGES,",
    "  PAGE_LENGTH, PAGE_WIDTH, CHARACTERS_PER_INCH, LINES_PER_INCH, STATUS, CREATE_TIMESTAMP",
    "FROM TABLE(QSYS2.OUTPUT_QUEUE_ENTRIES(?, ?, 'YES')) X",
    ...(where.length ? [`WHERE ${where.join(" AND ")}`] : []),
    "ORDER BY CREATE_TIMESTAMP DESC, FILE_NUMBER DESC",
    `FETCH FIRST ${limit} ROWS ONLY`,
  ].join("\n");
  return { sql, params };
}

/**
 * Spooled files per queue and status, from the QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC view.
 * The view reads every spooled file the user can see, so this is slower than the
 * queue list and is asked for on its own.
 */
export function queueFileCountsQuery(filter: QueueFileCountFilter): SqlQuery {
  const params: string[] = [];
  const where: string[] = [];
  const statuses = [...new Set(filter.status.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  where.push(statuses.length > 0 ? `STATUS IN (${statuses.map(() => "?").join(", ")})` : "1 = 0");
  params.push(...statuses);
  const libraries = [...new Set((filter.libraries ?? []).map((lib) => lib.trim().toUpperCase()).filter(Boolean))];
  if (libraries.length > 0) {
    where.push(`OUTPUT_QUEUE_LIBRARY_NAME IN (${libraries.map(() => "?").join(", ")})`);
    params.push(...libraries);
  }
  const sql = [
    "SELECT OUTPUT_QUEUE_LIBRARY_NAME, OUTPUT_QUEUE_NAME, STATUS, COUNT(*) AS FILES",
    "FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC",
    `WHERE ${where.join(" AND ")}`,
    "GROUP BY OUTPUT_QUEUE_LIBRARY_NAME, OUTPUT_QUEUE_NAME, STATUS",
  ].join("\n");
  return { sql, params };
}

/** Maps a `queueFileCountsQuery` row. */
export function mapQueueFileCountRow(row: Row): QueueFileCount {
  return {
    library: toText(row.OUTPUT_QUEUE_LIBRARY_NAME),
    name: toText(row.OUTPUT_QUEUE_NAME),
    status: toText(row.STATUS),
    files: toNumber(row.FILES) ?? 0,
  };
}

/** Maps a QSYS2.OUTPUT_QUEUE_INFO row. */
export function mapQueueRow(row: Row): OutputQueue {
  return {
    library: toText(row.OUTPUT_QUEUE_LIBRARY_NAME),
    name: toText(row.OUTPUT_QUEUE_NAME),
    files: toNumber(row.NUMBER_OF_FILES) ?? 0,
    text: toText(row.TEXT_DESCRIPTION),
    dataQueue: row.DATA_QUEUE_NAME ? { library: toText(row.DATA_QUEUE_LIBRARY), name: toText(row.DATA_QUEUE_NAME) } : null,
  };
}

/**
 * Maps a QSYS2.OUTPUT_QUEUE_ENTRIES row. The queue comes from the row when it has the
 * queue columns (the view), else from `queue` (the table function). The CHRID is not
 * in the view, so `chrid` is null, and so is `jobCcsid`.
 */
export function mapSpooledFileRow(row: Row, queue?: QueueRef): SpooledFileEntry {
  const job = splitJobName(row.JOB_NAME);
  return {
    name: toText(row.SPOOLED_FILE_NAME),
    number: toNumber(row.FILE_NUMBER) ?? 0,
    ...job,
    status: toText(row.STATUS),
    attributes: {
      queue: {
        library: toText(row.OUTPUT_QUEUE_LIBRARY_NAME) || queue?.library.trim().toUpperCase() || "",
        name: toText(row.OUTPUT_QUEUE_NAME) || queue?.name.trim().toUpperCase() || "",
      },
      userData: toText(row.USER_DATA),
      formType: toText(row.FORM_TYPE),
      deviceType: toText(row.DEVICE_TYPE),
      pages: Math.max(0, Math.round(toNumber(row.TOTAL_PAGES) ?? 0)),
      pageWidth: positiveInt(row.PAGE_WIDTH, ATTRIBUTE_DEFAULTS.pageWidth),
      pageLength: positiveInt(row.PAGE_LENGTH, ATTRIBUTE_DEFAULTS.pageLength),
      cpi: toNumber(row.CHARACTERS_PER_INCH) ?? ATTRIBUTE_DEFAULTS.cpi,
      lpi: toNumber(row.LINES_PER_INCH) ?? ATTRIBUTE_DEFAULTS.lpi,
      chrid: null,
      jobCcsid: null,
      created: sqlTimestamp(row.CREATE_TIMESTAMP),
    },
  };
}
