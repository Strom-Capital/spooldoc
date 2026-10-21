import { describe, expect, it } from "vitest";
import { captureSample, ConnectionError } from "../src/index.js";
import { FakeConnection, FIXTURES, loadSample } from "./helpers/fake-connection.js";

const NOW = (): Date => new Date("2026-10-18T08:00:00.123Z");

describe("captureSample", () => {
  it.each(FIXTURES)("reproduces the %s fixture through a fake connection", async (name) => {
    const fixture = loadSample(name);
    const conn = new FakeConnection([name]);
    const { sample, warnings } = await captureSample(conn, fixture.splf, { system: "ibmi.example.com", now: NOW });
    expect(warnings).toEqual([]);
    expect(sample.pages).toEqual(fixture.pages);
    expect(sample.codePage).toBe(fixture.codePage);
    expect(sample.rawBase64).toBe(fixture.rawBase64);
    expect(sample).toEqual({ ...fixture, capturedAt: "2026-10-18T08:00:00Z" });
  });

  it("decodes with the CHRID code page and keeps the umlauts", async () => {
    const fixture = loadSample("invoice");
    const { sample } = await captureSample(new FakeConnection(["invoice"]), fixture.splf, { system: "x" });
    expect(sample.codePage).toBe(273);
    expect(sample.pages.length).toBe(8);
    expect(sample.pages.some((p) => p.lines.some((l) => l.text.includes("MÄKELÄ")))).toBe(true);
  });

  it("takes the system name and job CCSID from describe() when not given", async () => {
    const fixture = loadSample("invoice");
    const conn = new FakeConnection(["invoice"], {
      info: { host: "other.example.com", jobCcsid: 273 },
      attributes: (a) => ({ ...a, chrid: null, jobCcsid: null }),
    });
    const { sample, warnings } = await captureSample(conn, fixture.splf);
    expect(sample.system).toBe("other.example.com");
    expect(sample.attributes.jobCcsid).toBe(273);
    expect(sample.codePage).toBe(273);
    expect(warnings).toEqual([expect.stringContaining("job CCSID 273")]);
    expect(conn.calls).toContain("describe");
  });

  it("uses the fallback code page when neither CHRID nor job CCSID can be used", async () => {
    const fixture = loadSample("invoice");
    const conn = new FakeConnection(["invoice"], {
      info: { jobCcsid: 65535 },
      attributes: (a) => ({ ...a, chrid: null, jobCcsid: null }),
    });
    const { sample, warnings } = await captureSample(conn, fixture.splf, { system: "x", fallbackCodePage: 273 });
    expect(sample.codePage).toBe(273);
    expect(warnings).toEqual([expect.stringContaining("fallback code page 273")]);
  });

  it("captures a non-*SCS file with a warning", async () => {
    const fixture = loadSample("picklist");
    const conn = new FakeConnection(["picklist"], { attributes: (a) => ({ ...a, deviceType: "*AFPDS" }) });
    const { sample, warnings } = await captureSample(conn, fixture.splf, { system: "x" });
    expect(sample.attributes.deviceType).toBe("*AFPDS");
    expect(warnings).toEqual([expect.stringContaining("*AFPDS, not *SCS")]);
  });

  it("warns when the page count differs from the system's", async () => {
    const fixture = loadSample("invoice");
    const conn = new FakeConnection(["invoice"], { attributes: (a) => ({ ...a, pages: 9 }) });
    const { warnings } = await captureSample(conn, fixture.splf, { system: "x" });
    expect(warnings).toEqual([expect.stringContaining("reports 9 pages")]);
  });

  it("passes a ConnectionError through", async () => {
    const fixture = loadSample("invoice");
    const conn = new FakeConnection(["invoice"]);
    await expect(captureSample(conn, { ...fixture.splf, number: 999 }, { system: "x" })).rejects.toBeInstanceOf(ConnectionError);
  });

  it("lists queues and files through the fake like the real connection", async () => {
    const conn = new FakeConnection();
    expect((await conn.listOutputQueues({ library: "mylib" })).map((q) => [q.name, q.files])).toEqual([
      ["FORMS", 2],
      ["INVOICES", 1],
      ["REPORTS", 1],
    ]);
    const files = await conn.listSpooledFiles({ library: "MYLIB", name: "FORMS" });
    expect(files.map((f) => f.name).sort()).toEqual(["SPDPICK", "SPDXML"]);
    expect(files.every((f) => f.attributes.chrid === null)).toBe(true);
  });
});
