---
title: "Job log"
description: "Every run of every job: what was read, what was delivered, what failed, and how long runs are kept."
---

The Job log lists every run of every job, newest first: the job and the
version it used, the spooled file, what started it (Run now or the
watcher), when it started, its status, and the files it delivered.
Filter by job, status and date. Open a run to see its steps.
Filtered to one job, the path at the top names the job, and Job log in
the path opens the log without filters.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/job-log-dark.png">
    <img src="assets/job-log-light.png" alt="A run opened from the job log shows its status, the spooled file, the five steps with their timings, and the five pick list PDFs it delivered." width="900">
  </picture>
</p>

## Statuses

| Status | Meaning |
|--------|---------|
| Running | The run is in progress. A run whose server stopped while it ran is marked failed within a few minutes. |
| Success | Every document was delivered and the finish step did what it should. |
| Warning | The documents were delivered, but the finish step failed: the spooled file is still where it was. Hold, move or delete it by hand, or retry. |
| Failed | A step failed before anything was delivered. The error names the step and the cause, with secrets removed. The spooled file is left alone. |
| Skipped | The spooled file does not pass the definition's `match` rules, so it is not one the job is for. It is left alone. |

Failed and warning runs appear under Needs attention on the Home page
until they are dismissed, as do servers that cannot be reached, jobs whose
watcher reports an error, and queues that are polled because real-time
watching stopped. What fails before a run exists, such as a server the
watcher cannot reach, is also in the [server log](configuration.md#server-log).

## Runs cut off by a restart

A running run touches its heartbeat every 30 seconds. When the server
stops in the middle of a run, the heartbeat stops too, and the watcher
marks the run failed once the heartbeat is 3 minutes old, with "The run
was cut off". Retry it to run the file again.

## Steps

| Step | What it does |
|------|--------------|
| Capture | Reads the spooled file and stores it as a sample. |
| Extract | Matches the file against the definition and reads its page groups. |
| Render | Checks each template, then makes the document of each page group with it, in the template's formats, with [Carbone](carbone.md). An Excel template of the whole spooled file makes one document of all of them. A failed render shows Carbone's own text under Details. |
| Deliver | Hands every file to the destination. |
| Finish | Holds, moves, deletes or leaves the spooled file. |

Each step is recorded with its outcome, so a run shows where it stopped.
The captured sample and the delivered files stay with the run while it is
kept. When the job has more than one template, the run's files are
grouped by template. The log's Page groups column counts what the
definition found.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/job-log-failed-dark.png">
    <img src="assets/job-log-failed-light.png" alt="A failed run opened from the job log says which authority the user profile needs on the folder and the CHGAUT command that grants it, keeps the IBM i message under Details, and shows that the Deliver step failed." width="900">
  </picture>
</p>

## Emails

A run of a job that delivers to an [email destination](destinations.md#email)
has an Emails section under its files, with a count such as "Emails (42
of 43 sent)". It lists one email per document: the document, the
addresses it was for, its status and the time.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/job-log-emails-dark.png">
    <img src="assets/job-log-emails-light.png" alt="A run of an invoice job opened from the job log lists its PDF and HTML files, then Emails (6 of 6 sent): each invoice with the customer address it went to, Sent, and the time." width="900">
  </picture>
</p>

| Status | Meaning |
|--------|---------|
| Sent | The mail server took the email. |
| Test | Sent to the destination's test address instead. |
| Sent in run #N | An earlier run of the job sent it for the same spooled file, so it was not sent again. |
| Failed | Open the row to see why, with the mail server's own text under Details. |

A long list shows the first 50 emails and says how many more there are.
A run that sent nothing says "This run sent no email."

## Webhook calls

A run of a job that delivers to a [webhook destination](destinations.md#webhook)
has a Webhook calls section under its files, with a count such as
"Webhook calls (5 of 6 sent)". It lists one call per document: the
document with the URL it was posted to, without its scheme and query string, and
the receiver's answer with the tries, such as "200 OK in 142 ms, 3
tries" or "No answer after 3 tries", then its status and the time.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/job-log-webhooks-dark.png">
    <img src="assets/job-log-webhooks-light.png" alt="A run of an invoice job opened from the job log lists its PDF files, then Webhook calls (6 of 6 sent): each invoice posted to hooks.example.com/spooldoc with the answer 200 OK and the time it took, Sent, and the time." width="900">
  </picture>
</p>

| Status | Meaning |
|--------|---------|
| Sent | The receiver answered with a 2xx status. |
| Test | Sent to the destination's test URL instead. |
| Sent in run #N | An earlier run of the job sent it for the same spooled file, so it was not sent again. |
| Failed | Open the row to see why, with the receiver's answer, its first 2 KB, under Details. |

A run that sent nothing says "This run sent no webhook call."

## Retry

Retry runs the same spooled file again with the job's active version, as
a new run. Use it after fixing a definition or a template, or after a
finish step failed. Spooldoc remembers which spooled files a job has
processed, so the watcher never runs a file a second time on its own.

With an email destination, Retry sends only the emails that were not sent
yet. The ones an earlier run sent show as "Sent in run #N", and the
Deliver step says so: "Sent 1 email, 42 were sent in run #12".

With a webhook destination, Retry sends only the documents that were not
sent yet, each with the same `webhook-id` as before: "Sent 1 document to
hooks.example.com, 5 were sent in run #12".

## Retention

Settings holds how long runs are kept: 90 days by default, 1 to 3650. Once
an hour the watcher deletes runs that finished longer ago, with their
captured spooled files and delivered files, preview samples no job
uses, uploaded Word and Excel templates that no draft or version uses,
and the agent's [usage](agent.md#usage) records from before then. The record of which spooled files were processed is kept, so a file
is not run again after its run is gone. Runs are deleted in small batches
so no single delete holds its locks for long.
