---
title: "Carbone"
description: "The Carbone server that renders every document: running it with Compose, connecting it in Settings, Carbone Cloud, and the Community and Enterprise editions."
---

Spooldoc renders every document with [Carbone](https://carbone.io): HTML
and PDF from an HTML [template](templates.md), DOCX and PDF from a Word
template. Carbone runs as your own
service, or you use Carbone Cloud. Spooldoc only calls it over HTTP; it
never bundles or hosts Carbone. Without a working Carbone server there is
nothing to render, so the job builder and the setup checklist on Home say
what to do.

## With Compose

The [Compose file](deployment.md) runs Carbone next to Spooldoc as the
`carbone` service: the `carbone/carbone-ee` image on a pinned
`full-...-fonts` tag, which has the converters and a wide set of fonts.
Its port 4000 is reachable only inside the Compose network, at
`http://carbone:4000`, which is Spooldoc's default.

Carbone runs with `CARBONE_AUTHENTICATION=true`: it accepts a request only
when it carries a token signed with Spooldoc's own key. Spooldoc makes the
key pair the first time it starts and keeps the private key encrypted in
its database. To give Carbone the public key:

1. Open Settings. Under Rendering, copy Spooldoc's public key. It is one
   line, with its newlines written as `\n`.
2. Put it in `.env` next to `compose.yaml`:

   ```sh
   CARBONE_AUTHENTICATION_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\nMIGbMBAGByqGSM49...\n-----END PUBLIC KEY-----
   ```

   Keep the `\n` as written. A real line break makes Carbone exit when it
   starts.
3. Restart Carbone with `docker compose up -d carbone`.
4. Click Check again under Rendering.

Each token is valid for five minutes. When `SPOOLDOC_SECRET_KEY` changes,
the private key can't be read any more: Spooldoc makes a new pair, and
Carbone needs the new public key.

## Settings

Settings has a Rendering section, the only place the connection is set:

| Setting | What it is |
|---------|------------|
| Carbone on-prem | The URL of your Carbone server, `http://carbone:4000` by default. The Spooldoc server calls it, so it must be reachable from there. |
| Carbone Cloud | Your own API key from your Carbone account, stored encrypted with `SPOOLDOC_SECRET_KEY` and never shown again. |

Rendering shows whether the connection works, the Carbone version and the
edition. Spooldoc checks the connection when it starts, after each change
to the section, every ten minutes and when you click Check again. A render
that can't reach Carbone, or that Carbone refuses, shows at once.

With Carbone Cloud, the data of each document goes to Carbone's servers
to be rendered, and each document counts toward your Carbone plan. See
[Security](security.md#carbone).

## Community and Enterprise

Carbone's Community Edition is free to run on-prem and renders everything
the [starter template](templates.md) and the template docs use: tags,
loops, conditions, `formatN`, `formatD` and the other formatters, `:set`,
PDF headers and footers, and Word templates. Carbone's team said running it as a service
that Spooldoc calls appears consistent with the Carbone Community License.

A licence for Carbone Enterprise adds, among others:

| Feature | Example |
|---------|---------|
| Aggregators | `{d.pageGroup.lines[].amount:aggSum:formatN(2)}` |
| Dropping an element | `{d.pageGroup.lines[i].amount:ifEM:drop(row)}` |
| HTML from the data | `{d.pageGroup.note:html}` |
| Barcodes and QR codes | `<img src="{d.pageGroup.invoiceNo:barcode(qrcode)}">` |
| Colors from the data | `{d.pageGroup.status:color(row, background)}` |
| Charts | `<img src="{d.pageGroup.chart:chart}">` |
| Pictures from the data in a Word template | A logo per customer. On Community, Carbone keeps the template's picture without an error. |

Carbone Cloud has the Enterprise features.

`/status` does not say which edition a server runs, so Spooldoc renders a
one-line probe with `:aggSum`. Enterprise renders it; Community refuses it
with "disabled in the Community Edition". Spooldoc keeps the answer, shows
it in Settings, and tells the [agent](agent.md) not to use
Enterprise features on Community. Carbone Cloud is not probed, since each
probe there counts as a document. A template that uses an Enterprise
feature on Community fails with a message that names the feature.

To run Enterprise on-prem, put the licence in `CARBONE_LICENSE` in `.env`
and restart Carbone. A licence Carbone does not accept, and one that
expired, look exactly like no licence: Carbone starts as Community and
only its startup log says why. So when Settings shows Community Edition
and you have a licence, check Carbone's log with
`docker compose logs carbone`. Don't paste that log into an issue: with a
licence, it prints the licensee's name and email.

## Converters

Carbone makes a PDF with one of its converters. Spooldoc picks it:

| Template | Converter |
|----------|-----------|
| HTML | Chromium |
| Word | Carbone's own converter (ICE), the fastest |
| Word with cross-references (PAGEREF or REF fields) | LibreOffice, which works them out |

The `full` images have all three. A DOCX file is the Word template as
Carbone filled it in, with no converter. Spooldoc asks for it with
`hardRefresh` off: otherwise Carbone Enterprise passes a file with page
fields through LibreOffice, which rewrites its layout. Word fills in the
page fields when it opens the file.

## When Carbone stops working

A watched queue does not lose files while Carbone is down or refuses
Spooldoc. The watcher starts no runs, and new spooled files wait on the
queue. Each watching job says "New spooled files wait until Carbone works
again", with the reason, in its trigger step and under Needs attention on
Home. While files wait, Spooldoc checks Carbone again at most once a
minute. Once it works, the files run, oldest first. See
[Watching a queue](jobs.md#watching-a-queue).

Only the render that first finds Carbone down fails. Retry it from the
[Job log](job-log.md#retry).

## Errors

| Message | What to do |
|---------|------------|
| Could not reach Carbone at ... | Start the Carbone service, or fix the URL under Rendering. |
| Carbone refused Spooldoc's token ... | Set `CARBONE_AUTHENTICATION_PUBLIC_KEY` to the public key under Rendering and restart Carbone. |
| Carbone Cloud refused the API key ... | Check the key under Rendering. |
| Carbone at ... did not answer within 30 s | The server is down or overloaded. A render waits 30 seconds at most. |
| The template uses :aggSum, which needs Carbone Enterprise ... | Remove the feature, or use a server with an Enterprise licence. |

Template errors, such as a loop without its `[i+1]` row, are on the
[Templates](templates.md#the-check-before-each-render) page. Carbone's own
text is kept under Details for support.
