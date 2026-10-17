// Install demo-spool on IBM i over ODBC, no SSH needed.
//   npm run deploy
// 1. Write each file in ../src to /home/<user>/demo-spool/src/ (QSYS2.IFS_WRITE_UTF8).
// 2. Create source file SPDSRC in PUB400_LIB and copy each stream file into a member.
// 3. Compile: CRTBNDRPG, CRTBNDCL, CRTCMD.
// 4. CALL SPDSETUP to create the output queues and the data queue.
// Every object goes into PUB400_LIB. Running it again replaces what is there.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cl, connect, errorText, jobName, printJobLog, recentMessages, settings } from "./connection.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(here, "../src");

// Compile order: printer programs, CL programs, then the command.
const ORDER = ["RPGLE", "CLLE", "CMD"];

const s = settings();
const lib = s.lib;
const ifsDir = `/home/${s.user}/demo-spool`;
const ifsSrc = `${ifsDir}/src`;

const sources = readdirSync(SRC_DIR)
  .map((file) => {
    const m = /^([A-Z0-9]{1,10})\.(RPGLE|CLLE|CMD)$/.exec(file);
    return m && { file, member: m[1], type: m[2] };
  })
  .filter(Boolean)
  .sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || a.member.localeCompare(b.member));

const conn = await connect(s);
let failed = 0;
try {
  console.log(`Connected to ${s.host}. Library ${lib}, IFS ${ifsSrc}`);

  // CL commands that may fail because the object exists already.
  await clUnlessExists(`MKDIR DIR('${ifsDir}')`, ["CPFA0A0"]);
  await clUnlessExists(`MKDIR DIR('${ifsSrc}')`, ["CPFA0A0"]);
  // CCSID(*JOB): the source file, and so the literals compiled into the programs,
  // use the same code page as the job that prints and the jobs that view the
  // output. A fixed CCSID(37) printed as [ and \ on a system whose jobs run 273.
  // The file is recreated so a previous CCSID does not linger.
  try {
    await cl(conn, `DLTF FILE(${lib}/SPDSRC)`);
  } catch {
    // not there yet
  }
  await cl(conn, `CRTSRCPF FILE(${lib}/SPDSRC) RCDLEN(112) CCSID(*JOB) TEXT('Demo spool sources')`);

  for (const src of sources) {
    const stmf = `${ifsSrc}/${src.file}`;
    await writeStreamFile(stmf, readFileSync(resolve(SRC_DIR, src.file), "utf8"));
    await clUnlessExists(
      `ADDPFM FILE(${lib}/SPDSRC) MBR(${src.member}) SRCTYPE(${src.type})`,
      ["CPF5812", "CPF7306"],
    );
    await cl(
      conn,
      // STMFCCSID(1208): the stream file holds UTF-8 whatever its tag says; without
      // this the copy read it as single-byte and every ä became two bytes.
      `CPYFRMSTMF FROMSTMF('${stmf}') ` +
        `TOMBR('/QSYS.LIB/${lib}.LIB/SPDSRC.FILE/${src.member}.MBR') MBROPT(*REPLACE) ` +
        `STMFCCSID(1208)`,
    );
    await cl(conn, `CHGPFM FILE(${lib}/SPDSRC) MBR(${src.member}) SRCTYPE(${src.type})`);
    console.log(`  source  ${src.member.padEnd(10)} ${src.type}`);
  }

  for (const src of sources) {
    const ok = await compile(src);
    console.log(`  ${ok ? "compiled" : "FAILED  "} ${src.member.padEnd(10)} ${src.type}`);
    if (!ok) failed += 1;
  }

  if (failed) {
    console.error(`\n${failed} compile(s) failed. Setup was not run.`);
    console.error(`Compile listings are spooled files of job ${await jobName(conn)}:`);
    console.error("  WRKSPLF, or QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC filtered on that JOB_NAME.");
    process.exitCode = 1;
  } else {
    await cl(conn, `CALL PGM(${lib}/SPDSETUP) PARM('${lib}')`);
    console.log(`\nSetup done: output queues FORMS, EMAIL, REPORTS and data queue SPLFDTAQ in ${lib}.`);
    console.log("Next: npm run print");
  }
} catch (err) {
  console.error(`\nDeploy failed: ${errorText(err)}`);
  await printJobLog(conn);
  process.exitCode = 1;
} finally {
  await conn.close();
}

