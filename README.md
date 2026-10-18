# Spooldoc

Spooled files into documents, for IBM i. Open output management.

Turn a spooled file into a JSON document, then render it with ordinary
HTML or PDF templates (DOCX and XLSX later) and deliver it. Add your IBM i
servers, pick the output queues that matter, and build a job for a queue:
let an AI model propose a document definition and a first template from a
sample spooled file, check the extracted fields next to the page, refine by
chat or by hand, save it as a version and run it on demand or let it watch
the queue. Every run is logged.

## Status

The web app has six pages:

- **Servers**: the IBM i systems, each with optional libraries to list
  queues from. Passwords are stored encrypted.
- **Queues**: the output queues of a server. Search, sort, hide the ones you
  don't need, and start a job from one.
- **Jobs**: pipelines from a queue to a destination. The job builder shows
  the steps (source, trigger, extract, render, destination, finish) as a
  pipeline; the extract and render steps hold the page view, the definition,
  the JSON, the template and the HTML and PDF preview, with the AI assistant
  beside them. Jobs are saved as versions and run on demand or by watching
  the queue: in real time through a data queue on the output queue, else by
  polling. After delivery a spooled file is held by default, or moved,
  deleted or left as it is.
- **Destinations**: for now PDFs kept in Spooldoc for download.
- **Job log**: every run with its steps, errors and files.
- **Settings**: how often the watcher polls queues and checks real-time
  queues, and how long runs are kept. Runs are deleted 90 days (1 to 3650)
  after they finish, with their captured spooled files and PDFs, as are
  preview samples no job uses; Spooldoc still remembers which spooled files
  it processed. The watcher cleans up once an hour.

Next:

- More destinations: SFTP, S3, IFS, email and webhooks.
- More users and roles.
- DOCX and XLSX renderers next to HTML and PDF.

## Packages

`packages/core` holds the capture format, an *SCS parser with EBCDIC
decode tables, document definitions in YAML, text and XML-in-spool
extraction, Nunjucks templates, PDF rendering through an optional
Chromium, value masking for model prompts and a file workspace. It is
tested against real demo spooled files captured from PUB400.

`packages/ibmi` connects to an IBM i through jt400 (the `node-jt400`
package and its Java bridge, so a JDK is needed to install it): it lists
output queues and spooled files with SQL services and captures a spooled
file as a sample.

`apps/web` is the web app: servers, queues, the job builder, destinations,
the job log and the queue watcher, with Postgres (Drizzle) for its data and
Better Auth for sign-in. In the job builder the AI assistant proposes the
definition and the template: it writes them to the job's draft through
tools, reads the extraction report, fixes missing fields and renders the
result, while the page view, JSON and preview update as it works.

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
docker compose up -d db                        # Postgres on localhost:5433
cp apps/web/.env.example apps/web/.env.local   # then set DATABASE_URL, BETTER_AUTH_SECRET and SPOOLDOC_SECRET_KEY
pnpm dev                                       # core and ibmi in watch mode, Next.js on port 3002
```

Open http://localhost:3002 and create the first account; after that,
sign-up is closed. The server applies the database migrations when it
starts (`pnpm --filter @spooldoc/web db:migrate` does it by hand). PDF export needs `SPOOLDOC_CHROMIUM_PATH`
pointing at a Chromium or Chrome executable. The PDF of a document is
named after the definition's `output.name` (for example
`invoice-260102.pdf`), printed on A4, portrait unless the spooled file is
wider than 160 columns or the template's `@page { size: ... }` says
otherwise.

### Run with Docker

The image holds the web app, a Java runtime for jt400 and Chromium for
PDFs, and runs on amd64 and arm64:

```sh
docker build -t spooldoc .
docker run -p 3002:3000 \
  -e DATABASE_URL=postgres://... \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -e SPOOLDOC_SECRET_KEY="$(openssl rand -base64 32)" \
  -e ANTHROPIC_API_KEY=... \
  spooldoc
