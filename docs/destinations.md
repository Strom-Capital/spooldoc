---
title: "Destinations"
description: "Where a job delivers its documents."
---

A destination is where the files of a run go. Jobs pick one in the
destination step, and the Destinations page lists them with the jobs that
use each.

## Spooldoc download

The built-in destination keeps every file in Spooldoc's database. The
files appear on the run in the [job log](job-log.md), one PDF or HTML per
document, named after the definition's `output.name`, and can be
downloaded from there. They are deleted with the run when it passes the
retention period.

Delivery happens in the run's transaction, so a run and its files are
saved together or not at all. The spooled file is held, moved or deleted
only after every file was delivered.

## More destinations

Spooldoc download is the only destination today, so the app shows only
that one. SFTP, S3, IFS, email and webhooks are planned, each in its own
[issue](https://github.com/Strom-Capital/spooldoc/issues?q=is%3Aissue+is%3Aopen+destination).
A destination is one small interface in
`apps/web/lib/server/destinations`: a kind and a `deliver` call that
receives the run's files. See [Contributing](contributing.md#adding-a-destination).
