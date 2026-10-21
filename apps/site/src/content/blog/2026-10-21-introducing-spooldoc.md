---
title: "Spooldoc has a website"
description: "What Spooldoc does, who it is for, how to try it, and what you find on spooldoc.com."
date: 2026-10-21
tags: [announcement]
---

Spooldoc turns IBM i spooled files into documents. Programs print to their
output queues as they always have. Spooldoc reads each new spooled file,
makes PDF, HTML, Word or Excel documents of it, and delivers the files.
It is open source under the MIT license.

Until today it lived in its GitHub repository. Now it has a home at
spooldoc.com, with the docs, the features and this blog.

## What it does

A job takes the spooled files of one output queue to a destination, in six
steps: source, trigger, extract, render, destination and finish.

- **A definition reads the pages.** It is a short YAML document that finds
  fields by label, pattern or position, reads tables, and splits the pages
  into page groups, such as one invoice each. The result is JSON.
- **A template lays out the document.** HTML, Word or Excel, with Carbone
  tags. A template never sees lines and columns, so a new look is a new
  template and nothing else.
- **A destination takes the files.** Keep them in Spooldoc to download, or
  write them to a folder in the IFS.
- **The finish step** holds, moves, deletes or leaves the spooled file,
  only after every file was delivered.

Jobs run on demand, or watch the queue in real time or by polling. Every
run is in the job log with its steps, and a failed run says what to do.

<p align="center"><img data-theme-image="light" src="/docs/assets/ai-assistant-light.png" alt="The agent panel beside the workbench, with the suggested prompts and the message box" width="900" height="563"><img data-theme-image="dark" src="/docs/assets/ai-assistant-dark.png" alt="The agent panel beside the workbench, with the suggested prompts and the message box" width="900" height="563"></p>

The agent in the job builder can write the first definition and template
from a sample spooled file. You check every value next to the page it came
from, and nothing goes live until you save a version. Spooldoc also works
without a model.

## Who it is for

Teams that run an IBM i and print invoices, delivery notes, pick lists or
reports to output queues, and want them as documents without changing the
programs. Nothing is installed on the IBM i.

## How to try it

You need Docker and an IBM i 7.4 or later. A free PUB400 account works,
and the repository has programs that print invented demo documents there.

```sh
git clone https://github.com/Strom-Capital/spooldoc.git && cd spooldoc
printf 'BETTER_AUTH_SECRET=%s\nSPOOLDOC_SECRET_KEY=%s\n' "$(openssl rand -base64 32)" "$(openssl rand -base64 32)" > .env
docker compose up -d
```

Open http://localhost:3000, create the first account and add a server.
[Getting started](/docs/getting-started/) walks through the first job.

## On this site

- [Features](/features/): each feature in depth, with screenshots.
- [Docs](/docs/): the same guides the app shows, with search.
- [Blog](/blog/): posts like this one, and notes on releases. There is an
  [RSS feed](/rss.xml).

Questions and ideas are welcome in
[Discussions](https://github.com/Strom-Capital/spooldoc/discussions).
