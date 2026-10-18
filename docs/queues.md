---
title: "Queues"
description: "The output queues of a server and the spooled files on them."
---

The Queues page shows the output queues of one server: library, name,
description and the number of files, as `WRKOUTQ` would. Pick the server at
the top.

## Finding a queue

- **Search** matches the library and the queue name.
- **Sort** by any column.
- **Hide** the queues you never need. Hidden queues stay hidden for everyone
  until shown again; a switch shows them for a moment. Hiding is undoable
  from the toast.
- **New job** starts a [job](jobs.md) with this queue as its source.

A server with libraries set lists only the queues of those libraries. See
[Servers](servers.md).

## The files of a queue

Open a queue to list its spooled files: name, number, job, user data, form
type, status, pages and when it was created. Three filters narrow the list,
each a "contains" match:

| Filter | Matches |
|--------|---------|
| Spooled file name contains | The spooled file name |
| Job contains | The job as `number/user/name` |
| User data contains | The `USRDTA` attribute |

Open a file to see its pages as the printer would print them, decoded with
the file's own code page. This is the same view the job builder uses, so a
page that reads right here will read right in a job. A page that shows the
wrong characters usually means the spooled file has no CHRID and the job
CCSID is not supported; set `SPOOLDOC_DEFAULT_CCSID`. See
[Configuration](configuration.md).

The queue page only reads. Holding, moving or deleting a spooled file is
what a job's finish step does, after its documents were delivered.
