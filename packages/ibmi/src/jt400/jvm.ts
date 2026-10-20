import { createHash } from "node:crypto";
import type { SpooledFileId } from "@spooldoc/core";
import { ConnectionError, type Connection, type Credentials, type SystemInfo } from "../connection.js";
import { noAnswerError, withDeadline } from "../deadline.js";
import { isConnectionLost } from "../errors.js";
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
 * A connection unused for `IDLE_MS` is closed by an unref'd timer. A call that fails
 * because the connection dropped closes it too, so the next call opens a new one; a read
 * is tried once more on that new connection, a change on the IBM i is not.
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
  /** What callers get: marks use, moves on after a drop, and evicts on close. */
  connection: Promise<Connection>;
  lastUsed: number;
  /** Why the entry left the cache: a call found the connection dropped, or it was closed. */
  gone?: "dropped" | "closed";
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

/**
 * True when an error means the connection itself failed, not the call: a host error
 * (which includes a dropped connection), or a text that says the connection dropped.
 */
function isDropped(err: unknown): boolean {
  const e = err as { name?: unknown; code?: unknown; message?: unknown } | null;
  if (e?.name === "ConnectionError") return e.code === "host";
  return isConnectionLost(String(e?.message ?? err));
}

/** The cached entry for these credentials, opening one when there is none. Marks it as used. */
function entryFor(creds: Credentials): Entry {
  const c = cache();
  const key = connectionKey(creds);
  let entry = c.entries.get(key);
  if (!entry) {
    const raw = openJt400Connection(creds);
    const created: Entry = { raw, connection: raw, lastUsed: Date.now() };
    created.connection = raw.then(() => tracked(key, creds, created));
    entry = created;
    c.entries.set(key, entry);
    raw.catch(() => {
      if (c.entries.get(key) !== created) return;
      c.entries.delete(key);
      created.gone = "closed";
    });
    startSweeper(c);
  }
  entry.lastUsed = Date.now();
  return entry;
}

/**
 * Waits for an entry's connection to open, at most `CONNECT_TIMEOUT_MS`. An open that
 * takes longer fails with a host error and is dropped from the cache, so the next call
 * starts a new attempt instead of joining it.
 */
function opened<T>(key: string, entry: Entry, host: string, value: Promise<T>): Promise<T> {
  return withDeadline(value, CONNECT_TIMEOUT_MS, () => {
    if (cache().entries.get(key) === entry) void closeConnection(key);
    return noAnswerError(host, CONNECT_TIMEOUT_MS);
  });
}

/** Takes an entry whose connection dropped out of the cache, unless it has been replaced already. */
function drop(key: string, entry: Entry): void {
  if (cache().entries.get(key) === entry) void evict(key, "dropped");
}

const splfName = (id: SpooledFileId): string => `spooled file ${id.name} number ${id.number} of job ${id.jobNumber}/${id.jobUser}/${id.jobName}`;

/**
 * Wraps a connection so each call marks the entry as used and `close()` evicts it.
 *
 * A call that fails because the connection dropped evicts the entry. A read is then tried
 * once more on a new connection, and later calls use that one. A change on the IBM i
 * (hold, move, delete, a command, an IFS write) is not tried again, since the IBM i may have done it
 * already: it fails with a host error that says what to check.
 */
