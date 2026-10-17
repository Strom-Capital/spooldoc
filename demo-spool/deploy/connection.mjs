// Shared connection helpers for the demo-spool scripts.
// Reads PUB400_HOST, PUB400_USER, PUB400_LIB and PUB400_PASSWORD from
// ../../local/.env (relative to this file) and connects with the
// IBM i Access ODBC Driver. Nothing here ever prints the password.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import odbc from "odbc";

const here = dirname(fileURLToPath(import.meta.url));
export const ENV_FILE = resolve(here, "../../local/.env");

/** Parse a KEY=VALUE file. Blank lines and # comments are skipped. */
export function readEnvFile(file = ENV_FILE) {
  const values = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    let value = line.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    values[line.slice(0, eq).trim()] = value;
  }
  return values;
}

/** Host, user, library and password, checked. */
export function settings() {
  const env = readEnvFile();
  const pick = (key) => (process.env[key] ?? env[key] ?? "").trim();
  const s = {
    host: pick("PUB400_HOST"),
    user: pick("PUB400_USER").toUpperCase(),
    lib: pick("PUB400_LIB").toUpperCase(),
    password: pick("PUB400_PASSWORD"),
  };
  for (const [key, value] of Object.entries(s)) {
    if (!value) throw new Error(`PUB400_${key.toUpperCase()} is empty in ${ENV_FILE}`);
  }
  // The library and user go into CL commands, so allow object names only.
  for (const key of ["user", "lib"]) {
    if (!/^[A-Z#$@][A-Z0-9#$@_.]{0,9}$/.test(s[key])) {
      throw new Error(`PUB400_${key.toUpperCase()} is not a valid IBM i name`);
    }
  }
  return s;
}

/**
 * Open a connection. NAM=1 is system naming (LIB/OBJ), CMT=0 is no commitment
 * control. CCSID=1208 makes the driver exchange character data as UTF-8; without
 * it, text with ä or ö comes back as U+FFFD on a client without a UTF-8 locale.
 */
export async function connect(s = settings()) {
  const connectionString =
    `DRIVER=IBM i Access ODBC Driver;SYSTEM=${s.host};UID=${s.user};PWD=${s.password};` +
    "NAM=1;CMT=0;CCSID=1208;";
  try {
    return await odbc.connect(connectionString);
  } catch (err) {
    throw new Error(`Cannot connect to ${s.host} as ${s.user}: ${errorText(err)}`);
  }
}

/** Run one CL command through QSYS2.QCMDEXC. Throws on failure. */
export async function cl(conn, command) {
  await conn.query("CALL QSYS2.QCMDEXC(?)", [command]);
}

/** The most recent job log messages of this connection's job, newest first. */
export async function recentMessages(conn, count = 15) {
  return conn.query(
    `SELECT MESSAGE_ID, MESSAGE_TYPE, MESSAGE_TEXT
       FROM TABLE(QSYS2.JOBLOG_INFO('*')) J
      ORDER BY ORDINAL_POSITION DESC
      FETCH FIRST ${Number(count)} ROWS ONLY`,
  );
}

/** Print recent job log messages, oldest first. */
export async function printJobLog(conn, count = 15) {
  try {
    const rows = await recentMessages(conn, count);
    console.error("  Recent job log messages:");
    for (const r of rows.reverse()) {
      console.error(`    ${r.MESSAGE_ID ?? "       "} ${r.MESSAGE_TYPE ?? ""}: ${r.MESSAGE_TEXT ?? ""}`);
    }
  } catch (err) {
    console.error(`  (could not read the job log: ${errorText(err)})`);
  }
}

/** The qualified name of this connection's job (a QZDASOINIT server job). */
export async function jobName(conn) {
  const rows = await conn.query("VALUES QSYS2.JOB_NAME");
  return Object.values(rows[0])[0];
}

/** Readable text of an odbc error. */
export function errorText(err) {
  if (err?.odbcErrors?.length) return err.odbcErrors.map((e) => e.message).join(" | ");
  return err?.message ?? String(err);
}
