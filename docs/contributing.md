---
title: "Contributing"
description: "Set up a development environment, run the tests, and know the conventions before opening a pull request."
---

Thanks for helping. Spooldoc is a pnpm workspace in TypeScript: two
packages and one app. The short rules are in [CONTRIBUTING.md](../CONTRIBUTING.md)
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
| `packages/ibmi` | The IBM i connection through jt400: queues, spooled files, hold, move, delete, data queues, CL commands. The root export does not load Java; `@spooldoc/ibmi/jt400` does. |
| `apps/web` | The Next.js app. `lib/server` holds config, the database (`db/`, with the Drizzle schema and migrations in `drizzle/`), sign-in, the IBM i connection (`ibmi.ts` is the only module that loads jt400), the Carbone connection (`rendering.ts`) and rendering, the job runner, destinations and the queue watcher, started from `instrumentation.ts`. Route handlers are under `app/api`, pages under `components/pages`, the job builder under `components/jobs` and `components/workbench`. |
| `demo-spool` | CL and RPG sources that create output queues and print invented documents on any IBM i. |
| `Dockerfile`, `compose.yaml` | The container image and an example service for it. |
| `workspace/` | Where the capture command writes samples. Ignored by git except its README. |
| `local/` | Ignored. Credentials, notes and anything real. |

Schema changes go in `apps/web/lib/server/db/schema.ts`; then run
`db:generate` and commit the new migration.

### Adding a destination

A destination is a `kind` and a `deliver` call in
`apps/web/lib/server/destinations`: it receives the run id, the files and
the run's transaction, and stores or sends them. Register it in the kinds
map and add its settings to the Destinations page.

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
