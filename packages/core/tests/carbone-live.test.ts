import { describe, expect, it } from "vitest";
import { carboneRender, carboneStatus, isCarboneError, probeEdition, type CarboneError } from "../src/carbone.js";
import { convertNunjucks } from "../src/convert.js";
import { extract } from "../src/extract.js";
import { renderDocument } from "../src/render.js";
import { checkTemplate } from "../src/tags.js";
import { starterTemplate, templateData } from "../src/template.js";
import { FIXTURES, fixtureText, loadFixture } from "./helpers/fixtures.js";

/**
 * Against a real Carbone server, when SPOOLDOC_CARBONE_URL is set, such as
 * `docker run --rm -p 4000:4000 carbone/carbone-ee:full-5.15.5` and
 * SPOOLDOC_CARBONE_URL=http://localhost:4000. Without authentication.
 */
const url = process.env.SPOOLDOC_CARBONE_URL;
const server = { url: url ?? "" };

/** Width and height in points of each page of a PDF, from its MediaBox entries. */
function pageSizes(pdf: Uint8Array): [number, number][] {
  const text = Buffer.from(pdf).toString("latin1");
  return [...text.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => [Number(m[3]) - Number(m[1]), Number(m[4]) - Number(m[2])]);
}

async function failure(promise: Promise<unknown>): Promise<CarboneError> {
  try {
    await promise;
  } catch (error) {
    if (isCarboneError(error)) return error;
    throw error;
  }
  throw new Error("expected a CarboneError");
}

describe.skipIf(!url)("Carbone server", () => {
  it("answers its status and the edition probe", async () => {
    expect((await carboneStatus(server)).version).toMatch(/^\d+\.\d+/);
    expect(["enterprise", "community"]).toContain(await probeEdition(server));
  });

  it.each(FIXTURES)("renders the %s fixture and starter templates to HTML and PDF", async (name) => {
    const { sample, definition, template } = loadFixture(name);
    const { documents } = extract(definition, sample);
    for (const html of [template, starterTemplate(definition)]) {
      expect(checkTemplate(html, definition)).toEqual([]);
      const data = templateData(html, documents[0]!, documents, sample);
      const out = Buffer.from(await renderDocument(server, { template: html, data, format: "html" })).toString();
      expect(out).not.toMatch(/\{d\./);
      const pdf = await renderDocument(server, { template: html, data, format: "pdf", pageWidth: sample.attributes.pageWidth });
      expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    }
  });

  it("renders the converted Nunjucks invoice like the original", async () => {
    const { sample, definition } = loadFixture("invoice");
    const { documents } = extract(definition, sample);
    const html = convertNunjucks(fixtureText("invoice", "template.nunjucks.html"));
    const out = Buffer.from(await renderDocument(server, { template: html, data: templateData(html, documents[2]!, documents, sample), format: "html" })).toString();
    expect(out).toContain("BAKER &amp; SONS LTD");
    expect(out).toContain("1,374.50 EUR");
    expect(out).toContain("15.10.2026");
    expect(out).not.toContain("Building");
    expect(out).toContain("carbone-pdf-header, carbone-pdf-footer, carbone-pdf-options { display: none; }");
  });

  it("keeps the paper-size rule: the template's @page wins, else landscape above 160 columns", async () => {
    const data = { doc: {}, sample: { id: "S", splf: {} } };
    const noSize = "<html><body><p>wide</p></body></html>";
    const portrait = "<html><head><style>@page { size: A4; }</style></head><body><p>A4</p></body></html>";
    const [wide] = pageSizes(await renderDocument(server, { template: noSize, data, format: "pdf", pageWidth: 198 }));
    const [narrow] = pageSizes(await renderDocument(server, { template: noSize, data, format: "pdf", pageWidth: 132 }));
    const [fixed] = pageSizes(await renderDocument(server, { template: portrait, data, format: "pdf", pageWidth: 198 }));
    expect(wide![0]).toBeGreaterThan(wide![1]);
    expect(narrow![0]).toBeLessThan(narrow![1]);
    expect(fixed![0]).toBeLessThan(fixed![1]);
  });

  it("maps Carbone's template errors", async () => {
    const render = (body: string) => carboneRender(server, { template: `<!doctype html><html><body>${body}</body></html>`, data: { doc: { lines: [{ a: 1 }] } }, convertTo: "html" });
    expect((await failure(render("<p>{d.doc.lines[i].a}</p>"))).message).toMatch(/no end row/);
    expect((await failure(render("{d.doc.a:formatDate('DD')}"))).message).toMatch(/Did you mean :formatD\?/);
    expect((await failure(render("{d.doc.a:ifNEM:showBegin}x"))).message).toMatch(/no showEnd or hideEnd/);
  });

  it("prints what the tag check catches, which is why Spooldoc checks first", async () => {
    const html = "<!doctype html><html><body>[{d.doc.invoiceNumber}] [{d.doc.invoiceDate:formatD(\"DD.MM.YYYY\")}]</body></html>";
    const out = Buffer.from(await carboneRender(server, { template: html, data: { doc: { invoiceDate: "2026-10-15" } }, convertTo: "html" })).toString();
    expect(out).toContain('[] ["15.10.2026"]');
    expect(checkTemplate(html, loadFixture("invoice").definition)).toHaveLength(2);
  });
});