function tracked(key: string, creds: Credentials, first: Entry): Connection {
  let entry = first;

  /** The entry to call: this one while it is open; after a drop, the one now cached or a new one. */
  const current = async (): Promise<[Entry, Connection]> => {
    if (entry.gone) {
      const cached = cache().entries.get(key);
      if (cached) entry = cached;
      else if (entry.gone === "dropped") entry = entryFor(creds);
      else {
        // Closed on purpose, or it never opened: say why rather than sign on again.
        await entry.raw;
        throw new ConnectionError("other", `The connection to ${creds.host} was closed. Try again.`);
      }
    }
    entry.lastUsed = Date.now();
    return [entry, await opened(key, entry, creds.host, entry.raw)];
  };

  const read = async <T>(run: (conn: Connection) => Promise<T>, again = true): Promise<T> => {
    const [used, conn] = await current();
    try {
      return await run(conn);
    } catch (err) {
      if (!isDropped(err)) throw err;
      drop(key, used);
      // Not when it was closed on purpose while the call ran.
      if (!again || used.gone !== "dropped") throw err;
      return read(run, false);
    }
  };

  const write = async <T>(run: (conn: Connection) => Promise<T>, check: string): Promise<T> => {
    const [used, conn] = await current();
    try {
      return await run(conn);
    } catch (err) {
      if (!isDropped(err)) throw err;
      drop(key, used);
      const e = err as { message?: string; messageId?: string; detail?: string };
      throw new ConnectionError(
        "host",
        `The connection to ${creds.host} dropped before the IBM i answered. Check whether ${check}, then try again.`,
        { messageId: e.messageId, detail: e.detail ?? e.message },
      );
    }
  };

  return {
    describe: (): Promise<SystemInfo> => read((conn) => conn.describe()),
    listOutputQueues: (filter) => read((conn) => conn.listOutputQueues(filter)),
    listSpooledFiles: (queue, filter) => read((conn) => conn.listSpooledFiles(queue, filter)),
    countSpooledFiles: (filter) => read((conn) => conn.countSpooledFiles(filter)),
    readSpooledFile: (id) => read((conn) => conn.readSpooledFile(id)),
    readDataQueue: (dtaq, wait) => read((conn) => conn.readDataQueue(dtaq, wait)),
    holdSpooledFile: (id) => write((conn) => conn.holdSpooledFile(id), `${splfName(id)} was held`),
    moveSpooledFile: (id, queue) => write((conn) => conn.moveSpooledFile(id, queue), `${splfName(id)} was moved to ${queue.library}/${queue.name}`),
    deleteSpooledFile: (id) => write((conn) => conn.deleteSpooledFile(id), `${splfName(id)} was deleted`),
    runCommand: (command) => write((conn) => conn.runCommand(command), "the command ran"),
    ifsStat: (path) => read((conn) => conn.ifsStat(path)),
    writeIfsFile: (path, bytes, options) => write((conn) => conn.writeIfsFile(path, bytes, options), `${path} was written`),
    close: () => closeConnection(key),
  };
}

/**
 * Returns the open connection for these credentials, opening one when there is none.
 * An open that takes longer than `CONNECT_TIMEOUT_MS` fails with a host error and is
 * dropped from the cache, so the next call starts a new attempt instead of joining it.
 */
export async function getConnection(creds: Credentials): Promise<Connection> {
  const entry = entryFor(creds);
  return opened(connectionKey(creds), entry, creds.host, entry.connection);
}

/**
 * Signs on again from scratch: closes the cached connection for these credentials, opens a
 * new one and reads the system info. A connection that died cannot pass for a working one.
 *
 * @returns The system info; throws ConnectionError when the sign-on fails
 */
export async function reconnect(creds: Credentials): Promise<SystemInfo> {
  await closeConnection(connectionKey(creds));
  const conn = await getConnection(creds);
  return conn.describe();
}

/** Takes the entry with this key out of the cache and closes its connection. */
async function evict(key: string, gone: NonNullable<Entry["gone"]>): Promise<void> {
  const c = cache();
  const entry = c.entries.get(key);
  if (!entry) return;
  c.entries.delete(key);
  entry.gone = gone;
  const conn = await entry.raw.catch(() => null);
  await conn?.close().catch(() => undefined);
}

/** Closes and forgets the cached connection with this key. Unknown keys are ignored. */
export async function closeConnection(key: string): Promise<void> {
  await evict(key, "closed");
}

/** Closes every cached connection. */
export async function closeAllConnections(): Promise<void> {
  await Promise.all([...cache().entries.keys()].map((key) => closeConnection(key)));
}
