// Print the first 80 lines of one spooled file through SYSTOOLS.SPOOLED_FILE_DATA.
//   npm run show -- SPDINVOICE 123456/MYUSER/QZDASOINIT 3
// The number defaults to *LAST. SPOOLED_FILE_DATA returns lines only;
// page breaks and line positions are not kept.
import { connect, errorText, settings } from "./connection.mjs";

const [splf, job, nbr = "*LAST"] = process.argv.slice(2);
if (!splf || !job) {
  console.error("usage: npm run show -- <spooled file name> <job number/user/name> [file number]");
  process.exit(2);
}

// The ODBC driver sizes parameter markers for this table function too small
// (CWB0111), so the values are checked here and put into the statement as literals.
const JOB = job.toUpperCase();
const SPLF = splf.toUpperCase();
const NBR = String(nbr).toUpperCase();
if (!/^\d{6}\/[A-Z0-9_#$@]{1,10}\/[A-Z0-9_#$@.]{1,10}$/.test(JOB)) {
  console.error(`job must look like 123456/USER/JOBNAME, got ${JOB}`);
  process.exit(2);
}
if (!/^[A-Z0-9_#$@]{1,10}$/.test(SPLF) || !/^(\d{1,6}|\*LAST)$/.test(NBR)) {
  console.error("spooled file name must be 1-10 characters and the number a digit string or *LAST");
  process.exit(2);
}

const conn = await connect(settings());
try {
  const rows = await conn.query(
    `SELECT ORDINAL_POSITION, SPOOLED_DATA
       FROM TABLE(SYSTOOLS.SPOOLED_FILE_DATA(
              JOB_NAME => '${JOB}', SPOOLED_FILE_NAME => '${SPLF}', SPOOLED_FILE_NUMBER => '${NBR}')) S
      ORDER BY ORDINAL_POSITION
      FETCH FIRST 80 ROWS ONLY`,
  );
  for (const r of rows) {
    console.log(`${String(r.ORDINAL_POSITION).padStart(4)} ${(r.SPOOLED_DATA ?? "").trimEnd()}`);
  }
} catch (err) {
  console.error(`Show failed: ${errorText(err)}`);
  process.exitCode = 1;
} finally {
  await conn.close();
}
