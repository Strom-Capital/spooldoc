import { describe, expect, it } from "vitest";
import { decoderFor, encoderFor, resolveCodePage, supportedCodePages, UnsupportedCodePageError } from "../src/ebcdic.js";
import type { SpooledFileAttributes } from "../src/sample.js";

const ch = (cp: number, b: number): string => decoderFor(cp)(Uint8Array.of(b));

describe("decode tables", () => {
  it("lists the supported code pages", () => {
    expect(supportedCodePages).toEqual([37, 273, 278, 500, 1140, 1141, 1143, 1148]);
  });

  it("decodes the invariant positions in every page", () => {
    for (const cp of supportedCodePages) {
      expect(ch(cp, 0xc1)).toBe("A");
      expect(ch(cp, 0x81)).toBe("a");
      expect(ch(cp, 0x40)).toBe(" ");
      expect(ch(cp, 0xf0)).toBe("0");
      expect(ch(cp, 0xf9)).toBe("9");
      expect(ch(cp, 0x4b)).toBe(".");
    }
  });

  it("decodes the German positions of 273", () => {
    const expected: Record<number, string> = { 0x7c: "§", 0x4a: "Ä", 0xe0: "Ö", 0x5a: "Ü", 0xc0: "ä", 0x6a: "ö", 0xd0: "ü", 0xa1: "ß", 0x7b: "#", 0xb5: "@" };
    for (const [b, c] of Object.entries(expected)) expect(ch(273, Number(b))).toBe(c);
  });

  it("decodes the Finnish and Swedish positions of 278", () => {
    const expected: Record<number, string> = { 0x7b: "Ä", 0x7c: "Ö", 0x5b: "Å", 0xc0: "ä", 0x6a: "ö", 0xd0: "å", 0xec: "@", 0x5a: "¤", 0x4a: "§" };
    for (const [b, c] of Object.entries(expected)) expect(ch(278, Number(b))).toBe(c);
  });

  it("puts the euro sign where the currency sign was in the euro variants", () => {
    expect(ch(278, 0x5a)).toBe("¤");
    expect(ch(1143, 0x5a)).toBe("€");
    expect(ch(37, 0x9f)).toBe("¤");
    expect(ch(1140, 0x9f)).toBe("€");
    expect(ch(1141, 0x9f)).toBe("€");
    expect(ch(1148, 0x9f)).toBe("€");
  });

  it("maps the control area the same in every page", () => {
    for (const cp of supportedCodePages) {
      expect(ch(cp, 0x00)).toBe("\u0000");
      expect(ch(cp, 0x15)).toBe("\u0085");
      expect(ch(cp, 0x25)).toBe("\n");
    }
  });

  it("decodes runs and round trips through the encoder", () => {
    const text = "MÄKELÄ SÄÄTÖJALKA KÖYSI 1,234.50 §";
    expect(decoderFor(273)(encoderFor(273)(text))).toBe(text);
  });

  it("throws for an unsupported page with the supported list", () => {
    expect(() => decoderFor(1208)).toThrow(UnsupportedCodePageError);
    expect(() => decoderFor(1208)).toThrow(/37, 273, 278/);
  });
});

describe("resolveCodePage", () => {
  const attrs = (chrid: SpooledFileAttributes["chrid"], jobCcsid: number | null): SpooledFileAttributes => ({
    queue: { library: "MYLIB", name: "FORMS" },
    userData: "",
    formType: "*STD",
    deviceType: "*SCS",
    pages: 1,
    pageWidth: 132,
    pageLength: 66,
    cpi: 10,
    lpi: 6,
    chrid,
    jobCcsid,
    created: "2026-10-17T00:00:00",
  });

  it("prefers the CHRID code page over the job CCSID", () => {
    expect(resolveCodePage(attrs({ charset: 697, codePage: 37 }, 273))).toEqual({ codePage: 37, source: "chrid" });
  });

  it("uses the job CCSID when the CHRID is missing, 0 or 65535", () => {
    expect(resolveCodePage(attrs(null, 278))).toEqual({ codePage: 278, source: "job" });
    expect(resolveCodePage(attrs({ charset: 0, codePage: 0 }, 278))).toEqual({ codePage: 278, source: "job" });
    expect(resolveCodePage(attrs({ charset: 65535, codePage: 65535 }, 273))).toEqual({ codePage: 273, source: "job" });
  });

  it("falls back, then throws", () => {
    expect(resolveCodePage(attrs(null, 65535), 500)).toEqual({ codePage: 500, source: "fallback" });
    expect(() => resolveCodePage(attrs(null, 65535))).toThrow(UnsupportedCodePageError);
  });
});
