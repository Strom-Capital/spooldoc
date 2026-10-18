import type { OutputQueue, OutputQueueFilter, QueueRef, SpooledFileEntry, SpooledFileFilter } from "../connection.js";
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

/** Output queues from QSYS2.OUTPUT_QUEUE_INFO, ordered by library and name. */
export function outputQueuesQuery(filter: OutputQueueFilter = {}): SqlQuery {
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
  const sql = [
    "SELECT OUTPUT_QUEUE_LIBRARY_NAME, OUTPUT_QUEUE_NAME, NUMBER_OF_FILES, TEXT_DESCRIPTION, DATA_QUEUE_LIBRARY, DATA_QUEUE_NAME",
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
