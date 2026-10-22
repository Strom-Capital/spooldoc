---
title: "Destinations"
description: "Where a job delivers its documents."
---

A destination is where the files of a run go. Jobs pick one in the
destination step. The Destinations page lists them with the jobs that use
each, and adds, edits and deletes the ones you made.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/destinations-dark.png">
    <img src="assets/destinations-light.png" alt="The Destinations page lists an email destination, two IFS folders with their folders and settings, and the built-in Spooldoc download, each with the number of jobs that use it." width="900">
  </picture>
</p>

## Spooldoc download

The built-in destination keeps every file in Spooldoc's database. The
files appear on the run in the [job log](job-log.md), a file per document
in each format of its [template](jobs.md#templates), named after the
definition's `output.name`, and can be downloaded from there. An Excel
template of the whole spooled file makes one file per format for the
spooled file, named after it. They are deleted with the run when it passes the
retention period.

A run's files are saved together or not at all. The spooled file is held,
moved or deleted only after every file was delivered. The built-in
destination cannot be changed or deleted.

## IFS folder

An IFS destination writes each file of a run to a folder in the IFS, where
programs on the IBM i can pick it up. Add one with **Add destination** on
the Destinations page. It has a name, a folder such as `/home/docs/out`,
and two settings.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/destination-ifs-dark.png">
    <img src="assets/destination-ifs-light.png" alt="The New IFS destination dialog is filled in with a name, the folder /home/docs/delivery-notes, Add a number when a file with the same name exists, and Keep a copy in Spooldoc on." width="900">
  </picture>
</p>

**The folder is on the job's server.** A destination holds a folder, not a
server: each job writes to the folder on the IBM i it reads its spooled
files from. Two jobs on two servers can share one destination.

**Spooldoc never creates the folder.** When it does not exist, the run
fails with "The folder /home/docs/out does not exist on
ibmi.example.com", before any file is written. Create it on the IBM i,
for example with `MKDIR DIR('/home/docs/out')`, or change the folder.

**Authority.** The user profile of the server needs `*WX` data authority
on the folder and `*X` on every folder above it. A security officer can
grant it with:

```
CHGAUT OBJ('/home/docs/out') USER(MYUSER) DTAAUT(*WX)
```

When the authority is missing, the run says which folder and which
authority, and keeps the IBM i's own text under Details.

**CCSID.** Each file is tagged so programs on the IBM i read it right:
HTML and other text with CCSID 1208 (UTF-8), PDF, DOCX and XLSX with
65535 (binary).

**When a file with the same name exists**, the destination does one of
three things:

| Setting | What happens |
|---------|--------------|
| Replace | The old file is replaced. This is the default. |
| Fail the run | The run fails and says which file is in the way. Every name is checked first, so nothing is written. No file is ever replaced, not even one another run writes while this one runs. |
| Add a number | The file gets the first free number: `invoice-1001-2.pdf`, then `invoice-1001-3.pdf`. A name another run takes while this one writes gets the next number. |

Names are checked the way the IBM i compares them. Folders outside
`/QOpenSys` ignore case, so `Acme.pdf` and `ACME.pdf` are one file there.
When two files of one run have names that differ only in case, the second
gets a number, `ACME-2.pdf`, in every setting, so neither replaces the
other. Spooldoc does this in every folder.

**Keep a copy in Spooldoc** is on by default. The files are then also
kept as with [Spooldoc download](#spooldoc-download), and saved before the
write to the IFS, so they can be downloaded from the job log even when the
write fails. With it off, the run's Files section says no copy was kept,
and the Deliver step says where the files went: "Wrote 6 files to
/home/docs/out on ibmi.example.com (1 replaced)".

**A file is never half written.** Each file is written to a part file of
its own first, such as `.invoice-1001.pdf.1a2b3c4d.part`, and renamed when
it is complete, so a program that watches the folder sees whole files
only. Two runs that write the same name at once each have their own part
file. Have the program skip names that start with a dot.

**A replaced file is replaced, not updated in place.** Spooldoc renames
the old file aside, to a name that ends in `.old`, renames the new file
into its place, and then deletes the old one. A program that has the old
file open keeps reading the old file. If the new file cannot take its
place, the old one is renamed back, so a failed write never loses both.
If even that fails, the run says where each file is, and you rename the
one to keep. If the old file cannot be deleted at the end, the Deliver
step names it, and you delete it.

**When a write fails part way**, the run fails with "Wrote 2 of 6 files to
/home/docs/out, then: ..." and the reason. The files already written stay
in the folder. The spooled file is not held, moved or deleted, so after
fixing the problem, [Retry](job-log.md#retry) runs it again. What the
retry does with the files the first try wrote depends on the setting:

| Setting | On retry |
|---------|----------|
| Replace | They are written again under the same names, so the folder holds one copy of each. |
| Fail the run | The retry fails at once, since their names are taken. Move them first. |
| Add a number | They are written again with a number: `invoice-1001-2.pdf` next to `invoice-1001.pdf`. A program that watches the folder takes each document twice. |

Use Replace for jobs you may retry.

A destination that a job's draft or any saved version delivers to cannot
be deleted. Deleting one never touches the folder or its files.

## Email

An email destination sends one email per document: each invoice to the
customer on it, each delivery note to the address printed in it. Emails
go through the SMTP server or the Microsoft 365 mailbox set in
[Settings](configuration.md#mail-server).
Add one with **Add destination** on the Destinations page and pick
**Email**. It has a name and a test address.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/destination-email-dark.png">
    <img src="assets/destination-email-light.png" alt="The New destination dialog with Email picked is filled in with a name and a test address under Send all email to, and says that while it is set every email goes only there." width="900">
  </picture>
</p>

**The test address.** While **Send all email to** is set, every email of
every job that uses the destination goes only there. Cc and Bcc are
dropped, the subject starts with `[Test]`, and a line at the top of the
message names the addresses it would have gone to. A new email
destination starts with your own address there, so you can try a job
before any customer gets an email. The Destinations page shows
"Test: all email goes to you@example.com" while it is set. Empty it to
send to the addresses each job sets.

### What each email holds

The job's destination step sets the email. Each field takes the same
`{d.pg.field}` tags as `output.name` in the [definition](definitions.md),
filled in from the page group of each document:

| Field | What it holds |
|-------|---------------|
| To | One or more addresses, separated by commas: `{d.pg.email}, orders@example.com`. Required. |
| Cc, Bcc | Optional. Bcc to an archive mailbox is one fixed address. |
| Reply-To | Optional, one address. |
| Subject | Such as `Invoice {d.pg.invoiceNo}`. Empty, the subject is the document's name. |
| Message from | Text written here, or one of the job's HTML templates. |
| Message | The text of the email, with fields, when the message is text. |
| Attach | The formats of the document's files that go with the email: PDF by default. |

A tag can take one formatter, as in a template: `formatN`, `formatC` or
`formatD`, such as `{d.pg.totalAmount:formatC(2)}`,
`{d.pg.totalAmount:formatN(2)} {d.pg.currency}` or
`{d.pg.dueDate:formatD('DD.MM.YYYY')}`. They print what a template prints
with the same tag and the [Formats](configuration.md#formats) in Settings,
so an email and its PDF show the same amount. Without a formatter, a date
field prints in the date format of Settings, and a number keeps its
decimals with the separators of Settings: `1,374.5`. Any other
formatter, or one with a wrong argument, is listed under the fields, and
a version cannot be saved with it. A value that is not a number or a date
prints nothing. **Insert field** lists the fields of the definition with
their values in the page group shown, formatted, and puts the one you
pick at the cursor. A tag that is not a field of the
definition is listed under the fields, and a version cannot be saved with
one. From is always the address in Settings.

Beside the fields, the step shows the email of one page group as it will
be sent: From, To, Subject, the files and the message. Previous and Next
step through the page groups, so you can watch To and Subject change from
customer to customer. When the run also sends an email for the whole
spooled file, Next after the last page group shows that one, filled in
from `{d.splf...}`. When page groups get no email, the preview shows only
the whole spooled file's email. Nothing is sent from the preview.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/email-step-dark.png">
    <img src="assets/email-step-light.png" alt="The destination step of an invoice job sends to {d.pg.customerEmail} with a Bcc to an archive mailbox, a Reply-To and the subject Invoice {d.pg.invoiceNo} from MyCo Ltd. Beside the fields, the preview of page group 1 of 6 shows the email to invoices@northernsupply.example with invoice-260101.pdf attached and the message filled in, its total formatted as 302,66 € and its due date as 29.10.2026." width="900">
  </picture>
</p>

**The email can be the document.** With **Message from** set to an HTML
template, the message is the HTML the template makes for the page group.
Its CSS is moved into the elements, since many mail programs drop
`<style>`, and its [images](templates.md#logos-images-and-fonts) go into the email as inline
attachments, since some mail programs block images written into the HTML.
A plain-text version goes with it through an SMTP server. Microsoft 365
takes one body per email, so there the email has the HTML message only.

**Files.** Each email carries its own document's files, in the formats
under Attach, named as the [Spooldoc download](#spooldoc-download) names
them. The files of an Excel template of the whole spooled file go in one
email of their own, and only when Attach picks their format. That email
has no page group, so its fields can read only `{d.splf...}`. When Attach
picks only formats of the whole spooled file, that one email is all the
run sends: the page groups get no email, since it would have no file, and
the preview says so. The whole spooled file's email always has the
message written under **Message**, since a message template makes one
page group's message. With Attach empty, each page group still gets its
email, with nothing attached. A copy of
every file is kept in Spooldoc, so the job log can show what was mailed.
Through Microsoft 365, each file can be up to 3 MB and the whole email up
to 4 MB, with images; an email over that fails with the file's name and
what to do, and the other emails are still sent.

### When an email fails

A missing or wrong address fails that document with what to fix:
"invoice-260101: {d.pg.email} is empty", or
'"J. SMITH" in To is not an email address'. In To, every tag needs a
value, so a customer whose address is empty is never left out without a
word. An empty Cc, Bcc or Reply-To is left out.

The other documents are still sent. Then the run fails with "Sent 42 of
43 emails" and the first reason, and the spooled file is not held, moved
or deleted. The [job log](job-log.md#emails) lists every email with its
status. After fixing the cause, [Retry](job-log.md#retry) sends only the
emails that were not sent yet: a document an earlier run of the same job
sent for the same spooled file is not sent again. It counts as the same
document when the spooled file has the same creation time, and the
document the same pages and name. So a new spooled file whose job number
the IBM i reused, or a newer job version that groups the pages another
way, sends its emails again. An email sent to the
test address does not count as sent, so taking the test address out sends
every email for real.

Errors of the mail server say what to check: a refused sign-in, a host
or port that cannot be reached, a TLS setting that does not match the
port, an email too large for the server, or an address the server
refused. Through Microsoft 365 they name a wrong tenant ID, client ID or
secret, an expired secret, a missing Mail.Send permission, a mailbox the
app may not send as or that does not exist, and throttling. When
Microsoft 365 asks Spooldoc to wait a few seconds, it waits and tries
again, twice at most; when the wait is longer than a minute, or the
throttling goes on, the email fails and says to retry later. The server's own text is under Details. When the server,
the sign-in or the connection fails, the run stops sending, and the
emails it did not try say so. A run keeps one connection to an SMTP
server open for its emails, instead of signing in for each one, so a
server that limits sign-ins does not stop a long run. An address the server refuses fails that email
only.

## Webhook

A webhook destination posts one call per document to a URL: each
invoice, with its data and its PDF, to the program that books it. The
call is JSON, signed so the receiver can check that it comes from
Spooldoc. Add one with **Add destination** on the Destinations page and
pick **Webhook**. It has a name, a URL, an optional test URL and
optional headers.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/destination-webhook-dark.png">
    <img src="assets/destination-webhook-light.png" alt="The New destination dialog with Webhook picked is filled in with a name, the URL https://hooks.example.com/spooldoc and an Authorization header whose value is hidden." width="900">
  </picture>
</p>

**The URL** starts with `https://` or `http://`, without a user name, a
password or a `#` part. Credentials go in a header. An `http://` URL
works, and the dialog warns that each call and its files then travel
unencrypted. Spooldoc does not follow redirects: a receiver that answers
with a redirect fails the call, and the message names where it points.
It waits 30 seconds for an answer.

**Headers** go with every call, such as `Authorization: Bearer ...` or
an API key the receiver asks for. The values are stored encrypted and
never shown again; leave a value empty to keep the saved one. Spooldoc
sets `Host`, `Content-Type`, `Content-Length`, `User-Agent` and the
`webhook-` headers itself, so a destination cannot set them.

**The signing secret.** Adding a webhook destination makes a signing
secret: `whsec_` and 44 characters of base64. The dialog
shows it once, with a copy button: give it to the receiver then. To make
a new one, open the destination and pick **Rotate secret**. The old
secret stops working at once, so the receiver refuses calls until it has
the new one.

In the job's destination step, **Files to send** picks the formats of the
document's files that go in each call: every format the templates make,
by default. With none picked, each call holds the data only. Beside it,
the step shows a preview of the call of one page group, with line
numbers, as a run would make it, with the real values of the sample:
`document.created`, or `document.test` while a test URL is set.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/webhook-step-dark.png">
    <img src="assets/webhook-step-light.png" alt="The destination step of an invoice job sends its PDF and HTML files to a webhook. Beside the fields, a preview of the call of page group 1 of 6 with line numbers: POST /spooldoc, the headers with the Authorization value masked and the signature, and the JSON body with the document, the job, the spooled file and the invoice's fields. Below it, the receiver's answer HTTP/1.1 200 OK in 142 ms." width="900">
  </picture>
</p>

### What each call holds

Each call is a `POST` with `Content-Type: application/json` and this
body:

```json
{
  "type": "document.created",
  "timestamp": "2026-10-21T09:14:03Z",
  "data": {
    "document": { "name": "invoice-260101", "pageGroup": 1, "pageGroups": 6 },
    "job": { "id": "6f1c...", "name": "MYJOB", "version": 3 },
    "run": { "id": "0b9e...", "number": 128 },
    "spooledFile": {
      "name": "QPRINT", "number": 4, "jobName": "MYJOB", "jobUser": "MYUSER",
      "jobNumber": "123456", "outputQueue": "MYLIB/MYOUTQ", "userData": "INV", "pages": 6
    },
    "data": { "pg": { "invoiceNo": "260101" }, "splf": {} },
    "files": [
      { "name": "invoice-260101.pdf", "contentType": "application/pdf", "size": 49321, "template": "Invoice", "content": "JVBERi0xLjcK..." }
    ]
  }
}
```

| Field | What it holds |
|-------|---------------|
| `type` | `document.created` for a run, `document.test` for Send test and for every call while a test URL is set. |
| `timestamp` | When the call was made, in UTC. |
| `data.document` | The document's name, as the [Spooldoc download](#spooldoc-download) names its files, its page group from 1 and how many the spooled file has. |
| `data.job`, `data.run` | The job, its version, and the run with its number in the job log. A Send test runs nothing, so `run` and `version` are `null`. |
| `data.spooledFile` | The spooled file and its output queue. |
| `data.data` | What the templates get: `{ pg, splf }`, the fields of the page group and of the spooled file, as the [definition](definitions.md) reads them. |
| `data.files` | The document's files in the formats the job picks, each with its size, the template it was made with, and its bytes in base64. |

The files of an Excel template of the whole spooled file go in one call
of their own, and only when Files to send picks their format. That call
has `pageGroup` `null`, and `data.data` is `{ pgs, splf }` with every
page group. A copy of every file is kept in Spooldoc, so the job log can
show what was sent and the download works too.

### Checking the signature

Each call is signed the [Standard Webhooks](https://www.standardwebhooks.com/)
way, with three headers:

| Header | What it holds |
|--------|---------------|
| `webhook-id` | The call's id, such as `msg_2f8a...`. A document of a spooled file keeps its id on every Retry, so a receiver that keeps the ids it took can skip a call it already has. |
| `webhook-timestamp` | When the call was signed, in seconds since 1970. |
| `webhook-signature` | `v1,` and the base64 HMAC-SHA256 of `<id>.<timestamp>.<body>`, keyed with the bytes of the secret after `whsec_`. |

The receiver checks the signature against the body exactly as it came,
before it parses the JSON, and refuses a timestamp more than a few
minutes off. In Node.js, the
[`standardwebhooks`](https://www.npmjs.com/package/standardwebhooks)
package does both:

```js
import { Webhook } from 'standardwebhooks';

const webhook = new Webhook(process.env.SPOOLDOC_SECRET);
// Throws when the signature or the timestamp is wrong.
const call = webhook.verify(rawBody, request.headers);
```

The same check with `node:crypto` alone:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(secret, headers, rawBody) {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = Buffer.from(createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64'));
  return headers['webhook-signature']
    .split(' ')
    .map((part) => Buffer.from(part.replace(/^v1,/, '')))
    .some((given) => given.length === expected.length && timingSafeEqual(given, expected));
}
```

The same packages exist for Python, Go, Java, C#, PHP and Ruby; the
Standard Webhooks site lists them.

### Sending a test

**Send test** under the preview renders that page group from the
draft and posts it to the URL now, as `document.test`. It tries once,
records nothing in the job log, and shows the receiver's answer below
the call: the status, the time and the start of the body. A failed test
shows the status in red and says why below it.

**Test mode.** While **Send all calls to** is set on the destination,
every call of every job that uses it goes there instead: runs and Send
test alike. Each call is marked `document.test`, still signed, and goes
without the header values, since those are often credentials. Spooldoc
does not count a call in test mode as sent, so taking the test URL out
sends every document again for real. A public request inspector, such as
a page that shows each request it gets, shows the sample's values to
anyone with its link; use one you control for real data. The
Destinations page and the destination step say "Test" while it is set.

### When a call fails

A call that does not get a 2xx answer is tried again only when trying
again can help:

| What happens | Tries |
|--------------|-------|
| A 2xx answer | Sent. |
| No answer within 30 seconds, a dropped connection, 408, 429 or 5xx | Up to 3 tries, 2 and then 10 seconds apart, or after the `Retry-After` the receiver asks for, up to a minute. |
| Any other 4xx, or a redirect | Fails at once. |
| The host is not found, refuses the connection, or its certificate is not trusted | Fails after 3 tries, and the run does not try the documents after it. |

The other documents are still sent. Then the run fails with "Sent 5 of 6
documents to hooks.example.com" and the first reason, and the spooled
file is not held, moved or deleted. Each reason says what to check: the
headers for 401 and 403, the URL for 404, and the size of the call for
413, with the files the job could leave out. The receiver's answer is
under Details. The [job log](job-log.md#webhook-calls) lists every call with
its answer and its tries. After fixing the cause,
[Retry](job-log.md#retry) sends only the documents that were not sent
yet, with the same `webhook-id` as before.

A receiver with a certificate from your own certificate authority needs
that authority added to Spooldoc; see
[Certificates](configuration.md#certificates).

## SFTP

An SFTP destination uploads each file of a run to a folder on an SFTP
server: the invoices to the bank, the delivery notes to an EDI partner.
Add one with **Add destination** on the Destinations page and pick
**SFTP**. It has a name, the server and its port, the user, how to sign
in, a folder, an optional test folder and three settings.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/destination-sftp-dark.png">
    <img src="assets/destination-sftp-light.png" alt="The New destination dialog with SFTP picked is filled in for sftp.example.com as MYUSER, with the public key line of the key Spooldoc made and the folder /in/invoices. The Connection box below lists each step of the check: reached the host on port 22, the trusted ED25519 host key with its fingerprint, signed in as MYUSER with the key, and both folders found." width="900">
  </picture>
</p>

**The server** is a host name or an IP address, such as
`sftp.example.com`, without `sftp://`, a user or a port. The port is 22
by default.

### Signing in

**Key Spooldoc makes** is the default. Spooldoc makes an Ed25519 key
pair when you pick it, and the dialog shows the public key line with a
Copy button:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... spooldoc Invoices to bank
```

Add this line to `~/.ssh/authorized_keys` of the user on the server, or
send it to the server's admin. The private key never leaves Spooldoc: it
is stored encrypted and never sent to the browser. For a server that
refuses Ed25519, **Make an RSA key instead** makes an RSA 4096 key. To
change the key of a saved destination, open it and pick **Make a new
key**. Runs use the new key once you save, so add it to the server
first. The old key stays on the server until its admin removes it.

**Your key** takes a private key you have: paste it, or pick **Choose
file**. Spooldoc reads OpenSSH, PEM and PuTTY keys, with the passphrase
when the key has one. Once saved, the dialog shows the key's type and
fingerprint; leave the box empty to keep it.

**Password** signs in with a password. Spooldoc also gives it when the
server asks for it as a prompt (keyboard-interactive), as many servers
do. The password is sent only to the server and user it was entered
for: change the server, the port or the user, and the dialog asks for it
again.

### The host key

Every SSH server has a host key, and Spooldoc trusts exactly one per
destination. It never takes a key on its own.

**Check connection** in the dialog connects and prints each step as it
goes: the host and port it reached and how long that took, the host
key, the sign-in and the folders. A new destination stops at **New host
key**, before it signs in, so a password is never sent to a server
Spooldoc does not know. The line shows the key's type and its
fingerprint, as `ssh-keygen -l` prints it:

```
ED25519 256 SHA256:7Ld9b2qWm0rXo4TzVc8NfKe1Hs6JyPa3UgBiD5lQuE4
```

Compare it with the server's own before you trust it. On the server:

```sh
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Or from another machine:

```sh
ssh-keyscan -p 22 sftp.example.com | ssh-keygen -lf -
```

When they match, pick **Trust this key**. The check runs on, and the
key shows as trusted. Save the destination to keep it. You can save
before that, and the Destinations page then says "Host key not trusted
yet"; a run fails at once and says what to do.

**A changed host key** fails every run with both fingerprints: the one
Spooldoc trusts and the one the server showed. If the server's admin
changed it, open the destination, check the connection and pick
**Trust the new key**. If not, do not: something may be between Spooldoc
and the server. A change of the server or the port forgets the trusted
key.

### The folder

**The folder** is on the server, such as `/in/invoices`. A folder that
does not start with `/` is in the user's home folder.

**Spooldoc never creates the folder.** When it does not exist, the run
fails with "The folder /in/invoices does not exist on sftp.example.com",
before any file is written. Check connection finds it, or says it is
missing, before the first run.

**Upload all files to** is the test folder, such as `/test/in`. While it
is set, runs and Upload test write there instead, marked as a test, and
the Destinations page and the destination step say "Test". An upload to
the test folder does not count as uploaded, so taking the test folder
out uploads every file again for real.

**When a file with the same name exists**, the destination does one of
three things, as the [IFS folder](#ifs-folder) does:

| Setting | What happens |
|---------|--------------|
| Replace | The old file is replaced. This is the default. |
| Fail the run | The run fails and says which file is in the way. Every name is checked first, so nothing is uploaded. |
| Add a number | The file gets the first free number: `invoice-260101-2.pdf`, then `invoice-260101-3.pdf`. |

When two files of one run have names that differ only in case, the
second gets a number, so a server that ignores case keeps both.

**Write each file under a temporary name first** is on by default. Each
file is uploaded as `.invoice-260101.pdf.1a2b3c4d.part`, synced when the
server can, and renamed when it is whole, so a program that watches the
folder sees whole files only. Have it skip names that start with a dot.
Replace uses the server's atomic rename (`posix-rename@openssh.com`,
which OpenSSH has). On a server without it, the old file is renamed
aside to a name that ends in `.old`, the new one renamed in, and the old
one deleted; if the new one cannot take its place, the old one is put
back. If the old one cannot be put back either, both files are kept, and
the message names them. Turn the setting off for a server that refuses
renames, or that picks up each file as soon as it is closed: some managed
file transfer gateways do both. Each file is then uploaded under its own
name. When a write fails partway, that file fails with the reason.
Spooldoc deletes the incomplete file it made, or says to delete it. With
Replace, the old file was already overwritten, so the message says the
file on the server is incomplete.

**Keep a copy in Spooldoc** is on by default, as for an IFS folder. The
files can then be downloaded from the job log, even when the upload
fails.

### When the server is an IBM i

An IBM i can be the SFTP server, through its SSH server:

- Start it with `STRTCPSVR SERVER(*SSHD)`.
- The user profile needs a home folder, such as
  `CHGUSRPRF USRPRF(MYUSER) HOMEDIR('/home/MYUSER')`. The public key line
  goes in `/home/MYUSER/.ssh/authorized_keys`.
- The SSH server ignores a key file that others can change. Set
  `chmod 755` on the home folder, `700` on `.ssh` and `600` on
  `authorized_keys`.

To deliver to the IBM i a job reads from, use an [IFS folder](#ifs-folder)
destination instead: it tags each file with its CCSID, which SFTP cannot.

### The folder view and Upload test

In the job's destination step, beside the page group, the folder on the
server is listed live: the folder runs write to, or the test folder in
test mode. The page group's files are placed among the files already
there, in the order the server sorts them, each tagged with what a run
will do: New, Replaces the file from 14 Oct, Becomes
`invoice-260101-2.pdf`, or Fails the run. Three files show on each side;
a gap says how many it skips and opens 50 at a time. The listing is read
once a minute, so stepping through page groups does not reconnect;
refresh it with the button in its corner. A folder of more than 5,000
files is read in part, and the view says so. The page group's files are
then looked up one by one; when a lookup fails, the view says why.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/sftp-step-dark.png">
    <img src="assets/sftp-step-light.png" alt="The destination step of an invoice job uploads to SFTP. Beside the page group stepper, the test folder MYUSER@sftp.example.com:/test/in is listed with earlier invoices around invoice-260101.pdf, which Upload test has just uploaded, with its size and time. Below the listing, Upload test and the line Test: files go to /test/in." width="900">
  </picture>
</p>

**Upload test** renders the page group from the draft and uploads its
files to the test folder now, with the destination's same-name setting
and temporary names. The rows turn solid as the files land, with their
size and time. When the connection drops, the files not tried yet say
"Not uploaded" and why. It records nothing in the job log. Without a
test folder the button is off: set one on the destination first, so a
test never lands where the receiver picks up files.

### When an upload fails

A run opens one connection and uploads the files one after the other.

| What happens | What the run does |
|--------------|-------------------|
| The host is not found, refuses the connection, or does not answer within 20 seconds | Uploads nothing. Each file says "Not uploaded" and why. |
| The host key is not trusted yet, or changed | Uploads nothing, and signs in to nothing. |
| The server does not take the key or the password | Uploads nothing. With a key, the message says where the public key goes. |
| The server signs in but does not start SFTP within 20 seconds | Uploads nothing. |
| The folder is missing or is a file | Uploads nothing. |
| One file cannot be written, such as when the user may not write to the folder, a name is taken or the disk is full | That file fails; the others are still uploaded. |
| The connection drops, or the server stops answering for 60 seconds | The files not tried yet say "Not uploaded" and why. |

The run then fails with "Uploaded 5 of 6 files to /in/invoices on
sftp.example.com" and the first reason, and the spooled file is not held,
moved or deleted. The server's own text is under Details. The
[job log](job-log.md#uploads) lists every file with where it went. After
fixing the cause, [Retry](job-log.md#retry) uploads only the files that
this destination has not uploaded yet to this folder on this server, so
Add a number never makes a second copy. After the job moves to another
destination, or the destination to another server or folder, every file
is uploaded again.

## Writing a destination

A destination is one small interface in
`apps/web/lib/server/destinations`: a kind and a `deliver` call that
receives the run's files. See [Contributing](contributing.md#adding-a-destination).
Planned destinations are listed in the [README](../README.md#status).
