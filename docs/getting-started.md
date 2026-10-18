---
title: "Getting started"
description: "Install Spooldoc, create the first account, add an IBM i and build the first job."
---

## What you need

- An IBM i 7.4 or later, a user profile that can read the output queues you
  care about, and network access from the Spooldoc host to the host server
  ports jt400 uses: 449 and 8470 to 8476. See [Network](deployment.md#network).
- Docker, or Node 22 with a JDK 17 and Postgres to run from source.
- Optional: an API key for a model provider, so the assistant can write
  definitions and templates. Spooldoc works without one.

No demo queues yet? [demo-spool](../demo-spool/README.md) creates three
output queues and prints invented invoices, pick lists and reports on any
IBM i, including a free PUB400 account.

## Install

### With Docker Compose

```sh
git clone https://github.com/Strom-Capital/spooldoc.git && cd spooldoc
printf 'BETTER_AUTH_SECRET=%s\nSPOOLDOC_SECRET_KEY=%s\n' "$(openssl rand -base64 32)" "$(openssl rand -base64 32)" > .env
docker compose up --build -d
```

This builds the image (web app, Java runtime and Chromium) and starts it
with a Postgres database. Keep the `.env` file: `SPOOLDOC_SECRET_KEY`
encrypts the saved IBM i passwords and model keys, and with another key
they must be entered again. See [Deployment](deployment.md) for the
variables, a prebuilt database, backups and upgrades.

### From source

```sh
pnpm install
docker compose up -d db                        # Postgres on localhost:5433
cp apps/web/.env.example apps/web/.env.local   # then set DATABASE_URL, BETTER_AUTH_SECRET and SPOOLDOC_SECRET_KEY
pnpm dev
```

`pnpm dev` builds the packages in watch mode and starts the web app on
port 3000, or on the next free port when 3000 is taken. PDF export needs
`SPOOLDOC_CHROMIUM_PATH` pointing at a Chrome or Chromium executable. See
[Contributing](contributing.md) for the tools and the tests.

## First run

1. **Create the first account.** Open http://localhost:3000. The login
   page offers sign-up until the first account exists; after that sign-up
   is closed.
2. **Add a server.** On Servers, enter a name, the host, a user profile and
   its password. Optionally list the libraries to show queues from. The
   password is stored encrypted. See [Servers](servers.md).
3. **Open the queues.** On Queues, pick the server. Search or sort, hide
   the queues you do not need, and open one to see its spooled files and
   their pages. See [Queues](queues.md).
4. **Start a job.** From a queue, choose New job. The job builder shows the
   pipeline: source, trigger, extract, render, destination, finish. Pick a
   spooled file on the queue as the preview sample.
5. **Let the assistant propose.** With a model set under Settings, ask the
   assistant for a definition. It reads the sample pages, writes a YAML
   definition, reads the extraction report and fixes missing fields, then
   writes a template and renders it. The page view, the JSON and the
   preview update as it works. Without a model, write the definition by
   hand; the starter template renders every field and table. See
   [Definitions](definitions.md) and [Templates](templates.md).
6. **Pick a destination.** Spooldoc download keeps the files in Spooldoc.
   See [Destinations](destinations.md).
7. **Save a version and run it.** Runs use the active version. Run now
   takes one spooled file from the queue; Watch the queue runs every new
   one, in real time through a data queue or by polling. See [Jobs](jobs.md).
8. **Check the job log.** Every run shows its steps, errors and the
   delivered files. See [Job log](job-log.md).

## Next steps

- [Configuration](configuration.md): masking, the default code page, allowed hosts.
- [Security](security.md): what the model receives, what the database holds.
- [FAQ](faq.md): the questions that come up first.
