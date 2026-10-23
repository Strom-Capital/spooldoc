import type { SpooledFileAttributes, SpooledFileId } from "@spooldoc/core";

/** Sign-on details for an IBM i. */
export interface Credentials {
  host: string;
  user: string;
  password: string;
}

/** An output queue and how many spooled files it holds. */
export interface OutputQueue {
  library: string;
  name: string;
  files: number;
  text: string;
  /** The data queue the system sends an entry to when a spooled file becomes ready. */
  dataQueue: QueueRef | null;
}

/** How many spooled files with one status an output queue holds. */
export interface QueueFileCount {
  library: string;
  name: string;
  status: string;
  files: number;
}

/** A spooled file in a queue listing. `attributes.chrid` is null until the file is read. */
export interface SpooledFileEntry extends SpooledFileId {
  attributes: SpooledFileAttributes;
  status: string;
}

/** What the connection knows about the system and the signed-on job. */
export interface SystemInfo {
  host: string;
  user: string;
  jobCcsid: number;
  /**
   * The default CCSID of the signed-on job, from the system's language: 0 when unknown.
   * Object text such as a queue's description is in this CCSID.
   */
  defaultCcsid: number;
  vrm: string;
}

/** Filter for `listOutputQueues`. `library` and `name` are case-insensitive "contains" matches. */
export interface OutputQueueFilter {
  library?: string;
  name?: string;
  /** Only queues in these libraries (exact names). Empty or missing means every library. */
  libraries?: string[];
  /** The CCSID to read the queue text with when the job's default CCSID is unknown or 65535. */
  fallbackCcsid?: number;
}

/** Filter for `listSpooledFiles`. The text filters are case-insensitive "contains" matches. */
export interface SpooledFileFilter {
  name?: string;
  userData?: string;
  /** Anywhere in the qualified job, `number/user/name`. */
  job?: string;
  /** In the job name (the last part of the qualified job). */
  jobName?: string;
  /** In the user the job ran under. */
  jobUser?: string;
  formType?: string;
  /** Only files with one of these statuses, such as `READY` or `HELD`. */
  status?: string[];
  /** Maximum number of entries, newest first. Default 200. */
  limit?: number;
}

/** Filter for `countSpooledFiles`. */
export interface QueueFileCountFilter {
  /** Only these statuses, such as `READY` and `HELD`. */
  status: string[];
  /** Only queues in these libraries (exact names). Empty or missing means every library. */
  libraries?: string[];
}

/** A queue by library and name. */
export interface QueueRef {
  library: string;
  name: string;
}

/** What an IFS path is. */
export type IfsEntry = "file" | "directory";

/** How `writeIfsFile` writes. */
export interface IfsWriteOptions {
  /** The CCSID the file is tagged with: 1208 for text such as HTML, 65535 for binary. */
  ccsid: number;
  /**
   * What to do when a file with the name is there at the moment the new file is renamed
   * into place: replace it (the default), or fail with code "exists" and replace nothing.
   */
  ifExists?: "replace" | "fail";
}

/** What `writeIfsFile` did. */
export interface IfsWriteResult {
  /** Whether a file with the same name was replaced. */
  replaced: boolean;
  /**
   * The old file, renamed aside, when it could not be deleted after the new one was in
   * place. The new file is written; this one is left over.
   */
  leftover?: string;
}

/** The messages of a CL command. */
export interface CommandResult {
  ok: boolean;
  messages: { id: string; text: string }[];
}

/** A value bound to a `?` parameter marker of a query. Numbers are bound as text. */
export type QueryParam = string | number | null;

/** Limits for `query`. */
export interface QueryOptions {
  /** The most rows to return. One more is fetched to tell whether there were more. */
  maxRows: number;
  /** How long Db2 for i may run the query before it is canceled. */
  timeoutSeconds: number;
}

/** A column of a query, as Db2 for i describes it. */
export interface QueryColumn {
  /** The column name, or its label from `AS`. */
  name: string;
  /** The Db2 for i type name, such as CHAR, VARCHAR, DECIMAL, INTEGER, DATE or TIMESTAMP. */
  type: string;
  /** The length of a character column, or the digits of a number. */
  precision: number;
  /** The digits after the decimal point; 0 for other types. */
  scale: number;
  /** Whether the column can be null; null when Db2 for i does not say. */
  nullable: boolean | null;
}

/** A `?` parameter marker of a query, as Db2 for i describes it. */
export interface QueryParameter {
  /** The Db2 for i type the value is converted to, such as DECIMAL or CHAR. */
  type: string;
  precision: number;
  scale: number;
  nullable: boolean | null;
}

/**
 * A result row by column name. Every value is Db2 for i's text for it: numbers such as
 * `1234.50`, dates as `2026-10-23`, times as `10:15:00` and timestamps as
 * `2026-10-23 10:15:00.000000`. Trailing blanks of fixed-length character columns (CHAR,
 * NCHAR, GRAPHIC) are removed; other text is as stored. A later column with the same
 * name as an earlier one replaces its value, so give such columns an `AS` label.
 */
