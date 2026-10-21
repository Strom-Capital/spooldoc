---
title: "Configuration"
description: "The environment variables the server reads, and the settings that live in the app."
---

Spooldoc reads a few settings from the environment when it starts, and
keeps the rest in the database under Settings, where they change without a
restart. `apps/web/.env.example` lists the variables with comments; copy it
to `apps/web/.env.local` for development, or put the same variables in the
`.env` file next to `compose.yaml` for Docker.

## Environment variables

| Variable | Required | Default | What it is |
|----------|----------|---------|------------|
| `DATABASE_URL` | Yes | | The Postgres connection string. `docker compose up -d db` starts one at `postgres://spooldoc:spooldoc@localhost:5433/spooldoc`. |
| `BETTER_AUTH_SECRET` | Yes | | Signs the login sessions. At least 32 characters; `openssl rand -base64 32` makes one. |
| `SPOOLDOC_SECRET_KEY` | Yes | | Encrypts the IBM i passwords of saved servers, the model keys, the Carbone Cloud key and Spooldoc's private key for Carbone (AES-256-GCM). 32 bytes in base64; `openssl rand -base64 32` makes one. Keep it: with another key the saved passwords cannot be read and must be entered again. |
| `PORT` | No | `3000` | The port the server listens on. |
| `APP_URL` | No | | The address users reach the app at, such as `https://spooldoc.example.com`. Origin checks accept it and the request's own host, and cookies are marked secure when it is https. Set it behind a reverse proxy. |
| `SPOOLDOC_WATCHER` | No | `on` | Run the queue watcher in this process. Turn it off on every instance but one; the watcher also takes database locks, so two instances never read the same data queue or run the same job at once. |
| `SPOOLDOC_MIGRATE` | No | `on` | Apply the database migrations when the server starts. With it off, run `pnpm --filter @spooldoc/web db:migrate` yourself. |
| `SPOOLDOC_DEFAULT_CCSID` | No | | The code page for spooled files that have no CHRID when the job CCSID is not supported, for example `273` or `37`. Also the CCSID of queue descriptions when the system has no default CCSID. |
| `SPOOLDOC_ALLOWED_HOSTS` | No | | Comma-separated hosts servers may use. When set, the server form shows a list instead of a free text field. |
| `SPOOLDOC_LOG_LEVEL` | No | `info` | How much the server logs: `off`, `error`, `warn`, `info` or `debug`. See [Server log](#server-log). |

The server refuses to start with a missing or malformed required variable
and says which one. The agent's model, its key and effort, and the Carbone
connection are not environment variables: they are set in the app under
Settings. So is masking, which was `SPOOLDOC_MASK` before; the server log
says so when that variable is still set. See [Carbone](carbone.md) and
[Masking](agent.md#masking).

The Compose file passes two more variables from `.env` to the `carbone`
service:

| Variable | What it is |
|----------|------------|
| `CARBONE_AUTHENTICATION_PUBLIC_KEY` | Spooldoc's public key, as Settings shows it under Rendering: one line, with `\n` for each newline. |
| `CARBONE_LICENSE` | A Carbone Enterprise license. Without it Carbone runs as the Community Edition. |

## Server log

The server writes its log to stdout, one JSON object per line, so
`docker compose logs` or any log collector can read it. Each line has
`time`, `level` and `msg`, and fields such as `serverId`, `jobId`, `runId`
and `error`. Passwords and keys are taken out of error text before it is
logged.

```json
{"time":"2026-10-19T08:12:03.512Z","level":"warn","msg":"Real-time watching failed; the queues are polled meanwhile","serverId":"6f1c...","dataQueue":"SPOOLDOC/SPOOLDOC","error":"Connection reset","retryInSeconds":5}
```

At the default level, `info`, the log has what fails before a run exists:
a server the watcher cannot reach, a queue list it cannot read, real-time
watching that stopped and started again, a job whose active version cannot
be read, runs a stopped server cut off, a failed cleanup, agent chats
that fail, and the warnings and errors of the sign-in library. A problem
that lasts is logged once, and again when it is gone. `warn` keeps only
the problems.

## Settings in the app

Under Settings, for the whole app:

| Setting | Default | What it is |
|---------|---------|------------|
| Poll interval | 30 seconds | How often the watcher lists a polled queue. |
| Safety check | 5 minutes | How often a real-time queue is listed anyway, in case a data queue entry was missed. |
| Keep runs for | 90 days | How long runs are kept, 1 to 3650 days. See [Retention](job-log.md#retention). |
| Agent | None | The provider, key, model and effort of the agent. See [Agent](agent.md#choosing-a-model). The section also shows the agent's [usage](agent.md#usage) this month and last month. |
| Mail server | None | The SMTP server email destinations send through. See [Mail server](#mail-server). |

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/settings-dark.png">
    <img src="assets/settings-light.png" alt="The Settings page shows Rendering with Carbone connected, its URL and Spooldoc's public key, the Agent with its provider, model, effort and usage, and the Watching and Retention settings." width="900">
  </picture>
</p>

## Mail server

[Email destinations](destinations.md#email) send through one SMTP server,
set under Settings, **Mail server**, for the whole app. It can be your
own mail server or a sending service.

| Setting | What it is |
|---------|------------|
| Host | The SMTP server, such as `smtp.example.com`. The Spooldoc server connects to it, so it must be reachable from there. Empty turns email off. |
| Security | STARTTLS (usually port 587), TLS (usually port 465), or None, for a relay on your own network. |
| Port | Follows Security unless you change it. |
| User name and password | Optional: a server that takes email without a sign-in needs neither. The password is stored encrypted and never shown again. Some services want an app password here. |
| From address and From name | Every email comes from this address. Use one the server lets the user send from. |

Save, then **Send test email** sends one to your own address with the
saved settings and says what happened: "Test email sent to
you@example.com", or what to check, such as "The mail server refused the
sign-in. Check the user name and password in Settings, under Mail server,
or use an app password." The server's own text is under Details.

## Per server and per job

The libraries a server lists queues from are on the server; see
[Servers](servers.md). The filters, trigger, formats, destination and
finish action are on each job; see [Jobs](jobs.md).
