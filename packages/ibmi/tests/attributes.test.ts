import { describe, expect, it } from "vitest";
import { ATTRIBUTE_DEFAULTS, parseChrid, parseOutqPath, positiveInt, splitJobName, spoolDateTime, sqlTimestamp, toNumber } from "../src/index.js";

describe("parseChrid", () => {
  it("parses a charset and code page pair", () => {
    expect(parseChrid("697 273")).toEqual({ charset: 697, codePage: 273 });
    expect(parseChrid("697,273")).toEqual({ charset: 697, codePage: 273 });
    expect(parseChrid(" 1172  1112 ")).toEqual({ charset: 1172, codePage: 1112 });
  });

  it("combines jt400's zero-padded ATTR_CHAR_ID and ATTR_CODEPAGE", () => {
    expect(parseChrid("0000000697", "0000000273")).toEqual({ charset: 697, codePage: 273 });
    expect(parseChrid(697, 37)).toEqual({ charset: 697, codePage: 37 });
  });

  it("parses the numbers from the last part of a path", () => {
    expect(parseChrid("/QSYS.LIB/697.273.CHRID")).toEqual({ charset: 697, codePage: 273 });
    expect(parseChrid("/QSYS.LIB/QCHRID.CHRID", "273")).toBeNull();
    expect(parseChrid("/QSYS.LIB/CS697.CHRID", "273")).toEqual({ charset: 697, codePage: 273 });
  });

  it("gives null for special values, missing parts and unusable code pages", () => {
    for (const v of ["*DEVD", "*JOBCCSID", "*SYSVAL", "*CHRIDCTL", "", null, undefined]) expect(parseChrid(v, "273")).toBeNull();
    expect(parseChrid("697")).toBeNull();
    expect(parseChrid("697", "*DEVD")).toBeNull();
    expect(parseChrid("697 0")).toBeNull();
    expect(parseChrid("697 65535")).toBeNull();
  });
});

describe("parseOutqPath", () => {
  it("splits a library queue path", () => {
    expect(parseOutqPath("/QSYS.LIB/MYLIB.LIB/INVOICES.OUTQ")).toEqual({ library: "MYLIB", name: "INVOICES" });
    expect(parseOutqPath(" /qsys.lib/mylib.lib/forms.outq ")).toEqual({ library: "MYLIB", name: "FORMS" });
  });

  it("treats a queue directly in QSYS.LIB as library QSYS", () => {
    expect(parseOutqPath("/QSYS.LIB/QPRINT.OUTQ")).toEqual({ library: "QSYS", name: "QPRINT" });
  });

  it("gives null for anything else", () => {
    expect(parseOutqPath("MYLIB/INVOICES")).toBeNull();
    expect(parseOutqPath("/QSYS.LIB/MYLIB.LIB/INVOICES.FILE")).toBeNull();
    expect(parseOutqPath(null)).toBeNull();
  });
});

describe("splitJobName", () => {
  it("splits number/user/name", () => {
    expect(splitJobName("123456/DEMOUSER/QPRTJOB")).toEqual({ jobNumber: "123456", jobUser: "DEMOUSER", jobName: "QPRTJOB" });
  });
  it("keeps an unqualified name as the job name", () => {
    expect(splitJobName("QPRTJOB")).toEqual({ jobNumber: "", jobUser: "", jobName: "QPRTJOB" });
    expect(splitJobName(null)).toEqual({ jobNumber: "", jobUser: "", jobName: "" });
  });
});

describe("dates", () => {
  it("reads jt400 CYYMMDD and HHMMSS values", () => {
    expect(spoolDateTime("1261017", "214038")).toBe("2026-10-17T21:40:38");
    expect(spoolDateTime("0991231", "5")).toBe("1999-12-31T00:00:05");
    expect(spoolDateTime("", "214038")).toBe("");
    expect(spoolDateTime("1261017", null)).toBe("2026-10-17T00:00:00");
  });

  it("normalizes SQL timestamps", () => {
    expect(sqlTimestamp("2026-10-17 21:40:38.254885")).toBe("2026-10-17T21:40:38");
    expect(sqlTimestamp("2026-10-17-21.40.38.254885")).toBe("2026-10-17T21:40:38");
    expect(sqlTimestamp(new Date("2026-10-17T21:40:38.5Z"))).toBe("2026-10-17T21:40:38");
    expect(sqlTimestamp(null)).toBe("");
  });
});

describe("numbers and defaults", () => {
  it("reads numbers from strings", () => {
    expect(toNumber("10.0")).toBe(10);
    expect(toNumber(" 7 ")).toBe(7);
    expect(toNumber("")).toBeNull();
    expect(toNumber("abc")).toBeNull();
    expect(toNumber(null)).toBeNull();
  });

  it("falls back for missing or non-positive values", () => {
    expect(positiveInt("132", ATTRIBUTE_DEFAULTS.pageWidth)).toBe(132);
    expect(positiveInt(null, ATTRIBUTE_DEFAULTS.pageWidth)).toBe(132);
    expect(positiveInt("0", ATTRIBUTE_DEFAULTS.pageLength)).toBe(66);
    expect(ATTRIBUTE_DEFAULTS).toEqual({ pageWidth: 132, pageLength: 66, cpi: 10, lpi: 6 });
  });
});
