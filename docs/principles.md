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
as the job's finish step says. It writes files to the IFS only through an
IFS destination the user set up, and only in the folder chosen there.

In practice:

- An action that changes the IBM i is named in the UI before it happens:
  the object, and what will be done to it.
- An action that destroys something on the IBM i, such as deleting
  spooled files, asks for confirmation when it goes live.
- When Spooldoc lacks an authority, it says which one and gives the
  command an operator can run. It does not ask for more authority than
  the job needs.
- An IFS destination never creates the folder. It writes each file under
  a temporary name and renames it when it is complete, so a program that
  watches the folder sees whole files only. A file with the same name is
  replaced, kept with a new number, or fails the run, as the destination
  says. To replace one, the old file is renamed aside to a name that ends
  in `.old`, and deleted once the new one is in place, so a failed write
  never loses both. See [IFS folder](destinations.md#ifs-folder).

## Reading and layout stay apart

A definition reads pages into JSON. A template lays out that JSON. A
template never sees lines and columns, and a definition never knows what
the document looks like.

The one exception is the Excel template of the whole spooled file. Every
other template lays out one page group at a time; this one gets every
page group at once and makes one workbook with a row per table line, the
flat sheet people filter and sum. It still reads the JSON, not the
printed lines and columns. See
[What each file holds](templates.md#what-each-file-holds).

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
output queue, spooled file, user profile, library. IBM i terms are not
jargon to them. Everything else is plain English.

In practice:

- An IBM i error says what went wrong and what to do next: which object,
  which authority, which command fixes it. The original message text is
  kept for support, one step away, not in the headline.
- A timeout names the host and the ports to check.

## The page is the truth, and a person decides

The user checks every extracted value next to the page it came from. The
agent proposes; it does not decide. What it writes is plain YAML, HTML,
and Word and Excel files that a person can read, edit and keep without it.

In practice:

- Spooldoc works without a model. The agent saves time, it is not a
  requirement.
- A Word template the agent makes is an ordinary `.docx` the user
  opens and changes in Word, made of Word's own paragraphs, tables and
  styles. An Excel template is an ordinary `.xlsx` of Excel's own cells,
  styles and formulas, which the user opens and keeps working on in
  Excel. The agent designs both as data that Spooldoc builds; no code
  the model writes runs on the server.
- The agent never overwrites what the user made. A Word or Excel file it
  writes or edits is a new file, and the earlier one stays to go back to.
- Where values go is the user's choice, made in Settings and shown in
  the agent panel: as printed, so the model can read them, or masked
  before page text leaves the server. A local model keeps them on the
  user's network either way.
- Nothing the agent proposes runs on the IBM i or goes live until the
  user saves and activates it.

## Show only what works

The app and the guides under `docs/` describe what Spooldoc does today.
Plans live only in the [README](../README.md#status) Status section and in
the issues.

In practice:

- No "coming later" lists, disabled placeholders or settings that do
  nothing yet. A guide says what works, not what is planned; at most it
  links to the README Status section.
- A message never points to something that does not exist, such as an
  administrator page that is not there.

## One way to do a thing

The same thing looks, reads and behaves the same everywhere.

In practice:

- One component for each pattern: selects, empty states, loading states,
  confirmations, hints. Look in `components/ui`, `components/page.tsx`,
  `components/empty-state.tsx` and `components/hint.tsx` before adding
  one. A list loads with
  `Loading`; a table already on screen keeps its shape with `SkeletonRows`.
- A table row works the same in every table. A click on the row, or on
  its name, opens it. At most two actions show on the row, the ones people
  come to that table for: quiet ghost buttons with an icon and a label.
  An action only some rows have goes first, so the ones every row has
  line up. The ⋯ menu at the end of the row holds every row action, those
  included and in the same order, with destructive ones last after a
  separator.
- One word for each state and action. A paused job is "paused" in the
  list, the builder and the toast.
- Errors read "Could not ..." and say what to do. Success toasts say
  what was done and name the thing: "Deleted MYJOB", "Saved version 3".
- A button whose label alone does not say what it does, or that is
  disabled, has a hint made with `Hint` (`components/hint.tsx`): what it
  does, what it changes and whether that can be undone, or why it is
  disabled. Every icon-only button has a hint and an `aria-label`. A hint
  that only repeats the label is left out.
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

- Short sentences and plain words. One idea per sentence.
- Sentence case for headings, buttons and menu items.
- No middle dot (`·`) as a separator. Use a comma, a line break or a
  separate element.
- No em or en dashes in prose, not even in ranges: write "2025 to 2028".
  Use a period, a comma, a colon or parentheses instead. Hyphens inside
  words, such as read-only, are fine.
- American spelling: license, color, behavior, organize.
- IBM i terms are not jargon to our readers. Write `*SCS`, CCSID and user
  profile. In prose, write output queue, not OUTQ, and spooled file, not
  splf.
- One word for each thing: spooled file, output queue, definition,
  template, page group, job, run, destination, job log.
- The feature is "the agent", never "assistant" or "copilot", and it has
  no sparkle icon. "AI" is a plain fact, such as "the agent uses an AI
  model you choose", at most once or twice on a page and never a label.
- Invented names only: `MYLIB`, `MYOUTQ`, `ibmi.example.com`. See
  [No real names](contributing.md#no-real-names).
