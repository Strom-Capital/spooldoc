import { describe, expect, it } from "vitest";
import { decoderFor } from "../src/ebcdic.js";
import { parseScs } from "../src/scs.js";
import { FIXTURES, loadFixture } from "./helpers/fixtures.js";
import { ScsBuilder } from "./helpers/scs-builder.js";

const decode = decoderFor(273);
const parse = (b: ScsBuilder, pageLength?: number) => parseScs(b.build(), decode, pageLength ? { pageLength } : {});
const texts = (r: ReturnType<typeof parse>) => r.pages.map((p) => p.lines.map((l) => [l.no, l.text]));

describe("parseScs", () => {
  it("starts a new page on a form feed and drops a trailing empty page", () => {
    const r = parse(new ScsBuilder().text("ONE").ff().text("TWO").nl().text("Ä").ff());
    expect(texts(r)).toEqual([[[1, "ONE"]], [[1, "TWO"], [2, "Ä"]]]);
    expect(r.pages.map((p) => p.no)).toEqual([1, 2]);
    expect(r.controls.FF).toBe(2);
  });

  it("ignores a leading form feed", () => {
    const r = parse(new ScsBuilder().ff().text("ONE"));
    expect(texts(r)).toEqual([[[1, "ONE"]]]);
  });

  it("NL goes to column 1, LF keeps the column", () => {
    const r = parse(new ScsBuilder().text("ABC").nl().text("D").lf().text("E"));
    expect(texts(r)).toEqual([[[1, "ABC"], [2, "D"], [3, " E"]]]);
  });

  it("keeps line numbers exact across skipped lines", () => {
    const r = parse(new ScsBuilder().text("TOP").nl(4).text("FIVE"));
    expect(texts(r)).toEqual([[[1, "TOP"], [5, "FIVE"]]]);
  });

  it("positions columns absolutely (C0) and relatively (C8)", () => {
    const r = parse(new ScsBuilder().col(10).text("X").right(3).text("Y"));
    expect(r.pages[0]?.lines[0]?.text).toBe("         X   Y");
    expect(r.controls.PPC0).toBe(1);
    expect(r.controls.PPC8).toBe(1);
  });

  it("positions lines absolutely (C4) and relatively (4C), back to column 1", () => {
    const r = parse(new ScsBuilder().line(3).text("A").down(2).text("B"));
    expect(texts(r)).toEqual([[[3, "A"], [5, "B"]]]);
  });

  it("starts a new page on a backwards absolute line", () => {
    const r = parse(new ScsBuilder().line(10).text("LOW").line(2).text("NEXT"));
    expect(texts(r)).toEqual([[[10, "LOW"]], [[2, "NEXT"]]]);
  });

  it("starts a new page past the page length", () => {
    const r = parse(new ScsBuilder().text("A").nl(3).text("B"), 3);
    expect(texts(r)).toEqual([[[1, "A"]], [[1, "B"]]]);
  });

  it("skips 2B class/length controls", () => {
    const r = parse(new ScsBuilder().ctl(0xd2, 0x03, 0x45, 0x00).text("OK").ctl(0xc8, 0x01));
    expect(texts(r)).toEqual([[[1, "OK"]]]);
    expect(r.controls["2BD2"]).toBe(1);
    expect(r.controls["2BC8"]).toBe(1);
  });

  it("moves to the next tab stop of 8", () => {
    const r = parse(new ScsBuilder().text("AB").tab().text("C").tab().text("D"));
    expect(r.pages[0]?.lines[0]?.text).toBe("AB      C       D");
  });

  it("overwrites at a column, also after CR and backspace", () => {
    const r = parse(new ScsBuilder().text("HELLO").cr().text("J").col(5).text("Y").bs().text("!"));
    expect(r.pages[0]?.lines[0]?.text).toBe("JELL!");
  });

  it("ignores other bytes below 0x40 and counts them", () => {
    const r = parse(new ScsBuilder().raw(0x00, 0x00).text("A"));
    expect(texts(r)).toEqual([[[1, "A"]]]);
    expect(r.controls.x00).toBe(2);
  });
});

describe("fixtures", () => {
  it.each(FIXTURES)("re-parsing the raw bytes of %s gives the stored pages", (name) => {
    const { sample } = loadFixture(name);
    const bytes = Uint8Array.from(Buffer.from(sample.rawBase64, "base64"));
    const { pages } = parseScs(bytes, decoderFor(sample.codePage), { pageLength: sample.attributes.pageLength });
    expect(pages).toEqual(sample.pages);
    expect(pages).toHaveLength(sample.attributes.pages);
  });
});
