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

/** Opens a JDBC connection through node-jt400. This starts the JVM on first use. */
export async function openJdbc(host: string, user: string, password: string): Promise<Jt400Db> {
  const { connect } = await import("node-jt400");
  const db = await connect({ host, user, password, naming: "sql" });
  return db as unknown as Jt400Db;
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
