import { describe, expect, it } from "vitest";
import { csvNumber, csvToTable, detectDelimiter, detectTypes, lookupTableContentSchema, numberText, parseCsv, toCsv } from "../src/index.js";

describe("parseCsv", () => {
  it("reads quoted fields with delimiters, doubled quotes and line breaks", () => {
    const text = 'CODE,TEXT\r\n14,"Net 14 days, ""bank"""\r\n30,"Two\nlines"\r\n';
    expect(parseCsv(text)).toEqual([
      ["CODE", "TEXT"],
      ["14", 'Net 14 days, "bank"'],
      ["30", "Two\nlines"],
    ]);
  });

  it("drops a BOM and skips empty lines, but keeps a row of one quoted empty field", () => {
    expect(parseCsv('﻿A\n\n1\n""\n')).toEqual([["A"], ["1"], [""]]);
  });

  it("reads the last line without a line break, and LF line ends", () => {
    expect(parseCsv("A;B\n1;2", ";")).toEqual([
      ["A", "B"],
      ["1", "2"],
    ]);
  });

  it("refuses a quote that is not closed", () => {
    expect(() => parseCsv('A\n"open')).toThrow("A quoted field is not closed.");
  });
});

describe("detectDelimiter", () => {
  it("picks the delimiter that splits the first record most", () => {
    expect(detectDelimiter("CODE,TEXT\n1,a")).toBe(",");
    expect(detectDelimiter("CODE;TEXT;AMOUNT\n1;a,b;2,5")).toBe(";");
    expect(detectDelimiter("CODE\tTEXT\n1\ta;b")).toBe("\t");
    expect(detectDelimiter('"A,B";C\n1;2')).toBe(";");
    expect(detectDelimiter("CODE\n1")).toBe(",");
  });
});

describe("csvNumber and detectTypes", () => {
  it("reads decimal points, or decimal commas after a semicolon", () => {
    expect(csvNumber("12.50", false)).toBe(12.5);
    expect(csvNumber("12,50", false)).toBeNull();
    expect(csvNumber("12,50", true)).toBe(12.5);
    expect(csvNumber("1.234,50", true)).toBe(1234.5);
    expect(csvNumber("1 234,50", true)).toBe(1234.5);
    expect(csvNumber("12.5", true)).toBeNull();
    expect(csvNumber("-3", false)).toBe(-3);
    expect(csvNumber("007", false)).toBeNull();
    expect(csvNumber("0.5", false)).toBe(0.5);
  });

  it("types a column as number, date or text from its values", () => {
    const rows = [
      ["14", "2026-10-15", "Net 14", ""],
      ["30", "15.10.2026", "30", ""],
      ["", "", "", ""],
    ];
    expect(detectTypes(rows, 4, false)).toEqual(["number", "date", "string", "string"]);
  });
});

