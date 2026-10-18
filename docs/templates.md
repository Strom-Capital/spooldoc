---
title: "Templates"
description: "The HTML templates that render each document, the filters and assets they can use, and how PDFs are laid out."
---

A template is an ordinary HTML page with [Nunjucks](https://mozilla.github.io/nunjucks/templating.html)
tags (Jinja syntax). Each document the definition extracts is rendered
through it once, to an HTML file, a PDF, or both, as the job's render step
says. Until you write one, the starter template renders the fields in a
header block and a table for each table, record or group.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/template-preview-dark.png">
    <img src="assets/template-preview-light.png" alt="The render step: the HTML template in an editor on the left and the rendered invoice preview on the right, with PDF and HTML output switches" width="900">
  </picture>
</p>
"Start from job" in the template editor's bar copies another job's
template, and on request its definition, into the draft; the
[AI assistant](ai-assistant.md) does the same when asked.

## The data

| Variable | What it is |
|----------|------------|
| `doc` | The document being rendered: the fields, tables, records and groups of the [definition](definitions.md). |
| `documents` | Every document of the spooled file, for page counts or totals. |
| `sample.splf` | The spooled file: `name`, `number`, `jobName`, `jobUser`, `jobNumber`. |

```html
<h1>Invoice {{ doc.invoiceNo }}</h1>
<p>{{ doc.customerName }}<br>{{ doc.invoiceDate | date }}</p>
<table>
  {% for line in doc.lines %}
  <tr><td>{{ line.item }}</td><td class="num">{{ line.amount | money("EUR") }}</td></tr>
  {% endfor %}
</table>
```

Values are HTML-escaped. `{% if doc.address2 %}...{% endif %}` leaves out
an empty line; a missing field renders as nothing, not as an error.

## Filters

| Filter | Example | Result |
|--------|---------|--------|
| `money` | `{{ 1234.5 \| money }}`, `{{ doc.total \| money("EUR") }}` | `1,234.50`, `1,234.50 EUR` |
| `date` | `{{ doc.invoiceDate \| date }}`, `{{ doc.invoiceDate \| date("yyyy-MM-dd") }}` | `01.10.2026`, `2026-10-01` |
| `pad` | `{{ doc.no \| pad(8) }}`, `{{ doc.no \| pad(8, "right", ".") }}` | Padded to eight characters on the left, or on the right with dots |

The built-in Nunjucks filters (`upper`, `round`, `join`, `sum`, ...) work
too.

## Logos, images and fonts

Templates cannot fetch anything: the PDF renderer blocks every network
request, so an `<img src="https://...">` stays empty. Upload the file on
the Assets page instead and print it with `asset('name')`, which embeds it
as a data URI:

```html
<img src="{{ asset('logo') }}" alt="" style="height: 18mm">
<style>
  @font-face { font-family: "Brand"; src: url("{{ asset('brand-font') }}"); }
  body { font-family: "Brand", sans-serif; }
</style>
```

An asset is an image (PNG, JPEG, GIF, WebP, SVG) or a font (WOFF2, WOFF,
TTF, OTF) of at most 5 MB, named with lowercase letters, digits, dashes
and underscores. The bytes decide the type, not the file name. Every
render carries the asset as base64, so keep logos and fonts small. The
Assets page shows which jobs print each asset, and an unknown name is a
render error. Fonts the container image has: Liberation, DejaVu and Noto.

## PDF layout

PDFs are printed on A4 by headless Chromium: portrait, or landscape when
the spooled file is wider than 160 columns. A template's own
`@page { size: ...; margin: ... }` wins. `printBackground` is on, so
backgrounds and borders print. Use `page-break-inside: avoid` on rows and
`page-break-before: always` between sections as you would for any print
stylesheet. A render that takes longer than 30 seconds fails.

PDF needs a Chrome or Chromium executable: `SPOOLDOC_CHROMIUM_PATH`, which
the container image sets. Without it the preview and the runs report that
PDF is unavailable, and HTML output still works.

## Files

Each document becomes a file named after the definition's `output.name`,
such as `invoice-260102.pdf` and `invoice-260102.html`, or after the
spooled file and a number when there is no name. See
[Destinations](destinations.md).

## Safety

Templates run on the server, so Nunjucks is guarded: a template cannot
reach `constructor`, `prototype` or the other names that lead from a value
to code, and the renderer returns errors instead of throwing. See
[Security](security.md).
