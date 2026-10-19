# Contributing

Thanks for helping. The development setup, the tests and the layout are in
[docs/contributing.md](docs/contributing.md). The rules that every pull
request must follow:

- **The principles.** Check the change against
  [docs/principles.md](docs/principles.md). Coding agents read it
  through [AGENTS.md](AGENTS.md).
- **Conventional Commits.** `feat:`, `fix:`, `docs:`, `chore:`, `ci:`,
  `test:`, with a scope when it helps (`feat(web): ...`). Pull requests
  are squash merged, so the pull request title is the commit message on
  `main` and must follow the same format.
- **One change per pull request**, branched from `main`.
- **CI must pass**: `pnpm -r build`, `pnpm -r typecheck`, `pnpm -r lint`
  and `pnpm -r test`.
- **No real names.** This repository is public. Never commit customer,
  site or ERP specific names: libraries, tables, columns, user profiles,
  hosts, job names or document numbers. Use `MYLIB`, `ORDERS`,
  `CUSTOMERS`, `ibmi.example.com` and invented values, in issues, pull
  request text and screenshots too.