describe("csvToTable", () => {
  it("reads a semicolon CSV with decimal commas and types each column", () => {
    const table = csvToTable("CODE;DAYS;RATE;FROM;TEXT\n14;14;1,5;2026-10-15;Net 14 days\n007;30;2,25;;Netto 30 päivää\n");
    expect(table).toMatchObject({ delimiter: ";", decimalComma: true });
    expect(table.columns).toEqual([
      { name: "CODE", type: "string" },
      { name: "DAYS", type: "number" },
      { name: "RATE", type: "number" },
      { name: "FROM", type: "date" },
      { name: "TEXT", type: "string" },
    ]);
    expect(table.rows).toEqual([
      ["14", 14, 1.5, "2026-10-15", "Net 14 days"],
      ["007", 30, 2.25, null, "Netto 30 päivää"],
    ]);
    expect(lookupTableContentSchema.safeParse({ columns: table.columns, rows: table.rows }).success).toBe(true);
  });

  it("reads pasted cells, tab delimited, with decimal commas, and a comma CSV never with them", () => {
    expect(csvToTable("CODE\tRATE\tTEXT\r\n14\t1,5\tNet 14 days")).toMatchObject({ decimalComma: true, rows: [[14, 1.5, "Net 14 days"]] });
    const comma = csvToTable('CODE,RATE\n14,"1,5"');
    expect(comma.decimalComma).toBe(false);
    expect(comma.columns[1]).toEqual({ name: "RATE", type: "string" });
  });

  it("leaves out rows with every cell empty, as a spreadsheet saves them", () => {
    const table = csvToTable("CODE;TEXT\n14;Net\n;\n ; \n30;Net 30\n");
    expect(table.rows).toEqual([
      [14, "Net"],
      [30, "Net 30"],
    ]);
    expect(table.emptyRows).toBe(2);
  });

  it("keeps long numeric codes as text", () => {
    const table = csvToTable("ACCOUNT,SMALL\n1234567890123456789,1\n42,2\n");
    expect(table.columns).toEqual([
      { name: "ACCOUNT", type: "string" },
      { name: "SMALL", type: "number" },
    ]);
    expect(table.rows[0]![0]).toBe("1234567890123456789");
    expect(csvToTable("A\n1.23456789012345678\n").columns[0]!.type).toBe("string");
  });

  it("keeps the type of a column the table already has, and types only new columns", () => {
    const keep = [
      { name: "CODE", type: "string" as const },
      { name: "DAYS", type: "number" as const },
    ];
    const table = csvToTable("CODE,DAYS,RATE\n14,14,1.5\n30,soon,2\n", keep);
    expect(table.columns).toEqual([
      { name: "CODE", type: "string" },
      { name: "DAYS", type: "number" },
      { name: "RATE", type: "number" },
    ]);
    expect(table.rows).toEqual([
      ["14", 14, 1.5],
      ["30", "soon", 2],
    ]);
    expect(table.misfits).toBe(1);
  });

  it("refuses a header templates cannot read, naming the column", () => {
    expect(() => csvToTable("CODE,Due date\n1,2")).toThrow('Column 2 of the CSV is named "Due date", which templates cannot read. Use letters, digits and underscores, starting with a letter, such as DUE_DATE.');
    expect(() => csvToTable("CODE,CODE\n1,2")).toThrow("Two columns of the CSV are named CODE.");
    expect(() => csvToTable("CODE,\n1,2")).toThrow("Column 2 of the CSV has no name.");
    expect(() => csvToTable("")).toThrow("The CSV is empty.");
  });

  it("refuses a row with more cells than the header, and fills a short one", () => {
    expect(() => csvToTable("A,B\n1,2,3")).toThrow("Row 2 of the CSV has 3 cells, and the first row names 2 columns.");
    expect(csvToTable("A,B\n1,2,\nx").rows).toEqual([
      ["1", 2],
      ["x", null],
    ]);
  });

  it("refuses more columns or rows than a table takes", () => {
    const wide = Array.from({ length: 51 }, (_, i) => `C${i}`).join(",");
    expect(() => csvToTable(wide)).toThrow("The CSV has 51 columns. A table has up to 50.");
    const long = `A\n${"1\n".repeat(10_001)}`;
    expect(() => csvToTable(long)).toThrow("The CSV has 10,001 rows. A table has up to 10,000.");
  });
});

describe("toCsv", () => {
  it("writes UTF-8 with a BOM, commas, dot decimals and quotes where needed", () => {
    const csv = toCsv(
      [{ name: "CODE" }, { name: "RATE" }, { name: "TEXT" }],
      [
        ["14", 1.5, 'Net 14, "bank"'],
        ["30", null, "Netto 30 päivää"],
      ],
    );
    expect(csv).toBe('﻿CODE,RATE,TEXT\r\n14,1.5,"Net 14, ""bank"""\r\n30,,Netto 30 päivää\r\n');
  });

  it("writes numbers without an exponent, so they read back", () => {
    expect(numberText(0.0000001)).toBe("0.0000001");
    expect(toCsv([{ name: "A" }], [[0.0000001]])).toBe("﻿A\r\n0.0000001\r\n");
    expect(csvNumber(numberText(0.0000001), false)).toBe(0.0000001);
  });

  it("reads back what it writes", () => {
    const columns = [
      { name: "CODE", type: "string" as const },
      { name: "RATE", type: "number" as const },
      { name: "FROM", type: "date" as const },
      { name: "TEXT", type: "string" as const },
    ];
    const rows = [
      ["A", 1.25, "2026-01-31", "Two\nlines, and \"quotes\""],
      ["B", -3, null, " padded "],
    ];
    const table = csvToTable(toCsv(columns, rows));
    expect(table.columns).toEqual(columns);
    expect(table.rows).toEqual(rows);
  });
});
