import { describe, expect, it } from "vitest";
import { maskPages, maskText } from "../src/mask.js";
import type { SamplePage } from "../src/sample.js";
import { loadFixture } from "./helpers/fixtures.js";

const page = (no: number, ...lines: string[]): SamplePage => ({ no, lines: lines.map((text, i) => ({ no: i + 1, text })) });

describe("maskPages", () => {
  it("masks digits and letters of values and keeps labels", () => {
    const pages = [page(1, "Invoice no: 260101   NORTHERN SUPPLY", "Total 1,234.50"), page(2, "Invoice no: 260102   Mäkelä Oy", "Total 99.00")];
    const masked = maskPages(pages);
    expect(masked[0]?.lines[0]?.text).toBe("Invoice no: 999999   XXXXXXXX XXXXXX");
    expect(masked[1]?.lines[0]?.text).toBe("Invoice no: 999999   Xxxxxx Xx");
    expect(masked[0]?.lines[1]?.text).toBe("Total 9,999.99");
  });

  it("keeps tokens matching keep patterns and never changes lengths", () => {
    const masked = maskPages([page(1, "Currency EUR  Amount 12.00")], { keep: [/^EUR$/] });
    expect(masked[0]?.lines[0]?.text).toBe("Xxxxxxxx EUR  Xxxxxx 99.99");
  });

  it("keeps positions and lengths on a real sample", () => {
    const { sample } = loadFixture("invoice");
    const masked = maskPages(sample.pages);
    masked.forEach((p, i) => {
      const orig = sample.pages[i];
      expect(p.lines.map((l) => [l.no, l.text.length])).toEqual(orig?.lines.map((l) => [l.no, l.text.length]));
    });
    const all = masked.flatMap((p) => p.lines.map((l) => l.text)).join("\n");
    expect(all).toContain("Invoice no.......:");
    expect(all).toContain("Net amount");
    expect(all).not.toContain("MÄKELÄ");
    expect(all).not.toContain("260102");
  });
});

describe("maskText", () => {
  it("masks digits and letters and keeps punctuation and spaces", () => {
    expect(maskText("Mäkelä Oy 1,234.50 -")).toBe("Xxxxxx Xx 9,999.99 -");
  });
});
