---
title: "Definitions"
description: "The YAML that tells Spooldoc which spooled files a job is for, how to split them into page groups and how to read their pages."
---

A definition is a YAML document, one per document type. It says which
spooled files it is for, how the pages are laid out, where each field is,
which lines are table rows, and how the pages split into page groups,
such as one invoice each. The extraction turns every spooled file that
matches into one JSON object per page group, which each
[template](templates.md) makes into a document. The JSON is the contract
between reading the page and laying out the document; the
[FAQ](faq.md#why-turn-the-pages-into-json-first-instead-of-rendering-straight-from-the-spooled-file)
says why.

The [agent](agent.md) writes the first definition from a
sample; this page is what it, and you, work with. The workbench checks the
YAML as you type and highlights every field hit on the page. Hover a hit
for its page group, the tag a template writes for it and its value, such
as "Page group 2: d.pg.invoiceNo = 260102".

## An example

The invoice fixture in `packages/core/fixtures/invoice`: six invoices
printed back to back, each from a new page, some continuing on a second
page.

```yaml
type: invoice
version: 1
match:
  splf: SPDINVOICE
  userData: INVOICE
  page1: "^\\S.*\\bINVOICE$"
source: text
text:
  page: { width: 132, length: 66 }
  header: { lines: 5 }
  footer: { fromLine: 60 }
  split: { field: invoiceNo }
  fields:
    - { name: invoiceNo, anchor: { after: "Invoice no.......:" } }
    - { name: invoiceDate, anchor: { after: "Invoice date.....:" }, type: date }
    - { name: customerName, anchor: { line: 9, column: 5, length: 40 } }
    - { name: netAmount, anchor: { after: "Net amount" }, page: last, type: number }
    - { name: vatRate, anchor: { regex: "VAT ([\\d.,]+) %" }, page: last, type: number }
  tables:
    - name: lines
      header: { pattern: "^Line\\s+Item\\s+Description" }
      until: { pattern: "^\\s{40,}\\S" }
      skip: { pattern: "^-{10,}|^\\s+Delivery note" }
      columns:
        - { name: line, column: 1, length: 4, type: number }
        - { name: item, column: 7, length: 10 }
        - { name: description, column: 19, length: 36 }
        - { name: quantity, column: 55, length: 8, type: number }
        - { name: amount, column: 91, length: 20, type: number }
output:
  name: "invoice-{d.pg.invoiceNo}"
  title: Invoice
```

The result for one invoice:

```json
{
  "invoiceNo": "260101",
  "invoiceDate": "2026-10-01",
  "customerName": "NORTHERN SUPPLY CO",
  "netAmount": 1234.5,
  "vatRate": 25.5,
  "lines": [
    { "line": 10, "item": "A-1001", "description": "BRACKET 40MM", "quantity": 12, "amount": 94.8 }
  ]
}
```

## Top level

| Key | What it is |
|-----|------------|
| `type` | The document type: lowercase letters, digits and dashes, at most 64 characters. |
| `version` | Always `1`. |
| `match` | Which spooled files this definition is for. See [Matching](#matching). |
| `source` | `text` for printed pages, `xml` for a spooled file that holds XML. |
| `text` | The page layout and what to read, with `source: text`. |
| `xml` | The element paths, with `source: xml`. |
| `output` | `name`, the file name of each document, with tags for its fields such as `invoice-{d.pg.invoiceNo}` (plain tags, no formatters), and `title`, the heading the starter template uses. Without `name` the files are named after the spooled file and numbered. |

Names of fields, tables, records and columns use letters, digits and
underscores and start with a letter; they become the keys of the JSON.

## Matching

Every key of `match` is optional, and a file must pass all of them. A run
on a file that does not match ends as skipped and leaves the file alone,
so a job on a mixed queue takes only its own files.

| Key | Matches |
|-----|---------|
| `splf` | The spooled file name |
| `queue` | The output queue name |
| `userData` | The `USRDTA` attribute |
| `page1` | A regular expression tested against the text of page 1 |

## Text sources

| Key | What it is |
|-----|------------|
| `page` | `width` and `length` in columns and lines, as printed. |
| `skipFirstPage` | `true` when page 1 is a parameter or banner page that belongs to no page group. |
| `header` | `lines`: how many lines at the top of every page repeat. They are left out of the page body that tables and records are read from. |
| `footer` | `fromLine`: the first line of the footer on every page; the body ends before it. |
| `split` | `field`: the pages split into a new page group wherever this field's value changes. Without `split`, the whole spooled file is one page group. Spooldoc finds page groups with `split`; it does not read the page groups a program marks with the DDS keywords `STRPAGGRP` and `ENDPAGGRP`. |
| `fields` | Single values. See [Fields](#fields). |
| `tables` | Column tables under a header line. See [Tables](#tables). |
| `records` | Repeating records that span several printed lines. See [Records](#records). |

### Fields

A field is a `name`, an `anchor` that says where the value is, an optional
`page` and an optional `type`.

An anchor is exactly one of:

| Anchor | How the value is found |
|--------|------------------------|
| `{ after: "Label", length? }` | The text that follows the label on the same line, to the end of the line or for `length` characters. |
| `{ regex: "...", group? }` | A regular expression tested line by line; the first match on the page wins. The value is capture group 1, or `group`, or the whole match when there are no groups. |
| `{ line, column, length }` | A fixed position: 1-based line and column, and the length. Use it for blocks where a missing value prints as a blank line, such as address lines. |

`page` says which page of the page group the field is read from: `first`
(the default), `last` (totals), `all` (the first match on any page) or a
page number.

`type` is `string` (the default, trimmed), `number` or `date`. Numbers
accept thousands separators, either decimal mark and a trailing minus
(`1,234.50`, `1 234,50`, `12.50-`). Dates accept `YYYY-MM-DD`,
`DD.MM.YYYY` and `D.M.YYYY` and are returned as `YYYY-MM-DD`. A value that
does not convert is reported as a problem on the page and in the
extraction report.

### Tables

A table starts on the line after the one that matches `header` and runs to
the end of the page body, or until the first line that matches `until`.
Lines that match `skip` inside the table are not rows: rules, notes,
delivery note lines. Each `column` is read from a fixed `column` and
`length` on the row, with an optional `type`. A table that continues on the
next page of the same page group is read on every page and the rows are
joined.

### Records

A record is for reports where one item spans several printed lines. A line
that matches `start` begins a record of `lines` printed lines, and each
column names the `line` within the record, the `column` and the `length`.

## XML sources

Some forms products print one XML document per page group. With
`source: xml`, the text of the pages is parsed as XML, and each element
named by `pageGroup` is one page group:

```yaml
type: picklist
version: 1
source: xml
xml:
  pageGroup: FORM
  fields:
    pickListNo: DOCUMENT/PICKLIST_NO
    shipDate: { path: DOCUMENT/SHIP_DATE, type: date }
  groups:
    lines:
      path: DOCUMENT/LINES/LINE
      map:
        item: ITEM
        quantity: { path: QTY, type: number }
```

| Key | What it is |
|-----|------------|
| `pageGroup` | The element that holds one page group. Each occurrence is one page group. |
| `fields` | Field name to a slash path from the root, as a string or `{ path, type }`. |
| `groups` | Repeating elements: `path` from the root, and `map` from item field name to a path under each element. |

## Checking a definition

The workbench shows every hit on the page and the JSON beside it. The
extraction report, which the agent reads after every write, lists the
page groups found, each field of the first page group with its status, the
missing fields and warnings such as a table with no rows. The core package
exports the same schema as JSON Schema, so an editor can check the YAML
too.
