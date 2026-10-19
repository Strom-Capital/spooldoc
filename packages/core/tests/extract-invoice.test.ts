import { describe, expect, it } from "vitest";
import { extract } from "../src/extract.js";
import { lineText } from "../src/sample.js";
import { loadFixture } from "./helpers/fixtures.js";

const { sample, definition, expected } = loadFixture("invoice");
const result = extract(definition, sample);
type Doc = { invoiceNo: string; customerName: string; netAmount: number; totalAmount: number; lines: { amount: number }[] };
const docs = result.pageGroups as Doc[];

describe("invoice extraction", () => {
  it("decodes the code page 273 characters", () => {
    const text = sample.pages.flatMap((p) => p.lines.map((l) => l.text)).join("\n");
    for (const word of ["MÄKELÄ", "SÄÄTÖJALKA", "KÖYSI"]) expect(text).toContain(word);
    expect(sample.pages).toHaveLength(8);
  });

  it("finds six invoices on eight pages, two of them on two pages", () => {
    expect(docs.map((d) => d.invoiceNo)).toEqual(["260101", "260102", "260103", "260104", "260105", "260106"]);
    const pagesPerDoc = docs.map((_, i) => new Set(result.hits.filter((h) => h.pageGroup === i).map((h) => h.page)).size);
    expect(pagesPerDoc.filter((n) => n === 2)).toHaveLength(2);
    expect(result.warnings).toEqual([]);
  });

  it("reads totals as numbers that match the line amounts", () => {
    for (const d of docs) {
      expect(typeof d.totalAmount).toBe("number");
      const sum = d.lines.reduce((s, l) => s + l.amount, 0);
      expect(sum).toBeCloseTo(d.netAmount, 2);
    }
    expect(docs[1]?.totalAmount).toBe(2868.96);
    expect(docs[1]?.customerName).toBe("MÄKELÄ RAKENNUS OY");
  });

  it("points every found hit at the exact printed text", () => {
    const found = result.hits.filter((h) => h.status === "found");
    expect(found.length).toBeGreaterThan(100);
    for (const h of found) {
      const page = sample.pages.find((p) => p.no === h.page);
      expect(page).toBeDefined();
      if (!page) continue;
      expect(lineText(page, h.line).slice(h.column - 1, h.column - 1 + h.length)).toBe(h.value);
    }
  });

  it("equals expected.json", () => {
    expect(result.pageGroups).toEqual(expected);
  });
});
