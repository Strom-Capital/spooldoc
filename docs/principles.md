---
title: "Principles"
description: "What Spooldoc believes, and what every change is checked against."
---

Spooldoc grows one change at a time, by people and by coding agents. Each
change can make sense on its own and still leave the whole worse. These
principles are what a change is checked against. When a change and a
principle disagree, the change gives way, or the pull request changes
this page and says why.

## Nothing changes on the IBM i unless the user asks

Spooldoc reads what programs already print. It installs nothing and asks
for no program changes. It creates a data queue only when the user turns
on real-time watching, and it holds, moves or deletes a spooled file only
as the job's finish step says.

In practice:

- An action that changes the IBM i is named in the UI before it happens:
  the object, and what will be done to it.
- An action that destroys something on the IBM i, such as deleting
  spooled files, asks for confirmation when it goes live.
- When Spooldoc lacks an authority, it says which one and gives the
  command an operator can run. It does not ask for more authority than
  the job needs.

## Reading and layout stay apart

A definition reads pages into JSON. A template lays out that JSON. A
template never sees lines and columns, and a definition never knows what
the document looks like.

In practice:

- Values are typed once, in the definition. Templates format them.
- New output formats and destinations take the same JSON. Nothing
  downstream reads the spooled file again.
- The extraction can be checked before anything is rendered.

## Every spooled file becomes a document, or the user can see why not

Spooldoc stands between a program and a customer waiting for an invoice.
A file that is quietly not delivered is the worst thing it can do.

In practice:

- No error is caught and dropped. It is logged, and when it affects a run
  or a queue, it shows in the Job log or in Needs attention.
- No list is cut off without saying so.
- A run that stops part way is marked failed with the reason, soon, not
  hours later.
- A fallback, such as real-time watching dropping to polling, is shown,
  not just taken.

## Speak IBM i, in the user's terms

The people who run Spooldoc know their system. Messages use their words:
output queue, spooled file, user profile, library. Everything else is
plain English.

In practice:

- An IBM i error says what went wrong and what to do next: which object,
  which authority, which command fixes it. The original message text is
  kept for support, one step away, not in the headline.
- A timeout names the host and the ports to check.

## The page is the truth, and a person decides

The user checks every extracted value next to the page it came from. The
AI assistant proposes; it does not decide. What it writes is plain YAML
and HTML that a person can read, edit and keep without it.

In practice:

- Spooldoc works without a model. The assistant saves time, it is not a
  requirement.
- Values are masked before page text leaves the server, and the
  assistant panel says whether they are.
- Nothing the assistant proposes runs on the IBM i or goes live until the
  user saves and activates it.

## Show only what works

The app shows what it can do today. Plans live in the README and the
issues.

In practice:

- No "coming later" lists, disabled placeholders or settings that do
  nothing yet.
- A message never points to something that does not exist, such as an
  administrator page that is not there.

## One way to do a thing

The same thing looks, reads and behaves the same everywhere.

In practice:

- One component for each pattern: selects, empty states, loading states,
  confirmations. Look in `components/ui` and `components/page.tsx` before
  adding one.
- One word for each state and action. A paused job is "paused" in the
  list, the builder and the toast.
- Errors read "Could not ..." and say what to do. Success toasts say
  what was done and name the thing: "Deleted MYJOB", "Saved version 3".
- Every control works from the keyboard and reads in dark mode.

## Fewer features, finished

Adding is easier than reshaping, so it is the change to be wary of.
Before adding a feature, ask whether an existing one should change
instead.

In practice:

- A feature is done when its empty, loading and error states, its docs
  and its tests are done, not when the happy path works.
- A new setting needs a reason a default cannot cover.
- What to build next comes from real use, not from the order of a list.

## Writing

The UI and the docs are written the same way:

- Short sentences and plain words. No jargon where a plain word does.
- Sentence case for headings, buttons and menu items.
- No middle dot (`·`) as a separator. Use a comma, a line break or a
  separate element.
- Invented names only: `MYLIB`, `MYOUTQ`, `ibmi.example.com`. See
  [No real names](contributing.md#no-real-names).
