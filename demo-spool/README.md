# demo-spool

IBM i sources and small Node scripts that create three output queues and
print invented business documents onto them. The spooled files are used for
demos and as test fixtures. Everything is written for a free
[pub400.com](https://pub400.com) developer account: one library, no special
authorities (no `*JOBCTL`, no `*SPLCTL`), only your own spooled files. It
works the same on any IBM i 7.4 or later.

All data is invented: company `MYCO`, customers such as `NORTHERN SUPPLY CO`,
items such as `A-1001 BRACKET 40MM`. No database files are read; every
program generates the same documents on every run.

## What it creates

All objects go into one library (`MYLIB` in the examples).

| Object | Type | What it is |
| --- | --- | --- |
| `SPDSRC` | `*FILE` (source PF, record length 112, CCSID 37) | the sources below as members |
| `FORMS`, `INVOICES`, `REPORTS` | `*OUTQ` | demo output queues |
| `SPLFDTAQ` | `*DTAQ` (max length 128) | attached to `FORMS`; gets an entry when a spooled file on `FORMS` becomes ready |
| `SPDSETUP` | `*PGM` (CL) | creates the queues and the data queue; safe to run again |
| `SPDCLEAN` | `*PGM` (CL) | removes the demo spooled files and objects |
| `SPDPRINT` | `*CMD` | prints the demo documents (`QUEUE`, `COUNT`, `LIB`) |
| `SPDPRINTC` | `*PGM` (CL) | processing program of `SPDPRINT` |
| `SPDORDERR`, `SPDINVOICE`, `SPDPICK`, `SPDXML` | `*PGM` (RPG) | one printer program per document type |

The command `SPDPRINT` and its program `SPDPRINTC` have different names
because one source file cannot hold two members called `SPDPRINT`.

One run of `SPDPRINT` leaves four held, saved spooled files:

| Spooled file | Queue | User data | Size | Content |
| --- | --- | --- | --- | --- |
| `SPDORDERR` | `REPORTS` | `ORDERRPT` | 198 columns, 15 cpi, 51 lines, 4 pages | Operational report "Open order lines by customer". Page 1 is a parameter page (`Label....: value`). From page 2: a repeated page header (company, title, run date and time, program; `User:` and `Page n` on line two; a dashed rule), a column header, then 40 records of three lines each (values; type code; message). Ends with `*** End ***`. |
| `SPDINVOICE` | `INVOICES` | `INVOICE` | 132 columns, 10 cpi, 66 lines, 8 pages | Six invoices back to back, each from a new page. Header block (invoice number and date, customer number, name, three address lines, payment terms), a line table of 3 to 25 lines (every fourth line has a delivery note row), totals (net, VAT 25.5 %, total) and a footer at line 60. Invoices 260102 and 260106 continue on a second page under an `INVOICE (CONTINUED)` header. The invoice number is the split key. Some names and descriptions contain ä, ö, Ä and Ö. |
| `SPDPICK` | `FORMS` | `PICKLIST` | 132 columns, 10 cpi, 66 lines, 5 pages | Five pick lists, each on its own page: pick list and order number, customer, delivery address, warehouse, route, ship date; a line table (line, item, description, bin, lot, quantity, unit); a `Picked by ____ Checked ____` footer at line 60. |
| `SPDXML` | `FORMS` | `PICKXML` | 300 columns, 15 cpi, 66 lines, 5 pages | The same five pick lists as one XML document each (one per page), the kind a forms product reads from spool. |

The page counts above are what the programs are designed to produce; check
them with `npm run print -- --list` after a run.

The XML of one pick list looks like this (each `<LINE>` is one printed line,
and `SHIP_TO` spans several printed lines because its text holds line
breaks):

```xml
<?xml version="1.0"?>
<FORM>
  <DOCUMENT>
    <TITLE>PICK LIST</TITLE>
    <PICKLIST_NO>700002</PICKLIST_NO>
    <ORDER_NO>51021</ORDER_NO>
    <CUSTOMER_NO>10002</CUSTOMER_NO>
    <SHIP_TO>BAKER &amp; SONS LTD
Mill Lane 12
FI-33100 TAMPERE</SHIP_TO>
    <SHIP_DATE>2026-10-22</SHIP_DATE>
    <LINES>
      <LINE><NO>10</NO><ITEM>B-2002</ITEM><DESCRIPTION>HEX NUT M8</DESCRIPTION><WAREHOUSE>01</WAREHOUSE><BIN>B-02-12</BIN><QTY>8</QTY><UNIT>PCS</UNIT></LINE>
      ...
    </LINES>
    <OUTPUT_NAME>PICKLIST_700002</OUTPUT_NAME>
  </DOCUMENT>
</FORM>
```

## Install with the script

Needs Node 22 or later and the IBM i Access ODBC Driver.

1. Put your connection in `local/.env` at the repository root (the `local/`
   folder is git-ignored):

   ```ini
   PUB400_HOST=pub400.com
   PUB400_USER=MYUSER
   PUB400_LIB=MYLIB
   PUB400_PASSWORD=...
   ```

   `PUB400_LIB` is the library that gets every object. On PUB400 it is the
   library you were given at sign-up, which is not always your user name.

2. Install and deploy:

   ```sh
   cd demo-spool
   npm install
   npm run deploy
   ```

`deploy` writes each source to `/home/<user>/demo-spool/src/` as UTF-8 bytes
with `QSYS2.IFS_WRITE_BINARY`, recreates `SPDSRC` with the job's CCSID,
copies each stream file into a member with `CPYFRMSTMF STMFCCSID(1208)`,
compiles everything and calls `SPDSETUP`. It runs over ODBC only, no SSH.
Running it again replaces the sources and programs. The connection string
carries `CCSID=1208`, so text with ä or ö survives the trip in both
directions whatever the client's locale is.

When a compile fails, `deploy` prints the recent job log and the error lines
of the compile listing. ODBC runs every statement in a server job
(`nnnnnn/QUSER/QZDASOINIT`, running under your profile), so the listings are
spooled files of that job on your default output queue. `deploy` prints the
job name; find the listings with `WRKSPLF` or:

```sql
SELECT SPOOLED_FILE_NAME, FILE_NUMBER, CREATE_TIMESTAMP
  FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
 WHERE JOB_NAME = '123456/QUSER/QZDASOINIT';
```

## Install by hand from a 5250 session

For anyone without Node. Replace `MYLIB` with your library and `MYUSER` with
your user profile.

1. Upload the files in `src/` to an IFS folder, for example
   `/home/MYUSER/demo-spool/src/`, with IBM i Access Client Solutions,
   Code for IBM i or FTP (binary mode keeps the UTF-8 bytes).

2. Create the source file and copy each stream file into a member:

   ```
   CRTSRCPF FILE(MYLIB/SPDSRC) RCDLEN(112) CCSID(*JOB) TEXT('Demo spool sources')

   CPYFRMSTMF FROMSTMF('/home/MYUSER/demo-spool/src/SPDORDERR.RPGLE') +
              TOMBR('/QSYS.LIB/MYLIB.LIB/SPDSRC.FILE/SPDORDERR.MBR') +
              MBROPT(*REPLACE) STMFCCSID(1208)
   CHGPFM FILE(MYLIB/SPDSRC) MBR(SPDORDERR) SRCTYPE(RPGLE)
   ```

   Repeat for every file: `SPDINVOICE`, `SPDPICK` and `SPDXML` (`RPGLE`),
   `SPDSETUP`, `SPDCLEAN` and `SPDPRINTC` (`CLLE`), `SPDPRINT` (`CMD`).
   `CCSID(*JOB)` matters: the literals with ä and ö are compiled into the
   programs in the source file's code page, and the overrides tag the
   spooled files with `CHRID(*JOBCCSID)`, so both must match the job. If
   your job runs CCSID 65535, set a real CCSID on your profile first.

3. Compile:

   ```
   CRTBNDRPG PGM(MYLIB/SPDORDERR)  SRCFILE(MYLIB/SPDSRC) DBGVIEW(*NONE)
   CRTBNDRPG PGM(MYLIB/SPDINVOICE) SRCFILE(MYLIB/SPDSRC) DBGVIEW(*NONE)
   CRTBNDRPG PGM(MYLIB/SPDPICK)    SRCFILE(MYLIB/SPDSRC) DBGVIEW(*NONE)
   CRTBNDRPG PGM(MYLIB/SPDXML)     SRCFILE(MYLIB/SPDSRC) DBGVIEW(*NONE)
   CRTBNDCL  PGM(MYLIB/SPDSETUP)   SRCFILE(MYLIB/SPDSRC)
   CRTBNDCL  PGM(MYLIB/SPDCLEAN)   SRCFILE(MYLIB/SPDSRC)
   CRTBNDCL  PGM(MYLIB/SPDPRINTC)  SRCFILE(MYLIB/SPDSRC)
   CRTCMD    CMD(MYLIB/SPDPRINT) PGM(MYLIB/SPDPRINTC) SRCFILE(MYLIB/SPDSRC)
   ```

4. Create the queues:

   ```
   CALL PGM(MYLIB/SPDSETUP) PARM(MYLIB)
   ```

## Print the demo documents

From the scripts:

```sh
npm run print                  # all queues, one run
npm run print -- FORMS 3       # only FORMS, three runs
npm run print -- --list        # list what is there, print nothing
```

From a 5250 session:

```
MYLIB/SPDPRINT QUEUE(*ALL) COUNT(1) LIB(MYLIB)
```

| Parameter | Values | Default |
| --- | --- | --- |
| `QUEUE` | `*ALL`, `FORMS`, `INVOICES`, `REPORTS` | `*ALL` |
| `COUNT` | 1 to 20: how many times each document is printed | 1 |
| `LIB` | library that holds the queues and programs | `*CURLIB` |

`SPDPRINTC` overrides `QSYSPRT` before each printer program
(`OVRPRTF ... OUTQ(MYLIB/queue) HOLD(*YES) SAVE(*YES) PAGESIZE(...) CPI(...)
USRDTA(...) SPLFNAME(...) CHRID(*JOBCCSID)`), calls it and removes the
override. The spooled files are held, so nothing prints, and saved, so they
stay after a release.

On PUB400 every page ends with a footer line, `-=* https://pub400.com *=-`,
added by the job's print text attribute (`PRTTXT`). It is not in the
programs. It happens to be a handy page marker when you read the files
through SQL, which drops the page breaks.

## Look at them

From a 5250 session: `WRKOUTQ MYLIB/FORMS`, or `WRKSPLF` and option 5.

From SQL (any client, including the `db2i` MCP server):

```sql
-- what is on the demo queues
SELECT OUTPUT_QUEUE_NAME, SPOOLED_FILE_NAME, JOB_NAME, FILE_NUMBER,
       USER_DATA, STATUS, TOTAL_PAGES, DEVICE_TYPE
  FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
 WHERE OUTPUT_QUEUE_LIBRARY_NAME = 'MYLIB'
   AND OUTPUT_QUEUE_NAME IN ('FORMS', 'INVOICES', 'REPORTS');

-- the lines of one spooled file
SELECT ORDINAL_POSITION, SPOOLED_DATA
  FROM TABLE(SYSTOOLS.SPOOLED_FILE_DATA(
         JOB_NAME => '123456/MYUSER/QZDASOINIT',
         SPOOLED_FILE_NAME => 'SPDINVOICE',
         SPOOLED_FILE_NUMBER => '1'));
```

Or from the script, which prints the first 80 lines:

```sh
npm run show -- SPDINVOICE 123456/MYUSER/QZDASOINIT 1
```

`SPOOLED_FILE_DATA` returns the text lines only. Page breaks, blank lines
from skips and line positions are lost, so it is fine for a quick look but
not for layout work.

### The data queue

The system sends an entry to `SPLFDTAQ` when a spooled file on `FORMS`
becomes ready (status `RDY`). The demo files are printed held, so they send
no entry when printed. Release one to see the queue watcher case:

```
RLSSPLF FILE(SPDXML) JOB(123456/MYUSER/QZDASOINIT) SPLNBR(*LAST)
```

```sql
SELECT * FROM TABLE(QSYS2.DATA_QUEUE_ENTRIES(
  DATA_QUEUE => 'SPLFDTAQ', DATA_QUEUE_LIBRARY => 'MYLIB'));
```

There is no writer on these queues, so a released file stays `RDY` and is
never printed.

## Clean up

```
CALL PGM(MYLIB/SPDCLEAN) PARM(MYLIB)
```

**Warning:** `SPDCLEAN` clears the output queues `FORMS`, `INVOICES` and
`REPORTS` in the library, which deletes every spooled file on them, not only
the demo files. Then it deletes the queues, the data queue, the printer
programs, `SPDPRINTC`, `SPDSETUP` and the `SPDPRINT` command. It keeps
itself and `SPDSRC`; remove those by hand:

```
DLTPGM PGM(MYLIB/SPDCLEAN)
DLTF FILE(MYLIB/SPDSRC)
```

## How the printer programs work

The printer programs are free-format RPG IV (`**FREE`) with a
program-described printer file and a `PRTCTL` data structure:

```rpgle
dcl-f QSYSPRT printer(198) prtctl(prtCtl);

dcl-ds prtCtl len(15) inz;
  spaceBefore char(3);   // '000'
  spaceAfter char(3);    // '001'
  skipBefore char(3);    // '001' for a new page, '060' for a footer
  skipAfter char(3);
  curLine zoned(3:0);
end-ds;
```

Every line goes through one small `printText` procedure that sets the
`PRTCTL` values and writes a 198, 132 or 300 byte record. This was chosen
over DDS printer files because the layouts are built at run time from
column positions, there are no extra `*FILE` objects to create, and the
spooled files come out as plain `*SCS` line data, the same as most
operational reports on real systems. New pages use skip-before line 1;
footers use skip-before to a fixed line. No page uses its last two lines,
so the overflow line (set to the page length in the override) is never
reached and the system never ejects a page on its own.

Each program prints to `QSYSPRT` and relies on the override in `SPDPRINTC`
for the page size, queue and spooled file name. Called on their own, the
programs print to `QSYSPRT` with its defaults (132 columns, 66 lines), and
the wider lines are cut.

### CCSID

The stream files are UTF-8. `SPDSRC` is created with `CCSID(*JOB)`, so
`CPYFRMSTMF STMFCCSID(1208)` converts ä and ö into the code page of the job
that installs, and the compiled programs carry the literals in that code
page. The overrides set `CHRID(*JOBCCSID)`, so the spooled files say the
same. Viewers on the system, `WRKSPLF`, `SPOOLED_FILE_DATA`, `CPYSPLF`,
convert with the job's CCSID and show the characters correctly.

What went wrong before this was settled, and is worth knowing for any spool
reader: with the source file at CCSID 37 on a system whose jobs run 273, the
spooled files held code page 37 bytes under a correct `CHRID(697 37)`, and
every viewer still showed `[` and `\` for Ä and Ö because they convert with
the job CCSID, not the spooled file's CHRID. A reader that wants the right
characters has to read the raw bytes and convert with the CHRID itself.

### Fixed values

The run date and time in the report header are real. Everything else is
fixed, including the `User: DEMOUSER` in the report header, so captured
spooled files do not carry the name of the profile that printed them. The
job name of a spooled file still contains that profile name; take it out of
anything you commit.