export type QueryRow = Record<string, string | null>;

/** What `query` returns. */
export interface QueryResult {
  columns: QueryColumn[];
  /** At most `maxRows` rows. */
  rows: QueryRow[];
  /** True when the query had more rows than `maxRows`; the rest were not read. */
  truncated: boolean;
}

/** What `describeQuery` returns. */
export interface QueryDescription {
  columns: QueryColumn[];
  /** The `?` markers in order. */
  parameters: QueryParameter[];
}

/**
 * A connection to an IBM i that can list output queues, read spooled files, act on them
 * after processing, read data queues, run CL commands and run read-only queries.
 */
export interface Connection {
  describe(): Promise<SystemInfo>;
  listOutputQueues(filter?: OutputQueueFilter): Promise<OutputQueue[]>;
  listSpooledFiles(queue: QueueRef, filter?: SpooledFileFilter): Promise<SpooledFileEntry[]>;
  /** The spooled files of each queue, counted by status. Queues with none are left out. */
  countSpooledFiles(filter: QueueFileCountFilter): Promise<QueueFileCount[]>;
  readSpooledFile(id: SpooledFileId): Promise<{ bytes: Uint8Array; attributes: SpooledFileAttributes }>;
  /** Hold the spooled file (`HLDSPLF OPTION(*IMMED)`). */
  holdSpooledFile(id: SpooledFileId): Promise<void>;
  /** Move the spooled file to another output queue. */
  moveSpooledFile(id: SpooledFileId, queue: QueueRef): Promise<void>;
  /** Delete the spooled file. */
  deleteSpooledFile(id: SpooledFileId): Promise<void>;
  /**
   * Take the next entry from a data queue, waiting up to `waitSeconds`.
   *
   * @returns The entry bytes, or null when none arrived in time
   */
  readDataQueue(dataQueue: QueueRef, waitSeconds: number): Promise<Uint8Array | null>;
  /**
   * Run a CL command. A failed command resolves with `ok: false` and its messages; only
   * a connection problem throws.
   */
  runCommand(command: string): Promise<CommandResult>;
  /** What is at a path in the IFS: a file, a directory, or nothing (null). */
  ifsStat(path: string): Promise<IfsEntry | null>;
  /**
   * Write a file to the IFS. The bytes go to a part file of this write only and are
   * renamed into place, so a program watching the folder never sees half a file, and
   * two writes never share a part file. A file with the same name is replaced, or with
   * `ifExists: "fail"` left alone. A replaced file is renamed aside first and put back
   * if the new one cannot take its place, so a failed write never loses both. A new
   * file is tagged with `ccsid`.
   *
   * @throws ConnectionError with code "exists" when `ifExists` is "fail" and the name is taken
   */
  writeIfsFile(path: string, bytes: Uint8Array, options: IfsWriteOptions): Promise<IfsWriteResult>;
  /**
   * Run one SELECT, VALUES or WITH statement with `?` markers bound to `params`, on a
   * second JDBC connection opened read only, which the driver refuses any other statement
   * on. Db2 for i cancels the query after `timeoutSeconds`.
   *
   * @throws ConnectionError with code "query" when the statement is not a single query or
   *   Db2 for i rejects it, and "timeout" when it ran too long
   */
  query(sql: string, params: readonly QueryParam[], options: QueryOptions): Promise<QueryResult>;
  /**
   * Check a statement without running it: that it is a single query (QSYS2.PARSE_STATEMENT),
   * and what columns and parameter markers it has (from preparing it). No rows are read.
   *
   * @throws ConnectionError with code "query" when it is not a single query or not valid
   */
  describeQuery(sql: string): Promise<QueryDescription>;
  close(): Promise<void>;
}

/**
 * Why a connection call failed. "exists": an IFS file with the name is there already.
 * "query": the SQL of a query is not a single query, or Db2 for i rejects it.
 * "timeout": a query ran longer than its time limit and was canceled.
 */
export type ConnectionErrorCode = "auth" | "host" | "notfound" | "authority" | "exists" | "query" | "timeout" | "other";

/**
 * A failed connection call. The message says what went wrong and, where Spooldoc knows,
 * what to do about it. `messageId` is the IBM i message, such as `CPF2204`, and `detail`
 * the system's own text, for support. None of them contains the password.
 */
export class ConnectionError extends Error {
  readonly code: ConnectionErrorCode;
  readonly messageId?: string;
  readonly detail?: string;
  constructor(code: ConnectionErrorCode, message: string, info: { messageId?: string; detail?: string } = {}) {
    super(message);
    this.name = "ConnectionError";
    this.code = code;
    if (info.messageId) this.messageId = info.messageId;
    if (info.detail) this.detail = info.detail;
  }
}
