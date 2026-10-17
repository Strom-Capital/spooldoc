// Print the demo documents and list what landed on the demo output queues.
//   npm run print                 all queues, one run
//   npm run print -- FORMS 2      only FORMS, two runs
//   npm run print -- --list       list only, print nothing
import { cl, connect, errorText, printJobLog, settings } from "./connection.mjs";

const QUEUES = ["FORMS", "EMAIL", "REPORTS"];
const listOnly = process.argv[2] === "--list";
const queue = listOnly ? "*ALL" : (process.argv[2] ?? "*ALL").toUpperCase();
const count = listOnly ? 1 : Number(process.argv[3] ?? 1);
if (![...QUEUES, "*ALL"].includes(queue) || !Number.isInteger(count) || count < 1 || count > 20) {
  console.error("usage: npm run print -- [*ALL|FORMS|EMAIL|REPORTS] [count 1-20]");
  process.exit(2);
}

const s = settings();
const conn = await connect(s);
try {
  if (!listOnly) {
    await cl(conn, `${s.lib}/SPDPRINT QUEUE(${queue}) COUNT(${count}) LIB(${s.lib})`);
    console.log(`Printed QUEUE(${queue}) COUNT(${count}).\n`);
  }
  await listEntries();
  await listWidths();
  await countDataQueue();
} catch (err) {
  console.error(`Print failed: ${errorText(err)}`);
  await printJobLog(conn);
  process.exitCode = 1;
} finally {
  await conn.close();
}

/** Spooled files on the three demo queues, oldest first. */
async function listEntries() {
  const rows = await conn.query(
    `SELECT *
       FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
      WHERE OUTPUT_QUEUE_LIBRARY_NAME = ?
        AND OUTPUT_QUEUE_NAME IN ('FORMS', 'EMAIL', 'REPORTS')
      ORDER BY CREATE_TIMESTAMP`,
    [s.lib],
  );
  console.log(`${rows.length} spooled file(s) on ${s.lib}/FORMS, EMAIL, REPORTS:`);
  const table = rows.map((r) => ({
    queue: r.OUTPUT_QUEUE_NAME,
    file: r.SPOOLED_FILE_NAME,
    job: r.JOB_NAME,
    nbr: r.FILE_NUMBER ?? r.SPOOLED_FILE_NUMBER,
    userData: r.USER_DATA,
    status: r.STATUS,
    pages: r.TOTAL_PAGES,
    device: r.DEVICE_TYPE,
  }));
  if (table.length) console.table(table);
  const last = table.at(-1);
  if (last) console.log(`Show one: npm run show -- ${last.file} ${last.job} ${last.nbr}\n`);
}

/** Page width and length from QSYS2.OUTPUT_QUEUE_ENTRIES (the detailed view). */
async function listWidths() {
  try {
    const rows = await conn.query(
      `SELECT SPOOLED_FILE_NAME, JOB_NAME, FILE_NUMBER, PAGE_LENGTH, PAGE_WIDTH,
              CHARACTERS_PER_INCH, LINES_PER_INCH
         FROM QSYS2.OUTPUT_QUEUE_ENTRIES
        WHERE OUTPUT_QUEUE_LIBRARY_NAME = ?
          AND OUTPUT_QUEUE_NAME IN ('FORMS', 'EMAIL', 'REPORTS')
        ORDER BY CREATE_TIMESTAMP`,
      [s.lib],
    );
    if (rows.length) {
      console.log("Page size:");
      console.table(rows.map((r) => ({
        file: r.SPOOLED_FILE_NAME,
        nbr: r.FILE_NUMBER,
        length: r.PAGE_LENGTH,
        width: r.PAGE_WIDTH,
        cpi: r.CHARACTERS_PER_INCH,
        lpi: r.LINES_PER_INCH,
      })));
    }
  } catch (err) {
    console.log(`(page width not available here: ${errorText(err).slice(0, 160)})`);
  }
}

/** Entries on the data queue attached to FORMS. Held files send none until released. */
async function countDataQueue() {
  try {
    const rows = await conn.query(
      `SELECT COUNT(*) AS N
         FROM TABLE(QSYS2.DATA_QUEUE_ENTRIES(DATA_QUEUE => 'SPLFDTAQ', DATA_QUEUE_LIBRARY => ?)) D`,
      [s.lib],
    );
    console.log(`Data queue ${s.lib}/SPLFDTAQ holds ${rows[0].N} entr${rows[0].N == 1 ? "y" : "ies"}.`);
  } catch (err) {
    console.log(`(data queue not readable: ${errorText(err).slice(0, 160)})`);
  }
}
