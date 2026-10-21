---
title: "Queues"
description: "The output queues of a server and the spooled files on them."
---

The Queues page shows the output queues of one server: library, name,
description and how many spooled files each holds. With more than one
server, pick the server at the start of the search row.

The description is read in the default CCSID of the system's language, so
letters such as ä, ö and å show as they do on the 5250 screen. When the
system has no default CCSID, Spooldoc uses `SPOOLDOC_DEFAULT_CCSID`.

Three columns count the files:

| Column | Counts |
|--------|--------|
| Ready | Files with the status READY. Every [job](jobs.md) on the queue picks these up. |
| Held | Files with the status HELD. A job picks these up when it takes held files too. |
| Total | Every spooled file on the queue, as `WRKOUTQ` counts them. Besides ready and held files, this includes saved and open files and files a printer is working on. |

Ready and held are counted after the list loads, because counting reads
every spooled file on the system. When counting fails, the page says why
and the two columns show a dash; the rest of the page still works.

The Jobs column counts the [jobs](jobs.md) that read from the queue: the
source of each job's active version, or of its draft when it has none.
Hover over the count, or click, tap or press Enter on it, to list them,
each with a link to the job and its state: Watching, Paused, On demand or
Draft only. On a hidden queue, the list notes that its jobs still run.

## Finding a queue

- **Search** matches the library and the queue name.
- **Sort** by any column.
- **Hide** the queues you never need, on the row or in its ⋯ menu, or
  several at once with the checkboxes. Hidden queues stay hidden for
  everyone until shown again; a switch shows them for a moment, and
  Unhide on the row brings one back. Hiding is undoable from the toast.
- **New job** on the row, or in its ⋯ menu, starts a [job](jobs.md) with
  this queue as its source.

A server with libraries set lists only the queues of those libraries. With
one library, the page leaves out the Library column and searches queue
names. See [Servers](servers.md).

## The files of a queue

Click a queue, or its name, to list its spooled files. The path above the title names
the queue's place: Queues, the server and the queue. Queues opens the
Queues page, and the server opens it on that server.

The list shows each file's name, number, job, user data, form type,
status, pages and when it was created. Four filters narrow the list. The
first three are a "contains" match:

| Filter | Matches |
|--------|---------|
| Spooled file name contains | The spooled file name |
| Job contains | The job as `number/user/name` |
| User data contains | The `USRDTA` attribute |
| Status | One of the statuses picked. Pick several to see, say, ready and held files. With none picked, any status matches. |

Each status shows as a colored pill with an icon. Hover over it for the
status as the IBM i spells it, such as `READY`.

| Color | Statuses | Means |
|-------|----------|-------|
| Green | Ready | Ready to print. Every job on the queue picks these up. |
| Amber | Held | Held. A job picks these up when it takes held files too. |
| Blue | Open, Writing, Pending, Printing, Sending | Still being written, or a printer or writer is working on it. |
| Red | Message | Waits for a reply to a message. |
| Gray | Saved, Deferred, Closed, Finished | Kept after printing, put off, or done. A status Spooldoc does not know also shows gray, with its IBM i name. |

The list shows the newest 200 files. When the queue has more, or more
match the filters, the page says so under the list, and Load more lists
200 more, up to 5000. Past that, narrow the filters to find older files.

Click a file, or its name, to see its pages as the printer would print
them, decoded with the file's own code page. This is the same view the job builder uses, so a
page that reads right here will read right in a job. A page that shows the
wrong characters usually means the spooled file has no CHRID and the job
CCSID is not supported; set `SPOOLDOC_DEFAULT_CCSID`. See
[Configuration](configuration.md).

The queue page only reads. Holding, moving or deleting a spooled file is
what a job's finish step does, after its documents were delivered.
