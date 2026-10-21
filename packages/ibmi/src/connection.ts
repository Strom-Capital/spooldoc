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
  vrm: string;
}

/** Filter for `listOutputQueues`. `library` and `name` are case-insensitive "contains" matches. */
export interface OutputQueueFilter {
  library?: string;
  name?: string;
  /** Only queues in these libraries (exact names). Empty or missing means every library. */
  libraries?: string[];
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
}

/** The messages of a CL command. */
export interface CommandResult {
  ok: boolean;
  messages: { id: string; text: string }[];
}

/**
 * A connection to an IBM i that can list output queues, read spooled files, act on them
 * after processing, read data queues and run CL commands.
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
   * Write a file to the IFS, replacing one with the same name. The bytes go to `path.part`
   * first and are renamed into place, so a program watching the folder never sees half a
   * file. A new file is tagged with `ccsid`.
   *
   * @returns Whether a file with the same name was replaced
   */
  writeIfsFile(path: string, bytes: Uint8Array, options: IfsWriteOptions): Promise<{ replaced: boolean }>;
  close(): Promise<void>;
}

/** Why a connection call failed. */
export type ConnectionErrorCode = "auth" | "host" | "notfound" | "authority" | "other";

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
