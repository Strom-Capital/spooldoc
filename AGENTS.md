# Spooldoc for coding agents

Spooldoc turns IBM i spooled files into documents: it watches output
queues, reads each spooled file into JSON with a YAML definition, renders
it with an HTML template to PDF or HTML, and delivers the files. A pnpm
workspace in TypeScript: `packages/core`, `packages/ibmi` and the Next.js
app in `apps/web`. The layout is in
[docs/contributing.md](docs/contributing.md#layout).

## Before you change anything

Read [docs/principles.md](docs/principles.md). Every change is checked
against it. If a change needs a principle to bend, say so in the pull
request and change the page in the same pull request.

The short version:

- Nothing changes on the IBM i unless the user asks.
- Definitions read, templates lay out. Templates never see lines and
  columns.
- Every spooled file becomes a document, or the user can see why not. No
  error is caught and dropped; no list is cut off silently.
- IBM i errors say what went wrong and what to do next.
- Show only what works. No "coming later" in the app.
- One component and one word for each thing. Reuse before adding.
- A feature is done when its empty, loading and error states, docs and
  tests are done.

## Commands

```sh
pnpm -r build
pnpm -r typecheck
pnpm -r lint     # no warnings allowed
pnpm -r test     # no IBM i or database needed
```

All four must pass. Schema changes go in
`apps/web/lib/server/db/schema.ts`, then
`pnpm --filter @spooldoc/web db:generate`, and the migration is
committed.

## Website

- The website is `apps/site` (Astro). It deploys to GitHub Pages at
  [spooldoc.com](https://spooldoc.com) when a change merges to `main`.
- Brand colors change together in `apps/web/app/globals.css` and
  `apps/site/src/styles/tokens.css`.
- The features page (`apps/site/src/lib/features.ts`) changes with the
  features.
- The site shows only what works, like the app.
- Site commits use `docs(site): ...`.

## Rules

- **No real names.** The repository is public. Use `MYLIB`, `MYOUTQ`,
  `ibmi.example.com` and invented values in code, fixtures, docs, commit
  messages, issues and pull requests. Never read from or copy out of
  `local/`.
- **Conventional Commits**, with a scope when it helps
  (`fix(web): ...`). Pull requests are squash merged, so the title is the
  commit message on `main`.
- **One change per pull request**, branched from `main`.
- **Docs change with behaviour.** A change users can see updates the page
  under `docs/` that describes it.
- **Writing:** short sentences, plain words, sentence case. No middle dot
  (`·`) as a separator.
