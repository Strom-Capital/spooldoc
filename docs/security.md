---
title: "Security"
description: "What the model receives, what Spooldoc stores and how, what it does on the IBM i, and what it never does."
---

This page is for whoever has to approve Spooldoc. To report a security
problem, see [SECURITY.md](../SECURITY.md): open a private advisory on
GitHub, not a public issue.

## What the model receives

The agent is the only part of Spooldoc that talks to anything but
your IBM i and your database. What it sends to the model provider:

- The page text of the job's preview sample: the first pages in the
  instructions, any other page on request. Values go as printed unless
  masking is on (Settings, Agent): then digits become 9 and letters X
  or x, while labels, positions and lengths stay as printed. See
  [Masking](agent.md#masking).
- The sample's metadata: spooled file name, queue, user data, page size,
  code page.
- The job's current definition and template, and the names of the
  uploaded assets.
- Tool results: the extraction report and the rendered text, masked the
  same way when masking is on.

What it never receives: IBM i credentials, the login session, the IBM i
connection, any other spooled file, or the job log. No tool reaches the
IBM i: the four tools read the preview sample and write the definition and
template of the job's draft. What the model writes, and the job builder
itself, use the real values. A hosted provider processes what it receives
under its own terms; a local model keeps it on your network, and its base
URL is called by the server, so only enter one you trust.

## What is stored, and how

Everything is in Postgres:

- **IBM i passwords** of saved servers are encrypted with AES-256-GCM
  under `SPOOLDOC_SECRET_KEY`, decrypted only to sign on (by the pages and
  by the queue watcher, which runs without anyone signed in), kept in the
  server's connection cache, and never logged or returned by the API.
- **Model keys** are stored the same way and decrypted only to call the
  provider. Any signed-in user can set or replace a key, but no request
  can read one back, and keys are removed from error messages.
- **Captured spooled files** and **delivered files** are in clear text,
  for previews, runs and downloads. Protect the database like the spooled
  files themselves: access, backups and the volume included. Retention
  deletes them with the runs.

## Sign-in

The app needs a sign-in (Better Auth, email and password). Anyone may
create the first account on the login page; after that sign-up is closed,
and one sign-up at a time is accepted so two first accounts cannot race.
A later sign-up is refused with a message saying the instance has one
account and to sign in with it.
There is one role: every signed-in user can do everything. More users and
roles are on the roadmap. Every write is origin-checked against `APP_URL`
and the request's own host, and the session cookie is secure under https.

## On the IBM i

Spooldoc signs on with the profile of each saved server and uses only
these operations: list output queues and spooled files (SQL services),
read a spooled file, `HLDSPLF`, move and delete a spooled file, read a
data queue, and, when asked from the trigger step, `CRTDTAQ` and
`CHGOUTQ DTAQ(...)`. It runs no SQL against application tables and
installs nothing on the system.

Previews only read. After a run delivered every document, the finish step
holds the spooled file by default, or moves, deletes or leaves it as the
job says. Spooldoc creates and attaches a data queue only when asked, and
never changes an output queue that already sends to a data queue it does
not read.

Set `SPOOLDOC_ALLOWED_HOSTS` to limit which systems users can add.

## Carbone

Templates are not run in the Spooldoc process: Carbone renders them, and
Carbone's tags only read the data Spooldoc sends with each document.
Logos, images and fonts come from uploaded assets, written into the
template as data URIs, and the bytes decide an asset's type, not its file
name.

Spooldoc signs each request to an on-prem Carbone server with a token that
lasts five minutes (ES512, audience `carbone-ee`). The private key is
encrypted with `SPOOLDOC_SECRET_KEY`; only the public key leaves the
server, into Carbone's settings. In the Compose file Carbone's port is not
published, so only the Spooldoc container reaches it.

With Carbone Cloud, the template and the data of each document go to
Carbone's servers over https to be rendered. Masking does not apply to
rendering: Carbone gets the values as extracted, since they go into the
documents. Choose Cloud only when that is acceptable for your documents.
The Cloud API key is stored encrypted and never sent to the browser.

Carbone's startup log names the licensee of an Enterprise licence.
Spooldoc never reads or copies that log.

## Checklist

- Generate `BETTER_AUTH_SECRET` and `SPOOLDOC_SECRET_KEY` once, keep them
  with the backups, and pass them as secrets, not on the command line.
- Put the app behind https and set `APP_URL`.
- Reach the IBM i over a private network; do not open the host server
  ports to the internet. Set `SPOOLDOC_ALLOWED_HOSTS`.
- Give the IBM i profile only the queues it needs.
- Decide where the values may go: a local model keeps them on your
  network; with a hosted provider, turn on masking unless its terms are
  acceptable for your documents.
- Set the retention to what the documents need, no longer.
