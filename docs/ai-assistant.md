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

The assistant works through six tools: four on the job's draft and its
preview sample, two that read other jobs' files:

| Tool | What it does |
|------|--------------|
| `read_sample_page` | Reads one page of the sample as numbered lines. The first three pages are in its instructions already. |
| `write_definition` | Saves the definition YAML to the draft, runs the extraction on the sample and returns the report: documents found, each field with its status, missing fields, warnings and the first document as JSON. |
| `write_template` | Saves the HTML template to the draft, renders the first document and returns any errors and its visible text. |
| `render_preview` | Renders a document again after a change to the definition. |
| `list_jobs` | Lists the other jobs with their definition type and whether they have a template. |
| `read_job_files` | Reads another job's definition YAML and template HTML, from its active version or else its draft, so a new job can start from them. |

The model uses the last two only when you ask it to start from or reuse
another job ("start from the Invoices job's template"); it adapts what it
takes to the sample and saves it with the write tools. The same copy
without a model is "Start from job" in the template editor's bar.

No tool reaches the IBM i, the job log or any other spooled file, and
nothing it writes is a version: save one yourself when the result is
right.

## What it sees

What the model receives:

- The page text of the job's preview sample: the first three pages (up to
  400 lines) in the instructions, any other page on request.
- The sample's metadata: spooled file name, queue, user data, page size
  and code page.
- The job's current definition and template, and the names of the
  uploaded assets.
- Tool results: the extraction report and the rendered text.
- On request, other jobs' definitions and templates: layout, not
  customer data. Nothing else of a job (its server, destination, finish
  settings, runs or samples) is readable.

What it never receives: IBM i credentials, the login session, the IBM i
connection, other spooled files, or the job log.

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
