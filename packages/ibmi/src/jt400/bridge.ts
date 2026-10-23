/* eslint-disable @typescript-eslint/no-explicit-any -- the Java bridge boundary: values are untyped Java proxies */
import { createRequire } from "node:module";

/** A Java object or class proxy from the `java` bridge. Methods are called with the `Sync` suffix. */
export type JavaObject = any;

/** The parts of the `java` module used here. */
export interface JavaModule {
  import(className: string): JavaObject;
  newArray(type: string, values: unknown[]): JavaObject;
  callStaticMethodSync(className: string, method: string, ...args: unknown[]): unknown;
}

/** The parts of a node-jt400 connection used here. */
export interface Jt400Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

let javaModule: JavaModule | undefined;

/**
 * The `java` module instance node-jt400 uses. It is resolved from node-jt400's own
 * location, so both share one JVM and one classpath (node-jt400 adds `jt400.jar`).
 */
export function loadJava(): JavaModule {
  if (!javaModule) {
    const require = createRequire(import.meta.resolve("node-jt400"));
    javaModule = require("java") as JavaModule;
  }
  return javaModule;
}

/**
 * Seconds jt400 waits for each connect and sign-on attempt. Without it a host that drops
 * packets blocks for the OS TCP timeout, twice (the port mapper on 449, then 8471).
 */
export const LOGIN_TIMEOUT_SECONDS = 15;

/** How a JDBC connection is opened. */
export interface JdbcOptions {
  /**
   * Open it for queries only: the jt400 driver refuses any statement but SELECT, WITH and
   * VALUES (JDBC property `access`), cancels a query that runs past its timeout, and returns
   * dates and times in ISO format, so their text does not depend on the job.
   */
  readOnly?: boolean;
}

/**
 * The jt400 JDBC driver properties for a connection, without the password. Values are
 * strings, as the driver wants them. TCP keepalive lets the socket notice a dropped network
 * instead of waiting on it.
 */
export function jdbcProperties(user: string, options: JdbcOptions = {}): Record<string, string> {
  const props: Record<string, string> = { user, naming: "sql", "login timeout": String(LOGIN_TIMEOUT_SECONDS), "keep alive": "true" };
  if (options.readOnly) {
    // "cancel" ends a query at its timeout; the default, "qqrytimlmt", only refuses one
    // whose estimated time is over the limit.
    Object.assign(props, { access: "read only", "query timeout mechanism": "cancel", "date format": "iso", "time format": "iso", "decimal separator": "." });
  }
  return props;
}

/** Opens a JDBC connection through node-jt400. This starts the JVM on first use. */
export async function openJdbc(host: string, user: string, password: string): Promise<Jt400Db> {
  const { connect } = await import("node-jt400");
  // Every key is passed to the jt400 JDBC driver as a property.
  const db = await connect({ host, password, ...jdbcProperties(user) });
  return db as unknown as Jt400Db;
}

/**
 * Opens a plain `java.sql.Connection` with the jt400 driver, for what node-jt400 does not
 * expose: a query timeout, parameter metadata, and preparing without running. The JVM
 * must be started with jt400 on its classpath, which `openJdbc` does.
 */
export async function openJavaJdbc(host: string, user: string, password: string, options: JdbcOptions = {}, java: JavaModule = loadJava()): Promise<JavaObject> {
  const props = new (java.import("java.util.Properties"))();
  for (const [key, value] of Object.entries({ ...jdbcProperties(user, options), password })) props.setPropertySync(key, value);
  const driver = new (java.import("com.ibm.as400.access.AS400JDBCDriver"))();
  return driver.connect(`jdbc:as400://${host}`, props);
}

/** Copies a Java `byte[]` (an `Int8Array`, an array of numbers or a Buffer) into a `Uint8Array`. */
export function javaBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof Int8Array) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  if (Array.isArray(value)) return Uint8Array.from(value as number[], (v) => v & 0xff);
  throw new TypeError("Unexpected byte[] representation from the Java bridge");
}

/** Reads a `java.io.InputStream` to the end in chunks and closes it. */
export function readAllSync(java: JavaModule, stream: JavaObject, chunk = 32768): Uint8Array {
  const buffer = java.newArray("byte", new Array<number>(chunk).fill(0));
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const n = Number(stream.readSync(buffer, 0, chunk));
      if (n < 0) break;
      if (n === 0) continue;
      const part = javaBytes(java.callStaticMethodSync("java.util.Arrays", "copyOf", buffer, n));
      parts.push(part);
      total += part.length;
    }
  } finally {
    stream.closeSync();
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** How many bytes `writeAllAsync` hands to Java at a time. */
const WRITE_CHUNK = 1024 * 1024;

/**
 * Writes bytes to a `java.io.OutputStream` and flushes it; the caller closes the stream.
 *
 * node-java does not turn a Buffer or a typed array into a `byte[]`, and
 * `newArray("byte", ...)` takes about 3 seconds for 5 MB. A Latin-1 string keeps each byte
 * as one character, and `Charset.encode` makes it a `ByteBuffer` on the Java side, which
 * takes about 20 ms for 5 MB. The channel writes 8 KiB at a time, so a 64 KiB buffer keeps
 * each of those from being a round trip to the IBM i. The writes run on a worker thread.
 */
export async function writeAllAsync(java: JavaModule, stream: JavaObject, bytes: Uint8Array): Promise<void> {
  const latin1 = java.callStaticMethodSync("java.nio.charset.Charset", "forName", "ISO-8859-1") as JavaObject;
  const buffered = new (java.import("java.io.BufferedOutputStream"))(stream, 65536);
  const channel = java.callStaticMethodSync("java.nio.channels.Channels", "newChannel", buffered) as JavaObject;
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 0; at < buffer.length; at += WRITE_CHUNK) {
    const chunk = latin1.encodeSync(buffer.toString("latin1", at, Math.min(buffer.length, at + WRITE_CHUNK)));
    while (chunk.hasRemainingSync()) await channel.write(chunk);
  }
  await buffered.flush();
}

/** A Java number or string attribute value as a plain JS value, or null. */
export function plain(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "bigint") return Number(value);
  const v = value as JavaObject;
  if (typeof v.longValue === "string" || typeof v.longValue === "number") return Number(v.longValue);
  if (typeof v.toStringSync === "function") return String(v.toStringSync());
  return String(value);
}
