# Spooldoc

Spooled files into documents, for IBM i. Open output management.

Turn a spooled file into a JSON document, then render it with ordinary
DOCX, XLSX, HTML or PDF templates and deliver it. The first experience is
design time: connect, pick an output queue and a sample spooled file, let an
AI model propose a document definition and a first template, check the
extracted fields next to the page, then refine by chat or by editing the
template. Automation (queue watcher, delivery, archive) comes second.

## Status

Early development. `packages/core` exists: the capture format, an *SCS
parser with EBCDIC decode tables, document definitions in YAML, text and
XML-in-spool extraction, Nunjucks templates, PDF rendering through an
optional Chromium, value masking for model prompts and a file workspace.
It is tested against real demo spooled files captured from PUB400. There
is no UI and no IBM i connection yet.

```sh
pnpm install
pnpm -r build && pnpm -r test
pnpm --filter @spooldoc/core demo   # the six demo invoices as JSON
```

## Layout

- `packages/core`: pure TypeScript core, no UI and no IBM i dependency:
  samples, *SCS parser, definitions, extraction, templates, PDF, masking,
  workspace. Fixtures in `packages/core/fixtures` are captured demo
  spooled files with their definitions, templates and expected JSON.
- `packages/ibmi` (coming): connect to an IBM i, list output queues and
  capture spooled files as samples.
- `apps/web` (coming): the design-time web app: connect, capture,
  propose, preview, refine.
- `demo-spool`: CL and RPG sources that create output queues and
  print invented documents on any IBM i, for demos and end-to-end tests.
  Written for a PUB400 account.
- `workspace/`: the default `SPOOLDOC_WORKSPACE` (samples, definitions,
  templates). Ignored by git except its README.

## Rules

- Public repository. No customer, site or ERP specific names anywhere:
  libraries, tables, columns, users, hosts, document numbers. Use
  `MYLIB`, `ORDERS`, `CUSTOMERS`, `ibmi.example.com` and invented values.
- `local/` is ignored and holds credentials, notes and anything real.
- MIT licence, like mcp-server-db2i.
