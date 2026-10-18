import { encoderFor } from "@spooldoc/core";
import { describe, expect, it } from "vitest";
import { parseSpooledFileEntry, SPOOLED_FILE_ENTRY_LENGTH } from "../src/index.js";

/** Builds an entry the way the system writes it, in EBCDIC. */
function entry(fields: { fn?: string; type?: string; job?: [string, string, string]; splf?: string; number?: number; outq?: [string, string] }, codePage = 37): Uint8Array {
  const encode = encoderFor(codePage);
  const bytes = new Uint8Array(SPOOLED_FILE_ENTRY_LENGTH).fill(0x40);
  const put = (at: number, value: string, length: number) => bytes.set(encode(value.padEnd(length).slice(0, length)), at);
  put(0, fields.fn ?? "*SPOOL", 10);
  put(10, fields.type ?? "01", 2);
  const [name, user, number] = fields.job ?? ["QPRTJOB", "DEMOUSER", "123456"];
  put(12, name, 10);
  put(22, user, 10);
  put(32, number, 6);
  put(38, fields.splf ?? "SPDINVOICE", 10);
  new DataView(bytes.buffer).setInt32(48, fields.number ?? 7, false);
  const [qname, qlib] = fields.outq ?? ["FORMS", "MYLIB"];
  put(52, qname, 10);
  put(62, qlib, 10);
  return bytes;
}

describe("parseSpooledFileEntry", () => {
  it("reads the spooled file and its output queue", () => {
    expect(parseSpooledFileEntry(entry({}))).toEqual({
      splf: { jobName: "QPRTJOB", jobUser: "DEMOUSER", jobNumber: "123456", name: "SPDINVOICE", number: 7 },
      queue: { library: "MYLIB", name: "FORMS" },
    });
  });

  it("accepts record type 02 and a large file number", () => {
    expect(parseSpooledFileEntry(entry({ type: "02", number: 70000 }))?.splf.number).toBe(70000);
  });

  it("decodes names with the given code page", () => {
    const parsed = parseSpooledFileEntry(entry({ outq: ["OUT@Q", "LIB#1"] }, 273), 273);
    expect(parsed?.queue).toEqual({ library: "LIB#1", name: "OUT@Q" });
  });

  it("ignores other entries and short ones", () => {
    expect(parseSpooledFileEntry(entry({ fn: "*OTHER" }))).toBeNull();
    expect(parseSpooledFileEntry(entry({ type: "09" }))).toBeNull();
    expect(parseSpooledFileEntry(entry({ number: 0 }))).toBeNull();
    expect(parseSpooledFileEntry(new Uint8Array(20))).toBeNull();
  });

  it("falls back to code page 37 for an unknown one", () => {
    expect(parseSpooledFileEntry(entry({}), 99999)?.splf.name).toBe("SPDINVOICE");
  });
});
