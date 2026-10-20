import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { carboneRender, carboneStatus, isCarboneError, probeEdition, type CarboneError } from "../src/carbone.js";
import { extract } from "../src/extract.js";
import { checkDocx, readDocx, starterDocx } from "../src/docx.js";
import { buildDocx } from "../src/docx-design.js";
import { editDocx } from "../src/docx-edit.js";
import { pdfPageCount, renderDocument } from "../src/render.js";
import { checkTemplate } from "../src/tags.js";
import { spooledFileData, starterTemplate, templateData } from "../src/template.js";
import { checkXlsx, readXlsx, starterXlsx, xlsxHardRefresh } from "../src/xlsx.js";
import { FIXTURES, loadFixture } from "./helpers/fixtures.js";
import { invoiceDesign } from "./helpers/invoice-design.js";
import { testPng } from "./helpers/png.js";

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

/** The cells of the first sheet of an XLSX Carbone made: each cell's type and value, by reference. */
function sheetCells(xlsx: Uint8Array): Map<string, { type: string; value: string | undefined; formula?: string }> {
  const files = unzipSync(xlsx);
  const strings = [...strFromU8(files["xl/sharedStrings.xml"] ?? new Uint8Array()).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1]!.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join(""),
  );
  const cells = new Map<string, { type: string; value: string | undefined; formula?: string }>();
  for (const m of strFromU8(files["xl/worksheets/sheet1.xml"]!).matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const type = /t="(\w+)"/.exec(m[2]!)?.[1] ?? "n";
    const value = /<v>([^<]*)<\/v>/.exec(m[3] ?? "")?.[1];
    const formula = /<f[^>]*>([^<]*)<\/f>/.exec(m[3] ?? "")?.[1];
    cells.set(m[1]!, { type, value: type === "s" && value !== undefined ? strings[Number(value)] : value, ...(formula ? { formula } : {}) });
  }
  return cells;
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
    const { pageGroups } = extract(definition, sample);
    for (const html of [template, starterTemplate(definition)]) {
      expect(checkTemplate(html, definition)).toEqual([]);
      const data = templateData(html, pageGroups[0]!, pageGroups, sample);
      const out = Buffer.from(await renderDocument(server, { template: html, data, format: "html" })).toString();
      expect(out).not.toMatch(/\{d\./);
      const pdf = await renderDocument(server, { template: html, data, format: "pdf", pageWidth: sample.attributes.pageWidth });
      expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    }
  });

  it.each(FIXTURES)("renders the %s Word starter template to DOCX and PDF", async (name) => {
    const { sample, definition } = loadFixture(name);
    const { pageGroups } = extract(definition, sample);
    const template = await starterDocx(definition);
    const read = readDocx(template);
    expect(checkDocx(read, definition)).toEqual([]);
    const data = templateData(read, pageGroups[0]!, pageGroups, sample);
    const docx = readDocx(await renderDocument(server, { kind: "docx", template, data, format: "docx" }));
    expect(docx.text).not.toMatch(/\{d\./);
    const pdf = await renderDocument(server, { kind: "docx", template, data, format: "pdf" });
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
  });

  it("hides an empty field's line in the Word starter, keeps the loop rows and leaves page fields to Word", async () => {
    const { sample, definition } = loadFixture("invoice");
    const { pageGroups } = extract(definition, sample);
    const template = await starterDocx(definition);
    const doc = pageGroups[2]!;
    expect(doc.address2).toBe("");
    const out = await renderDocument(server, { kind: "docx", template, data: templateData(readDocx(template), doc, pageGroups, sample), format: "docx" });
    const text = readDocx(out).text;
    expect(text).toContain("BAKER & SONS LTD");
    expect(text).not.toContain("Address2");
    expect(text).toContain("Address3");
    expect(text.match(/\{d\.|\[i/g)).toBeNull();
    // hardRefresh: false, so Carbone Enterprise does not pass the file through LibreOffice.
    expect(readDocx(out).fields).toEqual(["PAGE", "NUMPAGES"]);
  });

  it("renders a designed Word template on every page, and page 1 as a PNG", async () => {
    const { sample, definition } = loadFixture("invoice");
    const { pageGroups } = extract(definition, sample);
    const template = await buildDocx(invoiceDesign, (name) => (name === "logo" ? { data: testPng(400, 100), type: "png", width: 400, height: 100 } : undefined));
    const read = readDocx(template);
    expect(checkDocx(read, definition)).toEqual([]);
    // Enough lines for a second page, which has the running header and the totals.
    const first = pageGroups[0]!;
    const long = { ...first, lines: Array.from({ length: 12 }, () => first.lines as unknown[]).flat() };
    const data = templateData(read, long, pageGroups, sample);
    const docx = readDocx(await renderDocument(server, { kind: "docx", template, data, format: "docx" }));
    expect(docx.text).not.toMatch(/\{d\.|\[i/);
    expect(docx.text).toContain("NORTHERN SUPPLY CO");
    const pdf = await renderDocument(server, { kind: "docx", template, data, format: "pdf" });
    expect(pdfPageCount(pdf)).toBe(2);
    const png = Buffer.from(await renderDocument(server, { kind: "docx", template, data, format: "png" }));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    // A4 at 96 dpi.
    expect(png.readUInt32BE(16)).toBeGreaterThan(780);
    expect(png.readUInt32BE(20) / png.readUInt32BE(16)).toBeCloseTo(297 / 210, 1);
  });

  it("renders a Word template after an edit", async () => {
    const { sample, definition } = loadFixture("invoice");
    const { pageGroups } = extract(definition, sample);
    const template = editDocx(await starterDocx(definition), [{ part: "word/document.xml", find: ">Invoice<", replace: ">Invoice {d.pg.invoiceNo}<" }]);
    const read = readDocx(template);
    const out = readDocx(await renderDocument(server, { kind: "docx", template, data: templateData(read, pageGroups[0]!, pageGroups, sample), format: "docx" }));
    expect(out.paragraphs[0]!.text).toBe(`Invoice ${String(pageGroups[0]!.invoiceNo)}`);
  });

  it.each(FIXTURES)("renders the %s Excel starter templates to XLSX and PDF", async (name) => {
    const { sample, definition } = loadFixture(name);
    const { pageGroups } = extract(definition, sample);
    for (const scope of ["splf", "pageGroup"] as const) {
      const template = starterXlsx(definition, scope);
      const read = readXlsx(template);
      expect(checkXlsx(read, definition, scope)).toEqual([]);
      const data = scope === "splf" ? spooledFileData(pageGroups, sample) : templateData(read, pageGroups[0]!, pageGroups, sample);
      const xlsx = readXlsx(await renderDocument(server, { kind: "xlsx", template, data, format: "xlsx" }));
      expect(xlsx.text).not.toMatch(/\{d\.|\[i/);
      const pdf = await renderDocument(server, { kind: "xlsx", template, data, format: "pdf" });
      expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    }
  });

  it("writes the Excel starter's numbers and dates as number cells, and its page group totals right", async () => {
    const { sample, definition } = loadFixture("invoice");
    const { pageGroups } = extract(definition, sample);
    const lines = pageGroups.flatMap((g) => g.lines as { amount: number }[]);
    const flat = starterXlsx(definition);
    // No formulas: hardRefresh comes from :formatN, and is still sent.
    expect(readXlsx(flat).sheets[0]!.formulas).toBe(0);
    expect(xlsxHardRefresh(readXlsx(flat))).toBe(true);
    const cells = sheetCells(await renderDocument(server, { kind: "xlsx", template: flat, data: spooledFileData(pageGroups, sample), format: "xlsx" }));
    // Row 1 the header, then a row per line, and nothing under them.
    expect(cells.get("A1")?.value).toBe("Invoice No");
    expect(cells.get("W1")?.value).toBe("Amount");
    expect(cells.get("A2")).toEqual({ type: "s", value: pageGroups[0]!.invoiceNo });
    // 15.10.2026 as an Excel date serial.
    expect(cells.get("B2")).toEqual({ type: "n", value: "46310" });
    expect(cells.get("W2")).toEqual({ type: "n", value: String(lines[0]!.amount) });
    expect(cells.get(`A${lines.length + 1}`)?.value).toBe(pageGroups.at(-1)!.invoiceNo);
    expect(cells.has(`A${lines.length + 2}`)).toBe(false);
    expect([...cells.values()].some((cell) => cell.formula)).toBe(false);

    // The page group starter's total under its table: LibreOffice computed and stored it.
    const first = pageGroups[0]!;
    const one = sheetCells(
      await renderDocument(server, { kind: "xlsx", template: starterXlsx(definition, "pageGroup"), data: templateData(readXlsx(starterXlsx(definition, "pageGroup")), first, pageGroups, sample), format: "xlsx" }),
    );
    const total = [...one.values()].find((cell) => cell.formula?.startsWith('SUM(INDIRECT(&quot;G'));
    expect(Number(total?.value)).toBeCloseTo((first.lines as { amount: number }[]).reduce((sum, line) => sum + line.amount, 0), 2);
  });

  it("prints a long Excel starter on several A4 landscape pages", async () => {
    const { sample, definition } = loadFixture("order-report");
    const { pageGroups } = extract(definition, sample);
    // 400 lines, enough for several pages.
    const many = Array.from({ length: 10 }, () => pageGroups).flat();
    const pdf = await renderDocument(server, { kind: "xlsx", template: starterXlsx(definition), data: spooledFileData(many, sample), format: "pdf" });
    const pages = pdfPageCount(pdf)!;
    expect(pages).toBeGreaterThan(1);
    const sizes = pageSizes(pdf);
    expect(sizes).toHaveLength(pages);
    // A4 landscape, since the columns are wider than portrait fits.
    for (const [width, height] of sizes) {
      expect(width).toBeCloseTo(842, 0);
      expect(height).toBeCloseTo(595, 0);
    }
  });

  it("keeps the paper-size rule: the template's @page wins, else landscape above 160 columns", async () => {
    const data = { pg: {}, splf: {} };
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
    const render = (body: string) => carboneRender(server, { template: `<!doctype html><html><body>${body}</body></html>`, data: { pg: { lines: [{ a: 1 }] } }, convertTo: "html" });
    expect((await failure(render("<p>{d.pg.lines[i].a}</p>"))).message).toMatch(/no end row/);
    expect((await failure(render("{d.pg.a:formatDate('DD')}"))).message).toMatch(/Did you mean :formatD\?/);
    expect((await failure(render("{d.pg.a:ifNEM:showBegin}x"))).message).toMatch(/no showEnd or hideEnd/);
  });

  it("prints what the tag check catches, which is why Spooldoc checks first", async () => {
    const html = "<!doctype html><html><body>[{d.pg.invoiceNumber}] [{d.pg.invoiceDate:formatD(\"DD.MM.YYYY\")}]</body></html>";
    const out = Buffer.from(await carboneRender(server, { template: html, data: { pg: { invoiceDate: "2026-10-15" } }, convertTo: "html" })).toString();
    expect(out).toContain('[] ["15.10.2026"]');
    expect(checkTemplate(html, loadFixture("invoice").definition)).toHaveLength(2);
  });
});