/** Run a CL command; ignore it if the job log says the object exists already. */
async function clUnlessExists(command, existsIds) {
  try {
    await cl(conn, command);
  } catch (err) {
    const ids = (await recentMessages(conn, 6)).map((r) => r.MESSAGE_ID);
    if (!ids.some((id) => existsIds.includes(id))) throw err;
  }
}

/**
 * Write a stream file as UTF-8 bytes (CCSID 1208), in chunks on line boundaries.
 * The bytes go through IFS_WRITE_BINARY, not IFS_WRITE_UTF8: a text parameter is
 * converted by the ODBC driver on the way in, and on a client without a UTF-8
 * locale every ä arrived double-encoded. Binary bypasses that conversion.
 */
async function writeStreamFile(path, text) {
  const lines = text.split(/(?<=\n)/);
  let chunk = "";
  let first = true;
  const flush = async () => {
    await conn.query(
      "CALL QSYS2.IFS_WRITE_BINARY(PATH_NAME => ?, LINE => ?, OVERWRITE => ?, FILE_CCSID => 1208)",
      [path, Buffer.from(chunk, "utf8"), first ? "REPLACE" : "APPEND"],
    );
    first = false;
    chunk = "";
  };
  for (const line of lines) {
    if (Buffer.byteLength(chunk + line, "utf8") > 8000) await flush();
    chunk += line;
  }
  if (chunk || first) await flush();
}

/** Compile one member. On failure print the job log and the listing's error lines. */
async function compile(src) {
  const srcfile = `SRCFILE(${lib}/SPDSRC) SRCMBR(${src.member})`;
  let command;
  if (src.type === "RPGLE") {
    command = `CRTBNDRPG PGM(${lib}/${src.member}) ${srcfile} DBGVIEW(*NONE) REPLACE(*YES)`;
  } else if (src.type === "CLLE") {
    command = `CRTBNDCL PGM(${lib}/${src.member}) ${srcfile} REPLACE(*YES)`;
  } else {
    // CRTCMD has no REPLACE on older releases: delete first.
    try {
      await cl(conn, `DLTCMD CMD(${lib}/${src.member})`);
    } catch {
      // not there yet
    }
    command = `CRTCMD CMD(${lib}/${src.member}) PGM(${lib}/${src.member}C) ${srcfile}`;
  }
  try {
    await cl(conn, command);
    return true;
  } catch (err) {
    console.error(`\n${command}\n  ${errorText(err)}`);
    await printJobLog(conn, 10);
    await printListingErrors(src.member);
    return false;
  }
}

/** Show the error lines of the newest compile listing of this job. */
async function printListingErrors(name) {
  try {
    const rows = await conn.query(
      `SELECT SPOOLED_DATA
         FROM TABLE(SYSTOOLS.SPOOLED_FILE_DATA(JOB_NAME => QSYS2.JOB_NAME, SPOOLED_FILE_NAME => ?)) L
        WHERE SPOOLED_DATA LIKE '%RNF%' OR SPOOLED_DATA LIKE '%CPD%' OR SPOOLED_DATA LIKE '%CPF%'
        FETCH FIRST 40 ROWS ONLY`,
      [name],
    );
    if (rows.length) {
      console.error(`  Listing ${name}, lines with message IDs:`);
      for (const r of rows) console.error(`    ${r.SPOOLED_DATA.trimEnd()}`);
    }
  } catch (err) {
    console.error(`  (no listing ${name} found: ${errorText(err)})`);
  }
}
