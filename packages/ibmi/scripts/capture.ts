// Capture a spooled file from an IBM i into the workspace, or list queues and files.
//
//   pnpm --filter @spooldoc/ibmi capture -- --list
//   pnpm --filter @spooldoc/ibmi capture -- <QUEUE> <SPLFNAME> [workspaceRoot]
//
// Reads PUB400_HOST, PUB400_USER, PUB400_PASSWORD and PUB400_LIB from local/.env at the
// repository root (environment variables win). The password is never printed. The
// captured sample is scrubbed with scrubSample before it is written.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openWorkspace, scrubSample } from "@spooldoc/core";
import { captureSample, ConnectionError, type Connection } from "../src/index.js";
import { openJt400Connection } from "../src/jt400/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const ENV_FILE = resolve(repoRoot, "local/.env");

/** Parse a KEY=VALUE file. Blank lines and # comments are skipped. */
function readEnvFile(file: string): Record<string, string> {
  const values: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return values;
  }
  for (const raw of text.split(/\r?\n/)) {
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

function settings(): { host: string; user: string; password: string; lib: string } {
  const env = readEnvFile(ENV_FILE);
  const pick = (key: string): string => (process.env[key] ?? env[key] ?? "").trim();
  const s = {
    host: pick("PUB400_HOST"),
    user: pick("PUB400_USER").toUpperCase(),
    password: pick("PUB400_PASSWORD"),
    lib: pick("PUB400_LIB").toUpperCase(),
  };
  for (const [key, value] of Object.entries(s)) {
    if (!value) throw new Error(`PUB400_${key === "lib" ? "LIB" : key.toUpperCase()} is empty (set it in ${ENV_FILE})`);
  }
  return s;
}

function table(rows: string[][]): string {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length))) ?? [];
  return rows.map((r) => r.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ").trimEnd()).join("\n");
}

async function list(conn: Connection, lib: string): Promise<void> {
  const info = await conn.describe();
  console.log(`${info.host} ${info.vrm}, job CCSID ${info.jobCcsid}\n`);
  const queues = await conn.listOutputQueues({ library: lib });
  console.log(table([["LIBRARY", "QUEUE", "FILES", "TEXT"], ...queues.map((q) => [q.library, q.name, String(q.files), q.text])]));
  for (const q of queues) {
    const files = await conn.listSpooledFiles(q);
    console.log(`\n${q.library}/${q.name}`);
    if (files.length === 0) {
      console.log("  (empty)");
      continue;
    }
    console.log(
      table([
        ["  NAME", "NUMBER", "JOB", "USER DATA", "STATUS", "DEVTYPE", "PAGES", "WIDTH", "LENGTH", "CREATED"],
        ...files.map((f) => [
          `  ${f.name}`,
          String(f.number),
          `${f.jobNumber}/${f.jobUser}/${f.jobName}`,
          f.attributes.userData,
          f.status,
          f.attributes.deviceType,
          String(f.attributes.pages),
          String(f.attributes.pageWidth),
          String(f.attributes.pageLength),
          f.attributes.created,
        ]),
      ]),
    );
  }
}

async function capture(conn: Connection, lib: string, user: string, queue: string, name: string, root: string): Promise<void> {
  const want = name.toUpperCase();
  const files = (await conn.listSpooledFiles({ library: lib, name: queue }, { name: want })).filter((f) => f.name === want);
  const newest = files[0];
  if (!newest) throw new Error(`No spooled file ${want} in ${lib}/${queue.toUpperCase()}`);
  const { name: splfName, number, jobName, jobUser, jobNumber } = newest;
  const { sample, warnings } = await captureSample(conn, { name: splfName, number, jobName, jobUser, jobNumber });
  const scrubbed = scrubSample(sample);
  const text = scrubbed.pages.flatMap((p) => p.lines.map((l) => l.text)).join("\n");
  for (const secret of [user, lib]) {
    if (text.includes(secret)) warnings.push("The page text still holds the user or library name; the workspace is git-ignored, but do not copy this sample into fixtures as is.");
  }
  const ws = openWorkspace(root);
  await ws.writeSample(scrubbed);
  console.log(`${scrubbed.id}: ${scrubbed.pages.length} pages, ${scrubbed.attributes.pageWidth} columns, code page ${scrubbed.codePage}`);
  console.log(`written to ${ws.paths.sample(scrubbed.id)}`);
  for (const w of new Set(warnings)) console.log(`warning: ${w}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const listMode = args.includes("--list");
  const positional = args.filter((a) => !a.startsWith("--"));
  if (!listMode && positional.length < 2) {
    console.error("usage: capture -- --list | capture -- <QUEUE> <SPLFNAME> [workspaceRoot]");
    process.exit(2);
  }
  const s = settings();
  const conn = await openJt400Connection({ host: s.host, user: s.user, password: s.password });
  try {
    if (listMode) {
      await list(conn, s.lib);
    } else {
      const [queue = "", name = "", rootArg] = positional;
      const cwd = process.env.INIT_CWD ?? process.cwd();
      const root = rootArg ? resolve(cwd, rootArg) : resolve(process.env.SPOOLDOC_WORKSPACE ?? resolve(repoRoot, "workspace"));
      await capture(conn, s.lib, s.user, queue, name, root);
    }
  } finally {
    await conn.close();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    const message = err instanceof ConnectionError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err);
    console.error(`error: ${message}`);
    process.exit(1);
  },
);
