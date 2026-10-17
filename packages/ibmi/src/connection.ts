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

/** Filter for `listOutputQueues`. Both are case-insensitive "contains" matches. */
export interface OutputQueueFilter {
  library?: string;
  name?: string;
}

/** Filter for `listSpooledFiles`. `name` and `userData` are case-insensitive "contains" matches. */
export interface SpooledFileFilter {
  name?: string;
  userData?: string;
  /** Maximum number of entries, newest first. Default 200. */
  limit?: number;
}

/** A queue by library and name. */
export interface QueueRef {
  library: string;
  name: string;
}

/** A connection to an IBM i that can list output queues and read spooled files. */
export interface Connection {
  describe(): Promise<SystemInfo>;
  listOutputQueues(filter?: OutputQueueFilter): Promise<OutputQueue[]>;
  listSpooledFiles(queue: QueueRef, filter?: SpooledFileFilter): Promise<SpooledFileEntry[]>;
  readSpooledFile(id: SpooledFileId): Promise<{ bytes: Uint8Array; attributes: SpooledFileAttributes }>;
  close(): Promise<void>;
}

/** Why a connection call failed. */
export type ConnectionErrorCode = "auth" | "host" | "notfound" | "authority" | "other";

/** A failed connection call. The message never contains the password. */
export class ConnectionError extends Error {
  readonly code: ConnectionErrorCode;
  constructor(code: ConnectionErrorCode, message: string) {
    super(message);
    this.name = "ConnectionError";
    this.code = code;
  }
}
