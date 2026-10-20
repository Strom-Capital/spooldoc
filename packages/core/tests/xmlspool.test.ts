import { describe, expect, it } from "vitest";
import { extract } from "../src/extract.js";
import { lineText } from "../src/sample.js";
import { detectXml, extractXml, joinXmlPageGroups } from "../src/xmlspool.js";
import { loadFixture } from "./helpers/fixtures.js";

const { sample, definition, expected } = loadFixture("picklist-xml");
const result = extractXml(definition, sample);
type Doc = { picklistNo: string; shipTo: string; shipDate: string; lines: { quantity: number }[] };
const docs = result.pageGroups as Doc[];

describe("XML in spool", () => {
  it("detects XML pages and not text pages", () => {
    expect(detectXml(sample.pages)).toBe(true);
    expect(detectXml(loadFixture("picklist").sample.pages)).toBe(false);
  });

  it("joins one page group per root element and drops the footer line", () => {
    const xml = joinXmlPageGroups(sample.pages, "FORM");
    expect(xml).toHaveLength(5);
    for (const doc of xml) {
      expect(doc.startsWith("<FORM>")).toBe(true);
      expect(doc.endsWith("</FORM>")).toBe(true);
      expect(doc).not.toContain("pub400");
    }
    expect(xml[1]).toContain("BAKER &amp; SONS");
  });

  it("extracts five page groups with multi-line values and decoded entities", () => {
    expect(docs.map((d) => d.picklistNo)).toEqual(["700001", "700002", "700003", "700004", "700005"]);
    expect(docs[1]?.shipTo).toBe("BAKER & SONS LTD\nMill Lane 12\nFI-33100 TAMPERE");
    expect(docs[0]?.shipTo.split("\n")).toHaveLength(4);
    expect(docs[1]?.shipDate).toBe("2026-10-22");
    expect(typeof docs[1]?.lines[0]?.quantity).toBe("number");
    expect(result.warnings).toEqual([]);
  });

  it("points hits at the opening tag of the element", () => {
    const hit = result.hits.find((h) => h.pageGroup === 1 && h.name === "shipTo");
    expect(hit).toBeDefined();
    if (!hit) return;
    const page = sample.pages.find((p) => p.no === hit.page);
    if (!page) throw new Error("page");
    expect(lineText(page, hit.line).slice(hit.column - 1, hit.column - 1 + hit.length)).toBe("<SHIP_TO>");
    const qty = result.hits.find((h) => h.pageGroup === 1 && h.name === "lines[2].quantity");
    expect(qty?.length).toBe("<QTY>".length);
  });

  it("gives the pages of each page group, and a page two of them share", () => {
    expect(result.pageRanges).toEqual([1, 2, 3, 4, 5].map((no) => ({ first: no, last: no })));
    // Print the first two page groups on one page.
    const [one, two, ...rest] = sample.pages;
    const shift = Math.max(...one!.lines.map((l) => l.no));
    const pages = [
      { no: 1, lines: [...one!.lines, ...two!.lines.map((l) => ({ ...l, no: l.no + shift }))] },
      ...rest.map((page) => ({ ...page, no: page.no - 1 })),
    ];
    expect(extractXml(definition, { ...sample, pages }).pageRanges).toEqual([
      { first: 1, last: 1 },
      { first: 1, last: 1 },
      { first: 2, last: 2 },
      { first: 3, last: 3 },
      { first: 4, last: 4 },
    ]);
  });

  it("is what extract returns for an xml definition, and equals expected.json", () => {
    expect(extract(definition, sample)).toEqual(result);
    expect(result.pageGroups).toEqual(expected);
  });
});
