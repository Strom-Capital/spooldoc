import { createHash } from "node:crypto";
import type { Connection, Credentials } from "../connection.js";
import { noAnswerError, withDeadline } from "../deadline.js";
import { openJt400Connection } from "./connection.js";

/**
 * Process-wide jt400 connection cache.
 *
 * The `java` bridge starts one JVM per process and it cannot be restarted or given a new
 * classpath, so connections are cached on `globalThis` and shared by every copy of this
 * module. Next dev HMR cannot reload this module in a useful way: a changed version would
 * still talk to the JVM and cache of the first one. After changing anything under `jt400/`,
 * restart the process.
 *
 * Keys are a SHA-256 of `host|user|password`; the raw password is never a key.
 * A connection unused for `IDLE_MS` is closed by an unref'd timer.
 */
export const IDLE_MS = 10 * 60 * 1000;

/**
 * How long a caller waits for a connection to open. jt400's own login timeout normally
 * ends a stuck attempt first; this also covers a sign-on that stalls after connecting.
 */
export const CONNECT_TIMEOUT_MS = 45 * 1000;

interface Entry {
  /** The jt400 connection itself. */
  raw: Promise<Connection>;
  /** What callers get: marks use and evicts on close. */
  connection: Promise<Connection>;
  lastUsed: number;
}

interface Cache {
  entries: Map<string, Entry>;
  timer: ReturnType<typeof setInterval> | undefined;
}

const CACHE_KEY = Symbol.for("spooldoc.ibmi.jt400.connections");

function cache(): Cache {
  const g = globalThis as unknown as Record<symbol, Cache | undefined>;
  return (g[CACHE_KEY] ??= { entries: new Map(), timer: undefined });
}

/** The cache key for a set of credentials: a SHA-256 hex digest of `host|user|password`. */
export function connectionKey(creds: Credentials): string {
  return createHash("sha256")
    .update(`${creds.host.trim().toLowerCase()}|${creds.user.trim().toUpperCase()}|${creds.password}`)
    .digest("hex");
}

function startSweeper(c: Cache): void {
  if (c.timer) return;
  c.timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of c.entries) {
      if (now - entry.lastUsed >= IDLE_MS) void closeConnection(key);
    }
    if (c.entries.size === 0 && c.timer) {
      clearInterval(c.timer);
      c.timer = undefined;
    }
  }, 60 * 1000);
  c.timer.unref();
}

/** Wraps a connection so each call marks the entry as used and `close()` evicts it. */
function tracked(key: string, entry: Entry, conn: Connection): Connection {
  const touch = <T>(p: Promise<T>): Promise<T> => {
    entry.lastUsed = Date.now();
    return p;
  };
  return {
    describe: () => touch(conn.describe()),
    listOutputQueues: (filter) => touch(conn.listOutputQueues(filter)),
    listSpooledFiles: (queue, filter) => touch(conn.listSpooledFiles(queue, filter)),
    readSpooledFile: (id) => touch(conn.readSpooledFile(id)),
    close: () => closeConnection(key),
  };
}

/**
 * Returns the open connection for these credentials, opening one when there is none.
 * An open that takes longer than `CONNECT_TIMEOUT_MS` fails with a host error and is
 * dropped from the cache, so the next call starts a new attempt instead of joining it.
 */
export async function getConnection(creds: Credentials): Promise<Connection> {
  const c = cache();
  const key = connectionKey(creds);
  let entry = c.entries.get(key);
  if (!entry) {
    const raw = openJt400Connection(creds);
    const created: Entry = { raw, connection: raw, lastUsed: Date.now() };
    created.connection = raw.then((conn) => tracked(key, created, conn));
    entry = created;
    c.entries.set(key, entry);
    raw.catch(() => {
      if (c.entries.get(key) === created) c.entries.delete(key);
    });
    startSweeper(c);
  }
  entry.lastUsed = Date.now();
  const opening = entry;
  return withDeadline(entry.connection, CONNECT_TIMEOUT_MS, () => {
    if (c.entries.get(key) === opening) void closeConnection(key);
    return noAnswerError(creds.host, CONNECT_TIMEOUT_MS);
  });
}

/** Closes and forgets the cached connection with this key. Unknown keys are ignored. */
export async function closeConnection(key: string): Promise<void> {
  const c = cache();
  const entry = c.entries.get(key);
  if (!entry) return;
  c.entries.delete(key);
  const conn = await entry.raw.catch(() => null);
  await conn?.close().catch(() => undefined);
}

/** Closes every cached connection. */
export async function closeAllConnections(): Promise<void> {
  await Promise.all([...cache().entries.keys()].map((key) => closeConnection(key)));
}
