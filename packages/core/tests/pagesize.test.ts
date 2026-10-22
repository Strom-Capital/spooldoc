import { describe, expect, it } from "vitest";
import { cssPageSize, pageLayout } from "../src/pagesize.js";
import { linear, TIMING } from "./helpers/linear.js";

const page = (rule: string) => `<html><head><style>${rule} body { margin: 0 }</style></head><body></body></html>`;

describe("pageLayout", () => {
  it("is A4 portrait by default", () => {
    expect(pageLayout(page(""), 132)).toEqual({ format: "A4", landscape: false, fromTemplate: false });
    expect(pageLayout(page(""))).toEqual({ format: "A4", landscape: false, fromTemplate: false });
  });

  it("is landscape for pages wider than 160 columns", () => {
    expect(pageLayout(page(""), 198).landscape).toBe(true);
    expect(pageLayout(page(""), 160).landscape).toBe(false);
  });

  it("respects the template's @page size", () => {
    expect(pageLayout(page("@page { size: A4; margin: 15mm; }"), 198)).toEqual({ format: "A4", landscape: false, fromTemplate: true });
    expect(pageLayout(page("@page { margin: 1cm; size: A4 landscape }"), 80).landscape).toBe(true);
    expect(pageLayout(page("@page { size: 297mm 210mm }"), 80).landscape).toBe(true);
    expect(pageLayout(page("@page { size: 8.5in 11in }"), 198).landscape).toBe(false);
  });

  it("ignores @page rules without a size and commented-out rules", () => {
    expect(cssPageSize(page("@page { margin: 10mm }"))).toBeUndefined();
    expect(cssPageSize(page("/* @page { size: landscape } */"))).toBeUndefined();
    expect(cssPageSize(page("@page :first { size: landscape }"))).toBeUndefined();
  });

  it("skips commented-out rules, and stays fast on many unclosed comments", TIMING, () => {
    expect(cssPageSize("<style>/* @page { size: A4 landscape } */ @page { size: A4 } /* x */</style>")).toBe("A4");
    expect(cssPageSize("<style>@page { size: A4 } /* not closed @page { size: A3 }</style>")).toBe("A3");
    expect(cssPageSize("<style>İİ @PAGE { margin: 1cm; Size: A4 landscape !important; size: A3 }</style>")).toBe("A4 landscape");
    expect(cssPageSize("/*".repeat(100_000))).toBeUndefined();
    expect(cssPageSize("@page{{|".repeat(100_000))).toBeUndefined();
    expect(cssPageSize(`@page { size: ${"9".repeat(100_000)}x 1mm }`)).toBe(`${"9".repeat(100_000)}x 1mm`);
    expect(pageLayout(`<style>@page { size: ${"9".repeat(100_000)}x 1mm }</style>`).landscape).toBe(false);
    linear((n) => "/*".repeat(n), cssPageSize, 102_400);
    linear((n) => "@page{{|".repeat(n), cssPageSize, 102_400);
    linear((n) => `@page { size: ${"9".repeat(n)}x 1mm }`, cssPageSize, 102_400);
    linear((n) => `<style>@page { size: ${"9".repeat(n)}x 1mm }</style>`, pageLayout, 102_400);
  });
});
