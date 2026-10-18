---
title: "Deployment"
description: "Run Spooldoc with Docker or Docker Compose: the image, ports, network to the IBM i, secrets, backups and upgrades."
---

The container image holds the web app, a Java runtime for jt400 and
Chromium for PDFs, and runs on amd64 and arm64. It needs a Postgres
database and three environment variables.

Every release publishes the image to `ghcr.io/strom-capital/spooldoc`,
tagged with its version (`0.1.0`), its minor line (`0.1`) and `latest`.
Pin a version in production so an upgrade happens when you choose it.

## Docker Compose

`compose.yaml` at the repository root starts the published image and a
Postgres 18 database with a named volume:

```sh
printf 'BETTER_AUTH_SECRET=%s\nSPOOLDOC_SECRET_KEY=%s\n' "$(openssl rand -base64 32)" "$(openssl rand -base64 32)" > .env
docker compose up -d
```

Open http://localhost:3000. The `.env` file next to `compose.yaml` holds
the settings of `apps/web/.env.example`; `DATABASE_URL` is set by the
Compose file. `SPOOLDOC_VERSION` in `.env` pins the image version, `latest`
otherwise. `docker compose up --build -d` builds the image from the
checkout instead. Set `POSTGRES_PASSWORD` (URL-safe characters) for anything
but a local trial. The database port is published on this machine only, on
5433, so a local Postgres on 5432 is not in the way.

## Docker

With your own database:

```sh
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://... \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -e SPOOLDOC_SECRET_KEY="$(openssl rand -base64 32)" \
  ghcr.io/strom-capital/spooldoc:<version>
```

To build the image from source, run `docker build -t spooldoc .` in the
repository and run `spooldoc` in place of the published name.

Passing secrets with `-e` shows them in `docker inspect` and the shell
history; use `--env-file` or your orchestrator's secrets. The image runs as
the `node` user, listens on port 3000 (`PORT` changes it) and applies the
database migrations when it starts.

## Ports

| Port | What it is |
|------|------------|
| 3000 | The web app. Publish it, or put a reverse proxy in front of it. `PORT` changes it in the container; from source, `next dev` takes the next free port when 3000 is busy. |
| 5433 on the host | Postgres, in the Compose setup, bound to 127.0.0.1 only. |

## Behind a reverse proxy

Set `APP_URL` to the address users type, such as
`https://spooldoc.example.com`. Origin checks on every write accept that
address and the request's own host, and the session cookie is marked
secure when the address is https. The proxy should pass the `Host` header
through unchanged.

## Network

The container needs a route to the IBM i on the host server ports jt400
uses: 449 (port mapper) and 8470 to 8476 (central, database on 8471 for
JDBC, network print, remote command and sign-on). When Spooldoc runs in
the cloud and the IBM i is on premises, connect them over a private link
such as a site-to-site VPN; do not open the host server ports to the
internet. Set `SPOOLDOC_ALLOWED_HOSTS` so users can only add the systems
you intend.

The assistant calls the model provider over HTTPS, or a local model at the
base URL you enter. Nothing else leaves the host.

## More than one instance

Every instance shares the database. Set `SPOOLDOC_WATCHER=off` on all but
one, so one process reads the data queues and polls; the watcher also
takes database locks, so a second watcher would not double-run a job, but
it would double the IBM i traffic.

## Backups

Everything Spooldoc keeps is in the database: servers, jobs and their
versions, captured spooled files, runs and their files, assets and
settings. One `pg_dump` is the whole backup. Keep `SPOOLDOC_SECRET_KEY`
with it: a restore under another key cannot read the saved IBM i
passwords and model keys, and they must be entered again. Captured
spooled files and delivered files are in the database in clear text, so
protect the database and its backups as you protect the spooled files
themselves.

## Upgrades

Pull or build the new image and start it; the server applies the
migrations. With Compose, set the new `SPOOLDOC_VERSION` (or leave it at
`latest`) and run `docker compose pull && docker compose up -d`. Take a `pg_dump` first. What changed in each release is on
the GitHub releases page.

## Sizing

A run reads one spooled file, extracts and renders in the Node process,
and spends most of its time in Chromium for PDFs, so memory goes with the
size of the reports. `UV_THREADPOOL_SIZE` is set to 16 in the image because
jt400 calls block a thread pool thread.
