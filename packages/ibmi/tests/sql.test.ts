import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import * as root from "../src/index.js";
import { containsPattern, mapQueueRow, mapSpooledFileRow, outputQueuesQuery, spooledFilesQuery } from "../src/index.js";

describe("outputQueuesQuery", () => {
  it("lists every queue without a filter, ordered by library and name", () => {
    const { sql, params } = outputQueuesQuery();
    expect(sql).toContain("FROM QSYS2.OUTPUT_QUEUE_INFO");
    expect(sql).not.toContain("WHERE");
    expect(sql).toMatch(/ORDER BY OUTPUT_QUEUE_LIBRARY_NAME, OUTPUT_QUEUE_NAME$/);
    expect(params).toEqual([]);
  });

  it("filters library and name with upper-cased contains matches and parameter markers", () => {
    const { sql, params } = outputQueuesQuery({ library: "mylib", name: " Email " });
    expect(sql).toContain("WHERE UPPER(OUTPUT_QUEUE_LIBRARY_NAME) LIKE ? ESCAPE '\\' AND UPPER(OUTPUT_QUEUE_NAME) LIKE ? ESCAPE '\\'");
    expect(params).toEqual(["%MYLIB%", "%EMAIL%"]);
    expect(sql).not.toContain("MYLIB");
  });

  it("ignores blank filters", () => {
    expect(outputQueuesQuery({ library: "  ", name: "", libraries: [" "] }).params).toEqual([]);
  });

  it("limits to exact libraries, upper-cased and without duplicates", () => {
    const { sql, params } = outputQueuesQuery({ name: "inv", libraries: ["mylib", "MYLIB", "qgpl"] });
    expect(sql).toContain("UPPER(OUTPUT_QUEUE_NAME) LIKE ? ESCAPE '\\' AND OUTPUT_QUEUE_LIBRARY_NAME IN (?, ?)");
    expect(params).toEqual(["%INV%", "MYLIB", "QGPL"]);
  });

  it("reads the data queue columns", () => {
    expect(outputQueuesQuery().sql).toContain("DATA_QUEUE_LIBRARY, DATA_QUEUE_NAME");
  });
});

describe("containsPattern", () => {
  it("escapes LIKE wildcards and the escape character", () => {
    expect(containsPattern("a%b_c\\d")).toBe("%A\\%B\\_C\\\\D%");
    expect(containsPattern("QPRT")).toBe("%QPRT%");
  });
});

describe("spooledFilesQuery", () => {
  it("reads one queue through the table function, newest first, limit 200", () => {
    const { sql, params } = spooledFilesQuery({ library: "mylib", name: "email" });
    expect(sql).toContain("FROM TABLE(QSYS2.OUTPUT_QUEUE_ENTRIES(?, ?, 'YES')) X");
    expect(sql).toContain("ORDER BY CREATE_TIMESTAMP DESC");
    expect(sql).toMatch(/FETCH FIRST 200 ROWS ONLY$/);
    expect(sql).not.toContain("WHERE");
    expect(params).toEqual(["MYLIB", "EMAIL"]);
    for (const col of ["SPOOLED_FILE_NAME", "FILE_NUMBER", "JOB_NAME", "USER_DATA", "TOTAL_PAGES", "PAGE_WIDTH", "CREATE_TIMESTAMP"]) {
      expect(sql).toContain(col);
    }
  });

  it("adds name and user data filters and a custom limit", () => {
    const { sql, params } = spooledFilesQuery({ library: "MYLIB", name: "FORMS" }, { name: "spd_", userData: "pick", limit: 5 });
    expect(sql).toContain("WHERE UPPER(SPOOLED_FILE_NAME) LIKE ? ESCAPE '\\' AND UPPER(COALESCE(USER_DATA, '')) LIKE ? ESCAPE '\\'");
    expect(sql).toMatch(/FETCH FIRST 5 ROWS ONLY$/);
    expect(params).toEqual(["MYLIB", "FORMS", "%SPD\\_%", "%PICK%"]);
  });

  it("filters by status", () => {
    const { sql, params } = spooledFilesQuery({ library: "MYLIB", name: "FORMS" }, { status: ["ready", "READY"] });
    expect(sql).toContain("WHERE STATUS IN (?)");
    expect(params).toEqual(["MYLIB", "FORMS", "READY"]);
  });

  it("clamps the limit to a positive integer no larger than the maximum", () => {
    expect(spooledFilesQuery({ library: "L", name: "Q" }, { limit: 0 }).sql).toMatch(/FETCH FIRST 200 ROWS/);
    expect(spooledFilesQuery({ library: "L", name: "Q" }, { limit: -3 }).sql).toMatch(/FETCH FIRST 200 ROWS/);
    expect(spooledFilesQuery({ library: "L", name: "Q" }, { limit: 2.6 }).sql).toMatch(/FETCH FIRST 3 ROWS/);
    expect(spooledFilesQuery({ library: "L", name: "Q" }, { limit: 1e9 }).sql).toMatch(/FETCH FIRST 10000 ROWS/);
  });
});

