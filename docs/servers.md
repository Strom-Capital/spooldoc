---
title: "Servers"
description: "The IBM i systems Spooldoc reads output queues from."
---

The Servers page lists the IBM i systems Spooldoc connects to. Each server
has a name, a host, a user profile and its password, and optionally the
libraries to list output queues from.

## Adding a server

| Field | What it is |
|-------|------------|
| Name | How the server appears in Spooldoc, for example `Production`. |
| Host | The host name or address of the IBM i. When `SPOOLDOC_ALLOWED_HOSTS` is set, this is a list of the allowed hosts instead of a free text field. |
| User profile | The profile Spooldoc signs on with. |
| Password | Stored encrypted with AES-256-GCM under `SPOOLDOC_SECRET_KEY`. When editing, leave it empty to keep the saved one; enter it again for a new host or user. |
| Libraries | Optional. Only the output queues of these libraries are listed. Empty lists every queue the profile can see. |

Spooldoc signs on when it saves a server, so a wrong host or password shows
up at once. A server that cannot be reached later appears under Needs
attention on the Home page.

## What the profile needs

The profile needs to read the output queues of the jobs, and to hold, move
or delete the spooled files the finish step touches. Reading a spooled file
of another user needs `*SPLCTL` or the queue's authority, as it does with
`WRKOUTQ`. To set up real-time watching, the profile needs to create a data
queue and change the output queue (`CRTDTAQ`, `CHGOUTQ`). Nothing else is
needed: Spooldoc runs no SQL against application tables and installs
nothing on the IBM i.

## Network

Spooldoc connects through jt400 to the host server ports: 449 (port
mapper) and 8470 to 8476 (central, database on 8471, network print, remote
command and sign-on). See [Deployment](deployment.md#network).

## When the IBM i says no

Spooldoc reads the IBM i's error and says what went wrong and what to do
next, with the message ID at the end, such as `(CPF2204)`. The IBM i's own
text is under Details in the error box, for support. The same message
goes into the job log, Needs attention and the server log.

| What happens | What Spooldoc says to do |
|--------------|--------------------------|
| Wrong password (`CPF22E2`) | Check it on the Servers page. Repeated wrong passwords can disable the profile. |
| Profile disabled (`CPF22E3`) | A security officer enables it with `CHGUSRPRF USRPRF(name) STATUS(*ENABLED)`. |
| Password expired (`CPF22E4`) | Set a new one on the IBM i, then enter it on the Servers page. |
| No password (`CPF22E5`) | Use a user profile with a password. |
| No such user (`CPF2204`) | Check the user on the Servers page. |
| Unknown host, refused, timed out | Check the host name, that the host servers run (`STRHOSTSVR SERVER(*ALL)`), and the ports below. |
| No authority to an object | A security officer grants it, for example with `GRTOBJAUT ... AUT(*USE)` for the object named. |
| No authority to a spooled file | Other users' spooled files need `*SPLCTL`, or `*JOBCTL` on a queue created with `OPRCTL(*YES)`. |
| Output queue, library or data queue gone | Point the job's source at another queue, or turn on real-time watching again to create the data queue. |
| Spooled file gone | Nothing to fix: it was deleted, printed or cleaned up before Spooldoc read it. |

Errors Spooldoc does not recognize show the IBM i's text as it is.

## The data queue

A server remembers one data queue, the one Spooldoc reads for real-time
watching. It is either a queue Spooldoc created when asked (`SPOOLDOC` in
the output queue's library) or one that was there before, when you let
Spooldoc read a data queue an output queue already sent to. Spooldoc never
changes an output queue that sends to a data queue it does not read. See
[Watching a queue](jobs.md#watching-a-queue).

## Removing a server

A server that jobs still read from cannot be deleted; change or delete
those jobs first. Deleting the server removes its saved password and its
hidden-queue list.
