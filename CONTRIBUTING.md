# Contributing

Thanks for helping. Spooldoc is a pnpm workspace in TypeScript.

## Setup

- Node 22 (`.nvmrc`) and pnpm (the version in `package.json`
  `packageManager`; `corepack enable` picks it up).
- A JDK 17: `node-jt400` builds the native `java` addon at install time.
- Optional: Chrome or Chromium for PDFs (`SPOOLDOC_CHROMIUM_PATH`).

```sh
pnpm install
pnpm -r build
pnpm -r typecheck
pnpm -r lint
pnpm -r test
```

CI runs the same four commands. Tests need no IBM i and no database: the
web app tests use a fake connection over the core fixtures and an
in-process Postgres (PGlite) per test file. To run them against a real
Postgres, start one (`docker compose up -d db`) and set
`TEST_DATABASE_URL=postgres://spooldoc:spooldoc@localhost:5433/spooldoc`;
each test file gets a throwaway database. The Chromium PDF test runs only
when `SPOOLDOC_CHROMIUM_PATH` is set.

Schema changes go in `apps/web/lib/server/db/schema.ts`; then run
`pnpm --filter @spooldoc/web db:generate` and commit the new migration in
`apps/web/drizzle/`.

## Commits and pull requests

- Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`,
  with a scope when it helps (`feat(web): ...`).
- Branch from `main`; keep a pull request to one change.
- Pull requests are squash merged, so the pull request title is the commit
  message on `main` and must follow the same format.

## Releases

Release Please keeps a release pull request open on `main`. It collects the
`feat:` and `fix:` commits since the last release into `CHANGELOG.md` and
bumps the version in every `package.json`. Merging it tags `vX.Y.Z` and
publishes the GitHub release. Before 1.0.0 a `feat:` bumps the minor version
and a breaking change (`feat!:`) does too; a `fix:` bumps the patch.

## No real names

This repository is public. Never commit customer, site or ERP specific
names: libraries, tables, columns, user profiles, hosts, job names or
document numbers. Use `MYLIB`, `ORDERS`, `CUSTOMERS`, `ibmi.example.com`
and invented values. That goes for issues, pull request text and
screenshots too.

The fixtures in `packages/core/fixtures` are captures of invented demo
documents (see `demo-spool/`), scrubbed by the capture command before they
were written. Add new fixtures the same way, and check them before you
commit.
