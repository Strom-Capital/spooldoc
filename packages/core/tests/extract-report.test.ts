import { describe, expect, it } from "vitest";
import { extract } from "../src/extract.js";
import { loadFixture } from "./helpers/fixtures.js";

const { sample, definition, expected } = loadFixture("order-report");
const result = extract(definition, sample);
type Line = { customerNo: string; typeCode: string; message: string; amount: number };
const doc = result.documents[0] as { runDate: string; lines: Line[] };

describe("order report extraction", () => {
  it("has a parameter page first and skips it", () => {
    expect(sample.pages).toHaveLength(4);
    expect(sample.pages[0]?.lines.some((l) => l.text.includes("SELECTION CRITERIA"))).toBe(true);
    expect(result.hits.every((h) => h.page !== 1)).toBe(true);
  });

  it("reads forty three-line records", () => {
    expect(result.documents).toHaveLength(1);
    expect(doc.lines).toHaveLength(40);
    for (const l of doc.lines) {
      expect(l.customerNo).toMatch(/^\d{5}$/);
      expect(l.typeCode).toMatch(/^[A-Z]{2}$/);
      expect(l.message.length).toBeGreaterThan(0);
    }
  });

  it("never turns header lines into records", () => {
    const recordHits = result.hits.filter((h) => h.name.startsWith("lines["));
    expect(recordHits.every((h) => h.line > (definition.text?.header?.lines ?? 0))).toBe(true);
    expect(doc.lines.some((l) => l.customerNo === "Custo")).toBe(false);
  });

  it("equals expected.json", () => {
    expect(result.documents).toEqual(expected);
    expect(result.warnings).toEqual([]);
  });
});
