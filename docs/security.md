---
title: "Security"
description: "What the model receives, what Spooldoc stores and how, what it does on the IBM i, and what it never does."
---

This page is for whoever has to approve Spooldoc. To report a security
problem, see [SECURITY.md](../SECURITY.md): open a private advisory on
GitHub, not a public issue.

## What the model receives

Spooldoc talks to your IBM i, its database, the Carbone server you
configure (see [Carbone](#carbone) below) and, only through the agent,
the model provider you choose. What the agent sends to the model provider:

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
IBM i. The tools read the preview sample, read and write the definition
and templates of the job's draft, render previews of the draft with
Carbone, read the Carbone syntax reference, ask the user a question, and,
when the user asks to reuse another job, list the other jobs and read
their definition and templates. What the model writes, and the job builder
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
- **The mail server password** and **the Microsoft 365 client secret**
  are stored the same way, decrypted only to send, never returned by the
  API, and removed from error messages. The saved mail server password
  is sent only to the server, port and user it was entered for: a change
  to any of them needs the password again. The Microsoft 365 access token
  is kept in memory only, until shortly before it expires.
- **Captured spooled files** and **delivered files** are in clear text,
  for previews, runs and downloads. Protect the database like the spooled
  files themselves: access, backups and the volume included. Retention
  deletes them with the runs.

## Sign-in

The app needs a sign-in (Better Auth, email and password). Anyone may
create the first account on the login page; after that sign-up is closed,
and one sign-up at a time is accepted so two first accounts cannot race.
A later sign-up is refused with a message saying the instance has one
account and to sign in with it. The password is changed on the
[Profile](profile.md) page, which signs out every other session.
There is one role: every signed-in user can do everything. Every write is origin-checked against `APP_URL`
and the request's own host, and the session cookie is secure under https.

## On the IBM i

Spooldoc signs on with the profile of each saved server and uses only
these operations: list output queues and spooled files (SQL services),
read a spooled file, `HLDSPLF`, move and delete a spooled file, read a
data queue, and, when asked from the trigger step, `CRTDTAQ` and
`CHGOUTQ DTAQ(...)`. It runs SQL against application tables only for a
job's [lookups](lookups.md), and installs nothing on the system.

Lookups run on a second JDBC connection that is opened read only, so the
driver refuses a statement that changes data, whatever the SQL says.
Spooldoc also refuses anything but one SELECT, WITH or VALUES statement
before it is sent. The driver checks only the type of the statement: a
SELECT that calls a user-defined function which changes data is not
blocked. The authority of the server's user profile is what limits that,
so give it `*USE` on the tables its lookups read and no more. Each value
a lookup takes is bound as a parameter, never written into the SQL, and
each query may run 30 seconds.

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

Carbone's startup log names the licensee of an Enterprise license.
Spooldoc never reads or copies that log.

## Email

An [email destination](destinations.md#email) sends documents out of your
network: each email, with its files and the values in its fields and
message, goes to the mail server in Settings and on to the addresses the
job sets. Use STARTTLS or TLS unless the server is a relay on your own
network.

With Microsoft 365, the Spooldoc server sends the tenant ID, the client
ID and the client secret to `login.microsoftonline.com` for a token, and
each email to `graph.microsoft.com`, both over HTTPS. Each email is kept
in the mailbox's Sent Items. The Mail.Send permission lets the app send
as any mailbox of the tenant unless you limit it: see
[Limit the app to one mailbox](configuration.md#microsoft-365). While an email destination has a test address, every email goes
only there. Every email a run sent, or tried to send, is listed on the run
in the [job log](job-log.md#emails), with a copy of its files.

## Webhook

A [webhook destination](destinations.md#webhook) sends documents out of
your network: each call, with the document's data and files, goes to the
URL the destination sets. Whoever can add or change destinations chooses
that URL, so an account that can sign in can send documents anywhere the
Spooldoc server can reach.

- The signing secret and the header values are stored encrypted with
  `SPOOLDOC_SECRET_KEY`. The page never gets them back: the secret shows
  once when it is made or rotated, and header values never show again.
- Both are taken out of every error, log line and stored answer, and the
  URL is stored and shown without its query string.
- Redirects are not followed, so a call goes only to the URL you set.
- An `http://` URL works, and the dialog warns that each call and its
  files travel unencrypted. Use `https://` unless the receiver is on your
  own network.
- While a test URL is set, calls go there without the header values,
  since those are often credentials. The signature is still sent; it
  proves the call came from Spooldoc, and it does not give away the
  secret.

Every call a run made, or tried to make, is listed on the run in the
[job log](job-log.md#webhook-calls), with the start of the receiver's
answer and a copy of the files.

## SFTP

An [SFTP destination](destinations.md#sftp) uploads files to a server
outside Spooldoc, signed in with a key or a password.

- The private key, its passphrase and the password are stored encrypted
  with `SPOOLDOC_SECRET_KEY`. No key or password is sent to the browser:
  a key Spooldoc makes stays sealed on its way through the dialog, and
  the page shows only the public key line and its fingerprint.
- They are taken out of every error, log line and stored detail.
- The host key is pinned. Spooldoc trusts one host key per destination,
  only after you compare its fingerprint and pick Trust this key, and it
  never takes a key on its own. A connection offers only the trusted
  key's type, and a key that differs fails the run with both
  fingerprints. A check stops at a key it does not trust, before the
  sign-in, so a password is never sent to an unknown server. The page
  cannot make up a trusted key: it saves only one a check signed.
- A saved password is sent only to the server, port and user it was
  entered for.
- Check connection reads the folders and writes nothing. Upload test
  writes only to the test folder.

Every file a run uploaded, or tried to, is listed on the run in the
[job log](job-log.md#uploads).

## Checklist

- Generate `BETTER_AUTH_SECRET` and `SPOOLDOC_SECRET_KEY` once, keep them
  with the backups, and pass them as secrets, not on the command line.
- Put the app behind https and set `APP_URL`.
- Reach the IBM i over a private network; do not open the host server
  ports to the internet. Set `SPOOLDOC_ALLOWED_HOSTS`.
- Give the IBM i profile only the queues it needs, and only `*USE` on
  the tables its lookups read.
- Decide where the values may go: a local model keeps them on your
  network; with a hosted provider, turn on masking unless its terms are
  acceptable for your documents.
- Set the retention to what the documents need, no longer.
