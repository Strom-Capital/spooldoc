import { describe, expect, it } from "vitest";
import { pageText, sampleId, scrubSample } from "../src/sample.js";
import { parseNumber, parseDate } from "../src/values.js";
import { loadFixture } from "./helpers/fixtures.js";

describe("samples", () => {
  it("builds a filesystem-safe id", () => {
    expect(sampleId({ name: "SPDINVOICE", number: 456, jobName: "QPRTJOB", jobUser: "DEMOUSER", jobNumber: "000123" })).toBe("SPDINVOICE-000123-000456");
    expect(sampleId({ name: "A/B C", number: 1, jobName: "J", jobUser: "U", jobNumber: "1" })).toBe("A_B_C-1-000001");
  });

  it("scrubs identifiers and keeps the rest", () => {
    const { sample } = loadFixture("invoice");
    const dirty = { ...sample, system: "host.internal", splf: { ...sample.splf, jobUser: "REALUSER", jobNumber: "123456" }, attributes: { ...sample.attributes, queue: { library: "REALLIB", name: "INVOICES" } } };
    const clean = scrubSample(dirty);
    expect(clean.splf.jobUser).toBe("DEMOUSER");
    expect(clean.splf.jobNumber).toBe("000000");
    expect(clean.system).toBe("ibmi.example.com");
    expect(clean.attributes.queue).toEqual({ library: "MYLIB", name: "INVOICES" });
    expect(clean.id).toBe(sample.id);
    expect(clean.pages).toBe(sample.pages);
    expect(clean.rawBase64).toBe(sample.rawBase64);
  });

  it("fixtures are scrubbed", () => {
    for (const name of ["invoice", "order-report", "picklist", "picklist-xml"] as const) {
      const { sample } = loadFixture(name);
      expect(scrubSample(sample)).toEqual(sample);
    }
  });

  it("fills blank lines and pads to width in pageText", () => {
    const text = pageText({ no: 1, lines: [{ no: 1, text: "A" }, { no: 3, text: "C" }] }, 3);
    expect(text).toBe("A  \n   \nC  ");
  });

  it("parses numbers and dates", () => {
    expect(parseNumber("1,234.50")).toBe(1234.5);
    expect(parseNumber("1 234,50")).toBe(1234.5);
    expect(parseNumber("1.234,50")).toBe(1234.5);
    expect(parseNumber("12,5")).toBe(12.5);
    expect(parseNumber("1,234")).toBe(1234);
    expect(parseNumber("12.50-")).toBe(-12.5);
    expect(parseNumber("abc")).toBeNull();
    expect(parseDate("2026-10-15")).toBe("2026-10-15");
    expect(parseDate("5.1.2026")).toBe("2026-01-05");
    expect(parseDate("31.02.2026")).toBeNull();
  });
});
