---
title: "AI assistant"
description: "The chat beside the job builder: which models it uses, what it can do and what it sees."
---

The AI assistant sits beside the workbench in the job builder. Ask it for a
definition and it reads the sample pages, writes the YAML to the job's
draft, reads the extraction report, fixes missing fields, then writes a
template and renders it. The page view, the JSON and the preview update as
it works, and everything it writes can be edited by hand. Without a model
set, the job builder works as before and the assistant points to Settings.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/ai-assistant-dark.png">
    <img src="assets/ai-assistant-light.png" alt="The AI assistant panel beside the workbench, with suggested prompts, the Values masked badge and the model name under the message box" width="900">
  </picture>
</p>

## Choosing a model

Under Settings, AI model, with no restart:

| Setting | What it is |
|---------|------------|
| Provider | Anthropic, Google, OpenAI, OpenRouter, Vercel AI Gateway, or a local model behind an OpenAI-compatible endpoint (Ollama, LM Studio, vLLM) with its base URL. |
| API key | The provider's key, stored encrypted. Optional for a local model. |
| Model | One of the suggested models, or any model id the provider offers. |
| Effort | How much the model reasons before it answers, from None to Max, or the provider's default. Models that do not reason ignore it. |

Each provider keeps its own key, model and effort, so switching back is
one click. None (chat off) turns the assistant off and keeps every
provider's settings. Any signed-in user can set or replace a key, but no
request can read one back.

## What it can do

The assistant works through nine tools: six on the job's draft and its
preview sample, two that read other jobs' files, and one that reads the
Carbone syntax reference:

| Tool | What it does |
|------|--------------|
| `read_sample_page` | Reads one page of the sample as numbered lines. The first three pages are in its instructions already. |
| `write_definition` | Saves the definition YAML to the draft, runs the extraction on the sample and returns the report: documents found, each field with its status, missing fields, warnings and the first document as JSON. |
| `write_template` | Saves the HTML template of one [output](jobs.md#outputs), the first unless it names another, checks it, renders the first document with Carbone and returns any errors, by line, and its visible text. Without a working Carbone server it only checks. It refuses an output with a Word template. |
| `render_preview` | Renders a document with one output's template, HTML or Word, again after a change to the definition, and returns what the check finds and the visible text. |
| `add_output` | Adds an output with an HTML template, a name and formats. It uses the starter template until the assistant writes one. |
| `remove_output` | Removes an output and its template. The last output cannot be removed. |
| `list_jobs` | Lists the other jobs with their definition type, outputs and whether they have a template. |
| `read_job_files` | Reads another job's definition YAML and the template HTML of each of its outputs, from its active version or else its draft, so a new job can start from them. |
| `read_carbone_reference` | Reads one reference file of the Carbone syntax reference, such as the list of formatters. |

The model adds or removes outputs only when you ask for it. It uses the
last two tools only when you ask it to start from or reuse another job ("start from the Invoices job's template"); it adapts what it
takes to the sample and saves it with the write tools. The same copy
without a model is "Start from job" in the template editor's bar.

No tool reaches the IBM i, the job log or any other spooled file, and
nothing it writes is a version: save one yourself when the result is
right.

The assistant does not change a [Word template](templates.md#word-templates):
only you do, in Word. It reads the template's text, checks its tags
against the definition, explains render errors and suggests tags to type
or paste in.

The assistant writes [Carbone tags](templates.md). Its instructions hold
the [Carbone Skill](https://github.com/carboneio/carbone-skill) by Carbone
(Apache License 2.0) as the syntax reference, and say which Carbone
features the connected server has: on the Community Edition it leaves out
Enterprise features such as `:aggSum`. See [Carbone](carbone.md).

## What it sees

What the model receives:

- The page text of the job's preview sample: the first three pages (up to
  400 lines) in the instructions, any other page on request.
- The sample's metadata: spooled file name, queue, user data, page size
  and code page.
- The job's current definition, its outputs with their formats and
  templates (the text of a Word template, paragraph by paragraph), the
  names of the uploaded assets, and the Carbone edition.
- Tool results: the extraction report and the rendered text.
- On request, other jobs' definitions and templates: layout, not
  customer data. Nothing else of a job (its server, destination, finish
  settings, runs or samples) is readable.

What it never receives: IBM i credentials, the login session, the IBM i
connection, other spooled files, or the job log.

## The conversation

Each job keeps one conversation with the assistant, stored with the job
and shown again when you come back to the job builder; it is deleted with
the job. New chat in the panel header forgets it and starts another, while
the definition and template it wrote stay in the draft. Only the recent
part of a long conversation goes to the model with each message (the last
20 messages, within a character budget, older tool results dropped first);
the model's instructions carry the current definition, outputs,
templates and sample pages, so nothing it needs is lost. The stored messages hold what
the model saw: with masking on, the tool results are masked too.

## Masking

Masking is on by default (`SPOOLDOC_MASK=true`): before page text or a
tool result goes to the model, digits become `9` and letters `X` or `x`,
while labels that repeat across pages, positions and lengths stay as
printed. The model sees the layout, not the customer. The chat panel shows
"Values masked", or "Values sent in clear" with `SPOOLDOC_MASK=false`.
What the model writes, and the job builder itself, use the real values.

A hosted provider processes what it receives under its own terms; a local
model keeps it on your network. A local model's base URL is called by the
server, so only enter one you trust. See [Security](security.md).
