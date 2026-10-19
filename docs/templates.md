---
title: "Templates"
description: "The HTML templates that render each document with Carbone tags, the check Spooldoc runs before each render, assets, and how PDFs are laid out."
---

A template is an ordinary HTML page with [Carbone](https://carbone.io)
tags, such as `{d.doc.invoiceNo}`. Each output of a job has its own
template. Each document the definition extracts is rendered through it
once, to an HTML file, a PDF, or both, as the output's formats say. Until
you write one, the starter template renders the fields in a header block
and a table for each table, record or group. See [Outputs](jobs.md#outputs).

Spooldoc renders every document with a Carbone server, your own or Carbone
Cloud. See [Carbone](carbone.md) to set one up.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/template-preview-dark.png">
    <img src="assets/template-preview-light.png" alt="The render step of a job with two outputs: the Document output picked, with its PDF and HTML switches and Add output, its HTML template in an editor on the left and the rendered invoice preview on the right" width="900">
  </picture>
</p>

"Start from job" in the template editor's bar copies another job's
template into the output shown, and on request its definition into the
draft. When the other job has more than one output, pick the one to copy.
The [AI assistant](ai-assistant.md) does the same when asked.

## The data

A tag starts with `d`, the data of the document being rendered:

| Path | What it is |
|------|------------|
| `d.doc` | The document being rendered: the fields, tables, records and groups of the [definition](definitions.md). |
| `d.documents` | Every document of the spooled file, for page counts or totals. Sent only to templates that use it. |
| `d.sample.splf` | The spooled file: `name`, `number`, `jobName`, `jobUser`, `jobNumber`. |

```html
<h1>Invoice {d.doc.invoiceNo}</h1>
<p>{d.doc.customerName}<br>{d.doc.invoiceDate:formatD('DD.MM.YYYY')}</p>
<table>
  <tr><td>{d.doc.lines[i].item}</td><td class="num">{d.doc.lines[i].amount:formatN(2)} EUR</td></tr>
  <tr><td>{d.doc.lines[i+1]}</td></tr>
</table>
```

Values are HTML-escaped. A missing field renders as nothing.

## Loops

A row with `[i]` tags repeats for each item of a list. The row after it,
with an `[i+1]` tag, marks where the loop ends; Carbone removes it.

```html
<tbody>
  <tr><td>{d.doc.lines[i].line}</td><td>{d.doc.lines[i].item}</td></tr>
  <tr><td>{d.doc.lines[i+1]}</td></tr>
</tbody>
```

The same works for `<li>`, `<div>` or any other element. A loop without
its `[i+1]` row is an error.

## Conditions

`showBegin` and `showEnd` keep a part only when the condition holds:

```html
{d.doc.address2:ifNEM:showBegin}{d.doc.address2}<br>{d.doc.address2:showEnd}
{d.doc.type:ifEQ('C'):showBegin}<h2>Credit note</h2>{d.doc.type:showEnd}
```

`ifNEM` is "not empty"; `ifEM`, `ifEQ`, `ifNE`, `ifGT`, `ifGTE`, `ifLT` and
`ifLTE` work the same way. `hideBegin` and `hideEnd` do the opposite.

## Formatters

Formatters follow the path, each after a colon:

| Formatter | Example | Result |
|-----------|---------|--------|
| `formatN` | `{d.doc.total:formatN(2)}` | `1,234.50` |
| `formatD` | `{d.doc.invoiceDate:formatD('DD.MM.YYYY')}`, `{d.doc.invoiceDate:formatD('YYYY-MM-DD')}` | `01.10.2026`, `2026-10-01` |
| `padl`, `padr` | `{d.doc.no:padl(8)}`, `{d.doc.no:padr(8, '.')}` | Padded to eight characters on the left, or on the right with dots |
| `upperCase`, `lowerCase` | `{d.doc.city:upperCase}` | `HELSINKI` |

Numbers use English separators. Write a currency after the tag, as in
`{d.doc.total:formatN(2)} EUR`, or from the data:
`{d.doc.total:formatN(2)} {d.doc.currency}`. `formatN` without a number
shows three decimals.

Inside a tag, quote text with straight single quotes. Carbone prints
double quotes and curly quotes as text, so the check below refuses them.

Carbone has many more formatters, loops with filters and sorting, and
aliases. See [Carbone's documentation](https://carbone.io/documentation/design/overview/getting-started.html).
Some of them, such as aggregators (`:aggSum`), `:drop` and `:barcode`, need
Carbone Enterprise. See [Community and Enterprise](carbone.md#community-and-enterprise).

## The check before each render

Carbone renders some mistakes without an error: it prints nothing for a
field that is not in the data, and prints quotes it does not accept. So
Spooldoc checks each template before it renders, and the Template tab
lists each problem with its line:

- a tag whose field is not in the definition, such as `{d.doc.invoiceNumber}`,
  with the field it most likely means;
- double quotes or curly quotes inside a tag;
- Nunjucks left over, such as `{{ doc.x }}` or `{% for %}`;
- a tag that is never closed;
- an asset name that is not uploaded.

A template with problems is not rendered, in the preview or in a run.
Carbone's own errors, such as a loop without an `[i+1]` row or a
formatter it does not have, show with Spooldoc's message on top and
Carbone's text under Details.

## Templates from before Carbone

Spooldoc 0.2 and older used [Nunjucks](https://mozilla.github.io/nunjucks/)
tags. A Nunjucks template is converted to Carbone tags when Spooldoc reads
it, for the common cases:

| Nunjucks | Carbone |
|----------|---------|
| `{{ doc.invoiceNo }}` | `{d.doc.invoiceNo}` |
| `{% for row in doc.lines %}<tr>...</tr>{% endfor %}` | an `[i]` row and an `[i+1]` row |
| `{% if doc.address2 %}...{% else %}...{% endif %}` | `showBegin` and `showEnd` |
| `money`, `money("EUR")` | `:formatN(2)`, followed by ` EUR` |
| `date`, `date("yyyy-MM-dd")` | `:formatD('DD.MM.YYYY')`, `:formatD('YYYY-MM-DD')` |
| `pad(8)`, `pad(8, "right", ".")` | `:padl(8)`, `:padr(8, '.')` |
| `upper`, `lower` | `:upperCase`, `:lowerCase` |
| `asset('logo')` | `{asset('logo')}` |
| `{# note #}` | `<!-- note -->` |

Anything the converter can't map stays as it was, and the check lists its
lines: a loop over more than one element, `elif`, `and` and `or`, `set`,
`loop.index`, and other filters. Fix those by hand. A job's draft keeps
the converted template once you save it.

## Logos, images and fonts

Templates cannot fetch anything, so an `<img src="https://...">` may stay
empty. Upload the file on the Assets page instead and print it with
`{asset('name')}`, which Spooldoc writes into the template as a data URI
before it sends it to Carbone:

```html
<img src="{asset('logo')}" alt="" style="height: 18mm">
<style>
  @font-face { font-family: "Brand"; src: url("{asset('brand-font')}"); }
  body { font-family: "Brand", sans-serif; }
</style>
```

An asset is an image (PNG, JPEG, GIF, WebP, SVG) or a font (WOFF2, WOFF,
TTF, OTF) of at most 5 MB, named with lowercase letters, digits, dashes
and underscores. The bytes decide the type, not the file name. Every
render carries the asset as base64, so keep logos and fonts small. The
Assets page shows which jobs print each asset, and an unknown name is a
problem the check reports. The fonts the Carbone container has depend on
its image; the `full-...-fonts` image in the Compose file has a wide set.

## PDF layout

PDFs are printed on A4 by Carbone's Chromium converter: portrait, or
landscape when the spooled file is wider than 160 columns. A template's
own `@page { size: ...; margin: ... }` wins. Backgrounds and borders
print. Use `page-break-inside: avoid` on rows and `page-break-before:
always` between sections as you would for any print stylesheet.

For a header and footer on every page, with page numbers, use Carbone's
`<carbone-pdf-header>` and `<carbone-pdf-footer>` elements. They print in
the PDF only: Spooldoc hides them in HTML output.

```html
<carbone-pdf-footer>
  <div style="font-size: 8pt; width: 100%; text-align: center">
    Invoice {d.doc.invoiceNo}, page <span class="pageNumber"></span> of <span class="totalPages"></span>
  </div>
</carbone-pdf-footer>
```

## Files

Each document becomes a file named after the definition's `output.name`,
such as `invoice-260102.pdf` and `invoice-260102.html`, or after the
spooled file and a number when there is no name. The files of every
output but the first add the output's name: `invoice-260102-lines.pdf`
for an output named Lines. See [Destinations](destinations.md).

A template with problems fails the run, and the error names the output
and the lines: `The "Lines" output's template has 1 problem. Line 12: ...`.
An error from Carbone names the output and the document.
