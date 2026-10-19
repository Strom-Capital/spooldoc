---
title: "FAQ"
description: "Short answers to the questions that come up first."
---

## What is a spooled file, and why not read the database instead?

A spooled file is what a program on the IBM i prints: pages of text in
*SCS format on an output queue, waiting for a printer. Most ERP output
(invoices, pick lists, reports) exists only that way, laid out by programs
nobody wants to change. Spooldoc reads what the program already prints, so
nothing on the IBM i changes.

## Why turn the pages into JSON first, instead of rendering straight from the spooled file?

Because reading a page and laying out a document are different jobs, and
keeping them apart makes both easier:

- **The template never sees lines and columns.** The definition knows that
  the invoice number follows `Invoice no.......:` and that the lines start
  under a header at column 7. The template only knows `doc.invoiceNo` and
  `{% for line in doc.lines %}`. It is ordinary HTML with named values,
  not column arithmetic.
- **Each side changes on its own.** A new look needs a new template, not a
  new definition. A program change that moves a column needs one fix in
  the definition, and every template still works.
- **Values are typed once.** Numbers and dates are converted in the
  definition, so templates format them with filters and can sum them, and
  a value that does not convert is reported where it was read.
- **You can check the reading before the rendering.** The workbench shows
  the JSON next to the page with every hit highlighted, and the extraction
  report lists found, missing and empty fields. The assistant works from
  that report too.
- **One spooled file, many documents.** Six invoices printed back to back
  become six JSON objects and six files, split on the invoice number.
- **Same JSON for every output.** PDF and HTML today, DOCX and XLSX
  later, and destinations such as webhooks can carry the JSON itself.

See [Definitions](definitions.md) for the YAML that does the reading and
[Templates](templates.md) for the HTML that does the layout.

## Does Spooldoc install anything on the IBM i?

No. It signs on with a user profile, lists and reads spooled files through
SQL services and jt400, and holds, moves or deletes them as the job says.
Real-time watching creates a data queue and attaches it to the output
queue, only when you ask. See [Security](security.md#on-the-ibm-i).

## Which spooled files can it read?

Plain *SCS text, which is what most operational reports and
program-described printer files produce, in any EBCDIC code page the file
declares. XML printed into a spooled file works too. AFPDS and *USERASCII
are not supported yet.

## Do I need an AI model?

No. The assistant writes the first definition and template and fixes
missing fields, which saves most of the work, but a definition is plain
YAML you can write by hand with the page view beside you, and the starter
template renders every field. See [Definitions](definitions.md).

## What does the model see?

The page text of one preview spooled file, with the values as printed, or
masked when you turn masking on so digits and letters are replaced while
the layout stays, plus the definition and
template, and the documents it renders from a Word template. Never
credentials, never other spooled files. See
[AI assistant](ai-assistant.md#what-it-sees).

## The page shows `[` and `\` where Ä and Ö should be

The spooled file carries bytes in one code page and declares another, or
declares none. Spooldoc decodes with the file's own CHRID; when the file
has none and the job CCSID is 65535, set `SPOOLDOC_DEFAULT_CCSID` to the
code page the programs actually print in, such as 273 or 37. See
[Configuration](configuration.md).

## Why is a run skipped?

The spooled file does not pass the definition's `match` rules (`splf`,
`queue`, `userData`, `page1`). A job on a mixed queue takes only its own
files; loosen the rules or add a job for the other files.

## Why was a file not picked up by the watcher?

The watcher takes ready files, and held files only when the trigger says
so. A file that was on the queue before watching started is left for Run
now unless Backlog is on. Each file runs once, even after its run was
deleted by retention. See [Watching a queue](jobs.md#watching-a-queue).

## Can I run the same file again?

Yes: Retry in the job log runs it again with the active version.

## Why port 3000?

Because it is what Next.js and most web apps use. From source, `pnpm dev`
takes the next free port when 3000 is busy; in the container, `PORT`
changes it. See [Deployment](deployment.md#ports).

## Where is the data?

All of it is in Postgres: servers, jobs, versions, captured spooled files,
runs and their files. One `pg_dump` is the whole backup. See
[Deployment](deployment.md#backups).

## Can I use it without Docker?

Yes: Node 22, a JDK 17 for the jt400 bridge, Postgres, and a Carbone
server to render documents. See [Contributing](contributing.md).

## What is coming?

SFTP, S3, IFS, email and webhook destinations, more users and roles, and
DOCX and XLSX output. See the roadmap in the [README](../README.md#status).

## Where do I ask a question?

In [Discussions Q&A](https://github.com/Strom-Capital/spooldoc/discussions/categories/q-a).
Bugs and feature requests go to the
[issues](https://github.com/Strom-Capital/spooldoc/issues/new/choose), and
security problems to a private report (see [SECURITY.md](../SECURITY.md)).
Replace real customer, host, library and user names before you paste a
spooled file or a log.
