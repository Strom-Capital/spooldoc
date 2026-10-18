<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/spooldoc-horizontal-dark.svg">
    <img src="docs/assets/brand/spooldoc-horizontal-light.svg" alt="Spooldoc logo: a stack of fanfold pages with a folded blue corner, next to the Spooldoc wordmark" width="320">
  </picture>
</p>

# Spooldoc

[![CI](https://github.com/Strom-Capital/spooldoc/actions/workflows/ci.yml/badge.svg)](https://github.com/Strom-Capital/spooldoc/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![IBM i](https://img.shields.io/badge/IBM%20i-7.4+-green?logo=ibm&logoColor=white)](https://www.ibm.com/products/ibm-i)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-green?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-supported-blue?logo=docker&logoColor=white)](docs/deployment.md)

Spooled files into documents, for IBM i. Open output management.

Spooldoc watches the output queues of your IBM i, turns each spooled file
into a JSON document with a definition you write in YAML, renders it with an
ordinary HTML template into PDF or HTML, and delivers the files. The JSON
keeps reading the page and laying out the document apart, so a template
never deals with lines and columns and a new look is just a new template. An AI
assistant proposes the definition and the template from a sample spooled
file; you check the extracted fields next to the page and refine by chat or
by hand. Every run is logged.

## Architecture

Programs on the IBM i print to output queues as they always have. Spooldoc
connects through jt400, lists the queues, and runs a job for every new
spooled file: in real time through a data queue on the output queue, or by
polling. A run reads the spooled file, parses the *SCS data, extracts the
documents, renders each one and delivers the files, then holds, moves,
deletes or leaves the spooled file. Everything Spooldoc keeps is in Postgres.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/architecture-dark.svg">
    <img src="docs/assets/architecture-light.svg" alt="Architecture: programs on the IBM i print to an output queue, optionally with a data queue; Spooldoc's watcher picks up new spooled files by polling or in real time, and a run captures, extracts, renders, delivers and finishes each one, reading and then holding, moving or deleting the file through jt400; the job builder and the AI assistant, which sends masked page text to a model provider, write to the same Postgres database that holds servers, jobs, versions, samples, runs, files and assets; delivered files go to a destination" width="1000">
  </picture>
</p>

## Features

- **Servers and queues**: add IBM i systems, pick the output queues that
  matter, hide the rest, and look at a spooled file page by page.
- **Jobs as pipelines**: source, trigger, extract, render, destination,
  finish. Saved as versions, run on demand or by watching the queue.
- **Definitions in YAML**: fields by label, pattern or position, tables,
  multi-line records, split keys for documents printed back to back, and
  XML-in-spool.
- **HTML templates**: Nunjucks templates with your logos, images and fonts,
  rendered to PDF in headless Chromium, or delivered as HTML.
- **AI assistant**: Anthropic, Google, OpenAI, OpenRouter, Vercel AI
  Gateway or a local model writes the first definition and template, reads
  the extraction report and fixes what is missing. Values are masked before
  page text leaves the server.
- **Job log**: every run with its steps, errors and files; retention you set.
- **One image**: web app, Java runtime and Chromium in one container, amd64
  and arm64.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/ai-assistant-dark.png">
    <img src="docs/assets/ai-assistant-light.png" alt="The job builder: the pipeline from source to finish across the top, the sample invoice page with every extracted field highlighted, the YAML definition beside it, and the AI assistant panel on the right" width="900">
  </picture>
</p>

## Quick start

With Docker:

```sh
git clone https://github.com/Strom-Capital/spooldoc.git && cd spooldoc
printf 'BETTER_AUTH_SECRET=%s\nSPOOLDOC_SECRET_KEY=%s\n' "$(openssl rand -base64 32)" "$(openssl rand -base64 32)" > .env
docker compose up --build -d
```

Open http://localhost:3000 and create the first account. Add a server,
open its queues, start a job from one, and let the assistant propose a
definition from a sample spooled file. See
[Getting started](docs/getting-started.md) for the whole first run, and
[Deployment](docs/deployment.md) for secrets, networking and backups.

To run from source instead, see [Contributing](docs/contributing.md).

## Documentation

| Guide | What it covers |
|-------|----------------|
| [Getting started](docs/getting-started.md) | Install, first account, first job |
| [Architecture](docs/architecture.md) | What happens in a run, the packages, the data |
| [Servers](docs/servers.md) | IBM i systems, credentials, libraries, allowed hosts |
| [Queues](docs/queues.md) | Output queues and spooled files |
| [Jobs](docs/jobs.md) | The job builder, versions, triggers, finish actions |
| [Definitions](docs/definitions.md) | The YAML that turns pages into JSON |
| [Templates](docs/templates.md) | HTML templates, filters, assets, PDF layout |
| [AI assistant](docs/ai-assistant.md) | Models, tools, masking |
| [Destinations](docs/destinations.md) | Where documents go |
| [Job log](docs/job-log.md) | Runs, statuses, retry, retention |
| [Configuration](docs/configuration.md) | Environment variables and settings |
| [Deployment](docs/deployment.md) | Docker, Compose, ports, backups, upgrades |
| [Security](docs/security.md) | What the model sees, what is stored, how |
| [FAQ](docs/faq.md) | Short answers to common questions |
| [Contributing](docs/contributing.md) | Development setup, tests, conventions |

## Status

Spooldoc is young. The web app, the *SCS parser, text and XML extraction,
HTML and PDF output and the Spooldoc download destination work and are
tested against demo spooled files captured from PUB400. Next: SFTP, S3,
IFS, email and webhook destinations, more users and roles, and DOCX and
XLSX output.

## License

[MIT](LICENSE).
