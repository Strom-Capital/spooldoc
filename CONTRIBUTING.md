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

CI runs the same four commands. Tests need no IBM i: the web app tests use
a fake connection over the core fixtures. The Chromium PDF test runs only
when `SPOOLDOC_CHROMIUM_PATH` is set.

## Commits and pull requests

- Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`,
  with a scope when it helps (`feat(web): ...`).
- Branch from `main`; keep a pull request to one change.

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