```

Or `docker compose up --build` with the settings in a `.env` file next to
`compose.yaml` (the variables of `apps/web/.env.example`); it starts
Postgres too. Everything Spooldoc keeps is in the database: servers, jobs
and their versions, captured spooled files, runs and their PDFs, so one
`pg_dump` is the whole backup. Keep `SPOOLDOC_SECRET_KEY` the same across
restarts, or the saved IBM i passwords must be entered again.

The container needs network access to the IBM i on the host server ports
jt400 uses: 449 (port mapper) and 8470 to 8476 (central, database on 8471
for JDBC, network print, remote command and sign-on). Set
`SPOOLDOC_ALLOWED_HOSTS` to limit which hosts users can connect to.

### Model

The chat needs a model on the server. Set it in `apps/web/.env.local` and
restart:

- `ANTHROPIC_API_KEY`, and optionally `SPOOLDOC_MODEL` (default
  `claude-sonnet-5-5`).
- Or an OpenAI-compatible endpoint, such as a local model server:
  `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_MODEL` and, when it
  needs one, `OPENAI_COMPATIBLE_API_KEY`.

Without either, the job builder works as before and the AI assistant says
how to set one up. Keys stay on the server; no request can supply one.

Masking is on by default (`SPOOLDOC_MASK=true`): digits in values become 9
and letters X or x before page text goes to the model, while labels that
repeat across pages, positions and lengths stay as printed. The chat
panel shows "Values masked", or "Values sent in clear" when
`SPOOLDOC_MASK=false`.

## Trust

What the model receives:

- The page text of the job's preview spooled file: the first pages in the
  instructions, any other page on request. Values are masked by default.
- The spooled file metadata: name, queue, user data, page size, code page.
- The job's current definition and template.
- Tool results (extracted fields, rendered text), masked the same way.

What it never receives: IBM i credentials, the login session, the IBM i
connection or any other spooled file. No tool reaches the IBM i: the four
tools read the preview file and write the definition and template of the
job's draft. What the model writes and the job builder itself use the real
values.

The database holds captured spool data and the delivered PDFs in clear
text. Protect it like the spooled files themselves: access, backups and
the volume included.

PDFs render locally in headless Chromium; the page may not make any
network request, so a template cannot fetch or send anything.

The app needs a sign-in (Better Auth, email and password). The first
account can be created on the login page; after that, sign-up is closed.
IBM i passwords of saved servers are stored encrypted with AES-256-GCM
under `SPOOLDOC_SECRET_KEY`, decrypted only to sign on (by the pages and by
the queue watcher, which runs without anyone signed in), kept in the
server's connection cache, and never logged or returned by the API. The
model key is server configuration only: no request can supply or read one.

After a run delivered every document, the job's finish step holds the
spooled file by default (or moves or deletes it, or leaves it as it is).
Previews only read spooled files. Real-time watching needs a data queue on
the output queue; Spooldoc creates and attaches one only when asked (Set up
real-time), and never changes a queue that already sends to another data
queue.

## Layout

- `packages/core`: pure TypeScript core, no UI and no IBM i dependency:
  samples, *SCS parser, definitions, extraction, templates, PDF, masking,
  workspace. Fixtures in `packages/core/fixtures` are captured demo
  spooled files with their definitions, templates and expected JSON.
- `packages/ibmi`: connect to an IBM i, list output queues and spooled
  files, capture spooled files as samples, hold, move and delete them,
  read data queue entries and run CL commands. The root export holds the
  `Connection` interface, `captureSample` and the pure SQL helpers and
  does not load Java; `@spooldoc/ibmi/jt400` is the jt400 implementation
  (one JVM per process, cached connections). `scripts/capture.ts` is the
  capture command; captured samples are scrubbed before they are written.
- `apps/web`: the web app (Next.js). `lib/server` holds config, the
  database (`db/`, Drizzle schema and migrations in `drizzle/`), sign-in,
  the IBM i connection (`ibmi.ts` is the only module that loads the jt400
  driver), rendering, the job runner, destinations and the queue watcher
  (started from `instrumentation.ts`); route handlers are under `app/api`,
  the job builder under `components/jobs`.
- `Dockerfile` and `compose.yaml`: the container image and an example
  service for it.
- `demo-spool`: CL and RPG sources that create output queues and
  print invented documents on any IBM i, for demos and end-to-end tests.
  Written for a PUB400 account.
- `workspace/`: where the capture command line writes samples. Ignored by
  git except its README. The web app keeps everything in the database.

## Rules

- Public repository. No customer, site or ERP specific names anywhere:
  libraries, tables, columns, users, hosts, document numbers. Use
  `MYLIB`, `ORDERS`, `CUSTOMERS`, `ibmi.example.com` and invented values.
- `local/` is ignored and holds credentials, notes and anything real.
- MIT licence, like mcp-server-db2i.
