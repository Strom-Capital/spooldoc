---
title: "Contributing"
description: "Set up a development environment, run the tests, and know the conventions before opening a pull request."
---

Thanks for helping. Spooldoc is a pnpm workspace in TypeScript: three
packages, the app and the website. The short rules are in [CONTRIBUTING.md](../CONTRIBUTING.md)
at the repository root; this page has the setup and the layout.

## Prerequisites

- Node 22 (`.nvmrc`; `nvm use`, fnm and mise read it) and pnpm, the
  version in `package.json` `packageManager`, which `corepack enable`
  picks up.
- A JDK 17: `node-jt400` builds its native `java` addon at install time.
- Docker for the development database, or a Postgres of your own.
- Optional: Docker for a local Carbone server, to render documents in the
  app: `docker run -d -p 4000:4000 carbone/carbone-ee:full-5.15.5-fonts`,
  then set `http://localhost:4000` under Settings, Rendering. Without
  `CARBONE_AUTHENTICATION` it takes requests without a token.
- Optional: an IBM i to try things on. A free [PUB400](https://pub400.com)
  account is enough; [demo-spool](../demo-spool/README.md) prints the demo
  documents there.

## Setup

```sh
git clone https://github.com/Strom-Capital/spooldoc.git && cd spooldoc
pnpm install
docker compose up -d db                        # Postgres on localhost:5433
cp apps/web/.env.example apps/web/.env.local   # then set DATABASE_URL, BETTER_AUTH_SECRET and SPOOLDOC_SECRET_KEY
pnpm dev
```

`pnpm dev` runs core and ibmi in watch mode and Next.js on port 3000, or
the next free port when 3000 is busy. The server applies migrations when
it starts.

## Scripts

| Command | What it does |
|---------|--------------|
| `pnpm -r build` | Build every package. |
| `pnpm -r typecheck` | Type-check every package. |
| `pnpm -r lint` | ESLint, no warnings allowed. |
| `pnpm -r test` | Vitest in every package. |
| `pnpm --filter @spooldoc/core demo` | The demo spooled files as JSON. |
| `pnpm --filter @spooldoc/ibmi capture -- --list` | Queues and spooled files of the IBM i in `local/.env`. |
| `pnpm --filter @spooldoc/ibmi capture -- EMAIL SPDINVOICE` | Capture the newest `SPDINVOICE` on `EMAIL` into `workspace/samples`, scrubbed. |
| `pnpm --filter @spooldoc/web db:generate` | Write a migration from the schema. |
| `pnpm --filter @spooldoc/web db:migrate` | Apply the migrations by hand. |

CI runs build, typecheck, lint and test on every push and pull request.
To get a CodeRabbit review of a pull request, comment
`@coderabbitai review` on it. It reviews against `AGENTS.md` and the
[principles](principles.md); its settings are in `.coderabbit.yaml`.

## Tests

Tests need no IBM i and no database: the core tests run against the
fixtures in `packages/core/fixtures`, captures of the demo documents with
their definitions, templates and expected JSON; the web app tests use a
fake connection over those fixtures and an in-process Postgres (PGlite)
per test file. To run them against a real Postgres, start one
(`docker compose up -d db`) and set
`TEST_DATABASE_URL=postgres://spooldoc:spooldoc@localhost:5433/spooldoc`;
each test file gets a throwaway database. Unit tests use a
stand-in for Carbone's HTTP API. The tests against a real Carbone server
run only when `SPOOLDOC_CARBONE_URL` is set, such as
`SPOOLDOC_CARBONE_URL=http://localhost:4000 pnpm --filter @spooldoc/core test`.

Add a fixture by printing the document with demo-spool, capturing it with
the capture command (which scrubs the job user and number) and writing
its definition, template and expected JSON next to the sample.

## Layout

| Path | What it holds |
|------|---------------|
| `packages/core` | Pure TypeScript, no UI and no IBM i dependency: samples, the *SCS parser, definitions, extraction, templates, PDF, masking, workspace. |
| `packages/docs` | Reads the guides in `docs/` for the app's `/docs` and the website's: the sidebar from `docs/README.md`, front matter, headings, links and search sections. No Next.js or Astro code. |
| `packages/ibmi` | The IBM i connection through jt400: queues, spooled files, hold, move, delete, data queues, CL commands. The root export does not load Java; `@spooldoc/ibmi/jt400` does. |
| `apps/web` | The Next.js app. `lib/server` holds config, the database (`db/`, with the Drizzle schema and migrations in `drizzle/`), sign-in, the IBM i connection (`ibmi.ts` is the only module that loads jt400), the Carbone connection (`rendering.ts`) and rendering, the job runner, destinations and the queue watcher, started from `instrumentation.ts`. Route handlers are under `app/api`, pages under `components/pages`, the job builder under `components/jobs` and `components/workbench`. |
| `apps/site` | The website at [spooldoc.com](https://spooldoc.com), in Astro: the home page, the features, the guides from `docs/`, the blog and the changelog. Not part of the Docker image or the release. See [Website](#website). |
| `demo-spool` | CL and RPG sources that create output queues and print invented documents on any IBM i. |
| `Dockerfile`, `compose.yaml` | The container image and an example service for it. |
| `workspace/` | Where the capture command writes samples. Ignored by git except its README. |
| `local/` | Ignored. Credentials, notes and anything real. |

Schema changes go in `apps/web/lib/server/db/schema.ts`; then run
`db:generate` and commit the new migration.

### Adding a destination

A destination is a `kind` and a `deliver` call in
`apps/web/lib/server/destinations`. `deliver` receives the run id, the
files, and the open connection and host of the job's server, and returns
the note the Deliver step shows, such as "Wrote 6 files to
/home/docs/out on ibmi.example.com". It runs outside any database
transaction, since it may wait on another system. To keep the files in
Spooldoc as well, call `storeRunFiles`, which saves them in one
transaction of its own. Throw a `StepError` with a message that says what
to do, and the system's own text as its detail.

Then:

- Add the kind to the check on `destinations.kind` in
  `lib/server/db/schema.ts` and generate the migration.
- Put the settings' schema in `lib/destination-config.ts`, which the API
  and the Destinations page share, and register the kind in the `KINDS`
  map.
- Add its fields to the destination dialog and its text to
  `destinationText`.
- A call that changes the IBM i goes on the `Connection` interface, in
  both fake connections, and in the wrappers in `jt400/jvm.ts` (as a
  change, not retried) and `lib/server/ibmi.ts`.

### Writing the docs

The guides in `docs/` are also the docs in the app: it serves them at
`/docs`, built with the app so they match the version that runs. The
groups and the order come from [docs/README.md](README.md): a new page
goes into one of its tables, and starts with a `title` and a
`description` header in place of a `#` heading. Link to another guide by
its file name, such as `[Versions](jobs.md#versions)`. The app turns
those links into its own, and links outside `docs/` into links to the
file on GitHub at that version. The web app's tests check that every
page is listed once and that every link and anchor between the guides
lands. A link from the app into the docs uses `DocsLink`, which opens
the page in a new tab.

## Website

The website is `apps/site`, a static Astro site. It reads the guides in
`docs/` with `packages/docs` when it is built, so the website and the app
show the same files. Run it locally with:

```sh
pnpm --filter @spooldoc/docs build   # once, and after changing packages/docs
pnpm --filter @spooldoc/site dev     # http://localhost:4321
```

To build it as it is deployed and check every link in it:

```sh
pnpm --filter @spooldoc/site... build
pnpm --filter @spooldoc/site check:links
pnpm --filter @spooldoc/site preview
```

Blog posts are Markdown files in `apps/site/src/content/blog`, named
`YYYY-MM-DD-slug.md`, with a `title`, `description`, `date`, `tags` and
`draft` header. A post about a release has the tag `release` and the slug
`spooldoc-X-Y-Z`: the changelog links to it, and the post ends with a
link to its version in the changelog. Screenshots
and diagrams on the site, in the guides and in posts open full size when
clicked, if they have alt text; an image with an empty alt or inside a
link is left as it is. The share
image, `public/og.png`, is made by `pnpm --filter @spooldoc/site og`.

The changelog page, `/changelog`, is built from `CHANGELOG.md` at the
repository root. The site deploys to GitHub Pages when a change to it, to
`docs/`, to `packages/docs` or to `CHANGELOG.md` merges to `main`
(`.github/workflows/pages.yml`).

## Conventions

- Check the change against the [principles](principles.md). When it
  needs one to bend, say so in the pull request and change that page in
  the same pull request.
- Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`,
  with a scope when it helps (`feat(web): ...`). Pull requests are squash
  merged, so the pull request title is the commit message on `main` and
  must follow the same format.
- Branch from `main`; keep a pull request to one change.
- Plain English in the UI and the docs: short sentences, no jargon where
  a plain word does.

## No real names

This repository is public. Never commit customer, site or ERP specific
names: libraries, tables, columns, user profiles, hosts, job names or
document numbers. Use `MYLIB`, `ORDERS`, `CUSTOMERS`, `ibmi.example.com`
and invented values. That goes for issues, pull request text and
screenshots too. The fixtures are captures of invented demo documents,
scrubbed by the capture command before they were written; add new ones
the same way, and check them before you commit.

## Releases

Release Please keeps a release pull request open on `main`. It collects
the `feat:` and `fix:` commits since the last release into `CHANGELOG.md`
and bumps the version in every `package.json`. Merging it tags `vX.Y.Z`
and publishes the GitHub release. Before 1.0.0 a `feat:` bumps the minor
version and a breaking change (`feat!:`) does too; a `fix:` bumps the
patch.
