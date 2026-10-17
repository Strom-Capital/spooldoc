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
It is tested against real demo spooled files captured from PUB400.

`packages/ibmi` connects to an IBM i through jt400 (the `node-jt400`
package and its Java bridge, so a JDK is needed to install it): it lists
output queues and spooled files with SQL services and captures a spooled
file as a sample.

`apps/web` is the design-time web app without the AI part: connect to an
IBM i, browse output queues, capture a spooled file, then check the
extracted JSON next to the page with every field highlighted, edit the
definition and the template, and preview the rendered HTML or PDF. The
model proposals and the chat come next.

```sh
pnpm install
pnpm -r build && pnpm -r test
pnpm --filter @spooldoc/core demo   # the six demo invoices as JSON

# with PUB400_HOST, PUB400_USER, PUB400_PASSWORD and PUB400_LIB in local/.env
pnpm --filter @spooldoc/ibmi capture -- --list              # queues and spooled files
pnpm --filter @spooldoc/ibmi capture -- EMAIL SPDINVOICE    # newest SPDINVOICE into workspace/samples
```

Run the web app:

```sh
cp apps/web/.env.example apps/web/.env.local   # then set SESSION_SECRET (openssl rand -base64 32)
pnpm dev                                       # core and ibmi in watch mode, Next.js on port 3002
```

Open http://localhost:3002. PDF export needs `SPOOLDOC_CHROMIUM_PATH`
pointing at a Chromium or Chrome executable.

### Trust

The IBM i password stays in an encrypted, httpOnly session cookie and in
the server's connection cache; it is never logged or returned. The model,
when one is configured, never receives credentials. The workspace folder
holds captured spool data in clear text, so keep it private.

## Layout

- `packages/core`: pure TypeScript core, no UI and no IBM i dependency:
  samples, *SCS parser, definitions, extraction, templates, PDF, masking,
  workspace. Fixtures in `packages/core/fixtures` are captured demo
  spooled files with their definitions, templates and expected JSON.
- `packages/ibmi`: connect to an IBM i, list output queues and spooled
  files, and capture spooled files as samples. The root export holds the
  `Connection` interface, `captureSample` and the pure SQL helpers and
  does not load Java; `@spooldoc/ibmi/jt400` is the jt400 implementation
  (one JVM per process, cached connections). `scripts/capture.ts` is the
  capture command; captured samples are scrubbed before they are written.
- `apps/web`: the design-time web app (Next.js): connect, browse queues,
  capture, and the workbench with the page view, JSON, definition and
  template editors and the HTML preview. `lib/server` holds config,
  session, the IBM i connection (`ibmi.ts` is the only module that loads
  the jt400 driver) and rendering; route handlers are under `app/api`.
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
