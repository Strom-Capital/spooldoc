# Documentation

These guides cover installing, using and deploying Spooldoc. For the
overview and the architecture diagram, see the [project README](../README.md).

## Get started

| Guide | What it covers |
|-------|----------------|
| [Getting started](getting-started.md) | Install, first account, first job |
| [FAQ](faq.md) | Short answers to common questions |

## Use Spooldoc

| Guide | What it covers |
|-------|----------------|
| [Servers](servers.md) | IBM i systems, credentials, libraries, allowed hosts |
| [Queues](queues.md) | Output queues and spooled files |
| [Jobs](jobs.md) | The job builder, versions, triggers, finish actions |
| [Definitions](definitions.md) | The YAML that turns pages into JSON |
| [Templates](templates.md) | HTML, Word and Excel templates with Carbone tags, the template check, assets, PDF layout |
| [Agent](agent.md) | Models, tools, masking |
| [Destinations](destinations.md) | Where documents go |
| [Job log](job-log.md) | Runs, statuses, retry, retention |
| [Profile](profile.md) | Your name, password and theme |

## Run Spooldoc

| Guide | What it covers |
|-------|----------------|
| [Carbone](carbone.md) | The Carbone server, Settings, Community and Enterprise |
| [Configuration](configuration.md) | Environment variables and settings |
| [Deployment](deployment.md) | Docker, Compose, ports, backups, upgrades |
| [Security](security.md) | What the model sees, what is stored, how |

## Develop

| Guide | What it covers |
|-------|----------------|
| [Architecture](architecture.md) | What happens in a run, the packages, the data |
| [Principles](principles.md) | What every change is checked against |
| [Contributing](contributing.md) | Development setup, tests, conventions |

The app serves these pages at `/docs`, for the version it runs, with this
page's groups as its sidebar. Each page starts with a `title` and
`description` header in place of a `#` heading. Links between guides use
the file name, such as `[Versions](jobs.md#versions)`, so they work on
GitHub too.
