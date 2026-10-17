# ibmi-output

Open output management for IBM i. Working name, not final.

Turn a spooled file into a JSON document, then render it with ordinary
DOCX, XLSX, HTML or PDF templates and deliver it. The first experience is
design time: connect, pick an output queue and a sample spooled file, let an
AI model propose a document definition and a first template, check the
extracted fields next to the page, then refine by chat or by editing the
template. Automation (queue watcher, delivery, archive) comes second.

## Status

Concept stage. Nothing runs yet. The concept deck lives outside this
repository for now.

## Planned layout

- `packages/core`: document model, definition schema, spool readers (*SCS
  via jt400, XML in spool, SQL-only fallback), render engines, delivery
  channels, all behind plugin interfaces.
- `packages/server`: the web app and API: connect, capture, propose,
  preview, refine.
- `packages/cli`: capture a sample, render a definition locally, run
  sample-based tests.
- `demo-spool`: CL, DDS and RPG sources that create output queues and
  print invented documents on any IBM i, for demos and end-to-end tests.
  Written for a PUB400 account.
- `samples/`: captured spooled files with their expected JSON, used as
  test fixtures. Invented data only.

## Rules

- Public repository. No customer, site or ERP specific names anywhere:
  libraries, tables, columns, users, hosts, document numbers. Use
  `MYLIB`, `ORDERS`, `CUSTOMERS`, `ibmi.example.com` and invented values.
- `local/` is ignored and holds credentials, notes and anything real.
- Apache 2.0.