describe("row mapping", () => {
  it("maps a queue row with string numbers", () => {
    expect(
      mapQueueRow({ OUTPUT_QUEUE_LIBRARY_NAME: "MYLIB", OUTPUT_QUEUE_NAME: "EMAIL", NUMBER_OF_FILES: "3", TEXT_DESCRIPTION: "Invoices " }),
    ).toEqual({ library: "MYLIB", name: "EMAIL", files: 3, text: "Invoices", dataQueue: null });
    expect(
      mapQueueRow({ OUTPUT_QUEUE_LIBRARY_NAME: "MYLIB", OUTPUT_QUEUE_NAME: "FORMS", NUMBER_OF_FILES: 1, DATA_QUEUE_LIBRARY: "MYLIB", DATA_QUEUE_NAME: "SPLFDTAQ" }).dataQueue,
    ).toEqual({ library: "MYLIB", name: "SPLFDTAQ" });
    expect(mapQueueRow({ OUTPUT_QUEUE_LIBRARY_NAME: "MYLIB", OUTPUT_QUEUE_NAME: "X", NUMBER_OF_FILES: null, TEXT_DESCRIPTION: null })).toEqual({
      library: "MYLIB",
      name: "X",
      files: 0,
      text: "",
      dataQueue: null,
    });
  });

  const row = {
    SPOOLED_FILE_NAME: "SPDINVOICE",
    FILE_NUMBER: "34",
    JOB_NAME: "123456/DEMOUSER/QPRTJOB",
    USER_DATA: "INVOICE",
    FORM_TYPE: "*STD",
    DEVICE_TYPE: "*SCS",
    TOTAL_PAGES: "8",
    PAGE_LENGTH: "66",
    PAGE_WIDTH: "132",
    CHARACTERS_PER_INCH: "10.0",
    LINES_PER_INCH: "6.0",
    STATUS: "HELD",
    CREATE_TIMESTAMP: "2026-10-17 21:40:38.254885",
  };

  it("maps a spooled file row, splitting the qualified job name", () => {
    expect(mapSpooledFileRow(row, { library: "mylib", name: "email" })).toEqual({
      name: "SPDINVOICE",
      number: 34,
      jobNumber: "123456",
      jobUser: "DEMOUSER",
      jobName: "QPRTJOB",
      status: "HELD",
      attributes: {
        queue: { library: "MYLIB", name: "EMAIL" },
        userData: "INVOICE",
        formType: "*STD",
        deviceType: "*SCS",
        pages: 8,
        pageWidth: 132,
        pageLength: 66,
        cpi: 10,
        lpi: 6,
        chrid: null,
        jobCcsid: null,
        created: "2026-10-17T21:40:38",
      },
    });
  });

  it("prefers the queue columns of the view over the queue argument", () => {
    const entry = mapSpooledFileRow({ ...row, OUTPUT_QUEUE_LIBRARY_NAME: "OTHERLIB", OUTPUT_QUEUE_NAME: "FORMS" }, { library: "MYLIB", name: "EMAIL" });
    expect(entry.attributes.queue).toEqual({ library: "OTHERLIB", name: "FORMS" });
  });

  it("fills defaults for missing page attributes", () => {
    const entry = mapSpooledFileRow({ SPOOLED_FILE_NAME: "AFP", FILE_NUMBER: 1, JOB_NAME: "1/U/J", TOTAL_PAGES: null, PAGE_WIDTH: null, PAGE_LENGTH: "0" });
    expect(entry.attributes).toMatchObject({ pages: 0, pageWidth: 132, pageLength: 66, cpi: 10, lpi: 6, userData: "", queue: { library: "", name: "" } });
  });
});

describe("root entry point", () => {
  it("does not export or load the Java implementation", () => {
    expect(Object.keys(root)).not.toContain("openJt400Connection");
    expect(Object.keys(root)).not.toContain("getConnection");
    const cache = createRequire(import.meta.url).cache;
    expect(Object.keys(cache).some((k) => /[\\/]java[\\/]/.test(k) || k.includes("node-jt400"))).toBe(false);
  });
});
