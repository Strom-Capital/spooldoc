import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { extract } from "../src/extract.js";
import { templateData } from "../src/template.js";
import { checkXlsx, columnName, withoutTags, readXlsx, sheetsWithoutPageSetup, starterXlsx, xlsxHardRefresh, xlsxProblem, xlsxProblemText, xlsxValueTag } from "../src/xlsx.js";
import { xmlAttribute } from "../src/xml.js";
import { FIXTURES, loadFixture } from "./helpers/fixtures.js";

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** A cell with a shared string, an inline string or a formula. */
const s = (ref: string, n: number) => `<c r="${ref}" t="s"><v>${n}</v></c>`;
const inline = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;

/** An .xlsx with these sheets (name to the XML inside `<worksheet>`) and shared strings. */
function xlsxOf(sheets: Record<string, string>, strings: string[] = []): Uint8Array {
  const names = Object.keys(sheets);
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types/>'),
    "xl/workbook.xml": strToU8(`<workbook ${NS}><sheets>${names.map((name, n) => `<sheet name="${name}" sheetId="${n + 1}" r:id="rId${n + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
        .map((_, n) => `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n + 1}.xml"/>`)
        .join("")}</Relationships>`,
    ),
    "xl/sharedStrings.xml": strToU8(`<sst ${NS}>${strings.map((t) => `<si><t>${t}</t></si>`).join("")}</sst>`),
  };
  names.forEach((name, n) => (files[`xl/worksheets/sheet${n + 1}.xml`] = strToU8(`<worksheet ${NS}>${sheets[name]}</worksheet>`)));
  return zipSync(files);
}

const { definition } = loadFixture("invoice");

describe("readXlsx", () => {
  it("reads shared and inline strings with their sheet and cell, in the workbook's order", () => {
    const strings = ["{d.pgs[i].invoiceNo}", "Total"];
    const rich = `<c r="B2" t="s"><v>2</v></c>`;
    const bytes = xlsxOf(
      {
        Lines: `<sheetData><row r="1">${s("A1", 1)}</row><row r="2">${s("A2", 0)}${rich}${inline("C2", "{d.splf.name} &amp; more")}</row></sheetData>`,
        "Order lines": `<sheetData><row r="1">${inline("A1", "Second")}</row></sheetData>`,
      },
      strings,
    );
    // A rich text string: runs joined, phonetic runs skipped.
    const files = unzipSync(bytes);
    files["xl/sharedStrings.xml"] = strToU8(`<sst ${NS}><si><t>{d.pgs[i].invoiceNo}</t></si><si><t>Total</t></si><si><r><t>{d.pgs[i].</t></r><r><rPr><b/></rPr><t>orderNo}</t></r><rPh><t>x</t></rPh></si></sst>`);
    const read = readXlsx(zipSync(files));
    expect(read.cells).toEqual([
      { sheet: "Lines", ref: "A1", row: 1, text: "Total" },
      { sheet: "Lines", ref: "A2", row: 2, text: "{d.pgs[i].invoiceNo}" },
      { sheet: "Lines", ref: "B2", row: 2, text: "{d.pgs[i].orderNo}" },
      { sheet: "Lines", ref: "C2", row: 2, text: "{d.splf.name} & more" },
      { sheet: "Order lines", ref: "A1", row: 1, text: "Second" },
    ]);
    expect(read.text.split("\n")).toHaveLength(5);
  });

  it("follows rows and cells without r, as Carbone writes them", () => {
    const read = readXlsx(xlsxOf({ Sheet1: `<sheetData><row>${inline("", "a").replace(' r=""', "")}</row><row><c/><c t="inlineStr"><is><t>b</t></is></c></row></sheetData>` }));
    expect(read.cells.map((c) => `${c.ref}=${c.text}`)).toEqual(["A1=a", "B2=b"]);
  });

  it("counts formulas and reads merges and the page setup", () => {
    const sheet = `<sheetData><row r="1"><c r="A1"><f>SUM(A2:A3)</f><v>3</v></c><c r="B1" t="str"><f>"x"</f><v>x</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:C1"/></mergeCells><pageMargins left="0.7"/><pageSetup paperSize="9" orientation="landscape"/>`;
    const read = readXlsx(xlsxOf({ Lines: sheet, Plain: `<sheetData/><pageSetup r:id="rId1"/>` }));
    expect(read.sheets).toEqual([
      { name: "Lines", merges: ["A1:C1"], formulas: 2, pageSetup: true },
      { name: "Plain", merges: [], formulas: 0, pageSetup: false },
    ]);
    expect(read.cells).toEqual([]);
    expect(sheetsWithoutPageSetup(read)).toEqual(["Plain"]);
    expect(xlsxHardRefresh(read)).toBe(true);
  });

  it("says what is wrong with a file that is not a .xlsx", () => {
    expect(() => readXlsx(strToU8("a,b\n1,2"))).toThrow(/not an Excel workbook/);
    expect(() => readXlsx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).toThrow(/Excel 97-2003 workbook \(\.xls\)/);
    expect(() => readXlsx(zipSync({ "word/document.xml": strToU8("<w:document/>") }))).toThrow(/no xl\/workbook\.xml/);
    expect(() => readXlsx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toThrow(/damaged/);
    expect(xlsxProblem(xlsxOf({ Lines: "<sheetData/>" }))).toBeNull();
    expect(xlsxProblem(strToU8("x"))).toMatch(/not an Excel workbook/);
  });
});

describe("checkXlsx", () => {
  const sheetOf = (...cells: string[]) => xlsxOf({ Lines: `<sheetData><row r="1">${cells.map((text, n) => inline(`${columnName(n + 1)}1`, text)).join("")}</row></sheetData>` });

  it("asks for :formatN on numbers alone in a cell, and refuses it straight on a date", () => {
    const read = readXlsx(sheetOf("{d.pgs[i].netAmount}", "{d.pgs[i].invoiceDate:formatN}", "Net {d.pgs[i].netAmount}", "{d.pgs[i].netAmount:formatN(2)}", xlsxValueTag("d.pgs[i].dueDate", "date")));
    expect(checkXlsx(read, definition)).toEqual([
      { sheet: "Lines", ref: "A1", message: expect.stringMatching(/^\{d\.pgs\[i\]\.netAmount\} is a number, but without :formatN the cell is text and SUM gives 0\. Write \{d\.pgs\[i\]\.netAmount:formatN\}/) },
      {
        sheet: "Lines",
        ref: "B1",
        message: expect.stringContaining("For a date cell, write {d.pgs[i].invoiceDate:formatD(X):div(86400):add(25569):formatN} and give the cell a date format"),
      },
    ]);
  });

  it("refuses d.pg when the file holds the whole spooled file, and takes it per page group", () => {
    const read = readXlsx(sheetOf("{d.pg.invoiceNo}", "{d.pg.lines[i].item}"));
    // One problem for every cell that reads d.pg, at the first.
    expect(checkXlsx(read, definition, "splf")).toEqual([
      {
        sheet: "Lines",
        ref: "A1",
        message: "{d.pg.invoiceNo} and 1 other cell read one page group, but this template gets every page group in one file: use d.pgs[i], such as {d.pgs[i].invoiceNo}, or make one file per page group.",
      },
    ]);
    expect(checkXlsx(readXlsx(sheetOf("{d.pg.lines[i].item}")), definition, "splf")[0]?.message).toContain("read one page group, but this template gets every page group in one file: use d.pgs[i], such as {d.pgs[i].lines[i].item}");
    expect(checkXlsx(read, definition, "pageGroup")).toEqual([]);
  });

  it("flags fields not in the definition, quotes, assets and merges in or below a loop, with the cell", () => {
    const sheet = `<sheetData><row r="1">${inline("A1", "{asset('logo')}")}</row><row r="3">${inline("A3", "{d.pgs[i].invoiceNumber}")}${inline("B3", "{d.pgs[i].invoiceDate:formatD(“DD”)}")}</row><row r="4">${inline("A4", "{d.pgs[i+1]}")}</row></sheetData><mergeCells><mergeCell ref="A1:C1"/><mergeCell ref="A5:B5"/></mergeCells>`;
    const problems = checkXlsx(readXlsx(xlsxOf({ "Order lines": sheet })), definition);
    expect(problems).toEqual([
      { sheet: "Order lines", ref: "A1", message: expect.stringMatching(/^\{asset\('logo'\)\} is for HTML templates\. In Excel, insert the picture itself/) },
      { sheet: "Order lines", ref: "A3", message: "{d.pgs[i].invoiceNumber} is not in the data. Did you mean {d.pgs[i].invoiceNo}?" },
      { sheet: "Order lines", ref: "B3", message: expect.stringContaining("curly quotes") },
      { sheet: "Order lines", ref: "A5", message: expect.stringMatching(/^The cells A5:B5 are merged in or below the loop on row 3\. Carbone does not move merged cells/) },
    ]);
    expect(xlsxProblemText(problems.slice(1, 2))).toBe("'Order lines'!A3: {d.pgs[i].invoiceNumber} is not in the data. Did you mean {d.pgs[i].invoiceNo}?");
  });

  it("does not check fields or types without a definition", () => {
    expect(checkXlsx(readXlsx(sheetOf("{d.pgs[i].anything}", "{d.pgs[i].netAmount}")), null)).toEqual([]);
  });

  it("sends every page group to a page group's file only when the template reads them", () => {
    const { sample, definition: def } = loadFixture("invoice");
    const { pageGroups } = extract(def, sample);
    expect(templateData(readXlsx(sheetOf("{d.pg.invoiceNo}")), pageGroups[0]!, pageGroups, sample).pgs).toBeUndefined();
    expect(templateData(readXlsx(sheetOf("{d.pgs[i].invoiceNo}")), pageGroups[0]!, pageGroups, sample).pgs).toHaveLength(pageGroups.length);
  });
});

describe("starterXlsx", () => {
  it.each(FIXTURES)("makes %s starters whose tags pass the check, with a page setup on every sheet", (name) => {
    const { definition: def } = loadFixture(name);
    for (const scope of ["splf", "pageGroup"] as const) {
      const read = readXlsx(starterXlsx(def, scope));
      expect(checkXlsx(read, def, scope)).toEqual([]);
      expect(sheetsWithoutPageSetup(read)).toEqual([]);
      expect(read.sheets.every((sheet) => sheet.merges.length === 0)).toBe(true);
      expect(xlsxHardRefresh(read)).toBe(true);
    }
  });

  it("lays out a whole spooled file as one flat sheet: totals, a header row, a row per line with the page group's fields", () => {
    const bytes = starterXlsx(definition);
    const read = readXlsx(bytes);
    expect(read.sheets.map((sheet) => sheet.name)).toEqual(["Lines"]);
    const row = (n: number) => read.cells.filter((c) => c.row === n).map((c) => c.text);
    expect(row(1)).toEqual(["Total"]);
    expect(row(2).slice(0, 3)).toEqual(["Invoice No", "Invoice Date", "Due Date"]);
    expect(row(2)).toContain("Amount");
    expect(row(3).slice(0, 2)).toEqual(["{d.pgs[i].invoiceNo}", "{d.pgs[i].invoiceDate:formatD(X):div(86400):add(25569):formatN}"]);
    expect(row(3)).toContain("{d.pgs[i].lines[i].amount:formatN}");
    expect(row(4)).toEqual(["{d.pgs[i+1].lines[i+1]}"]);
    const files = unzipSync(bytes);
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain("<f>SUBTOTAL(9,W3:W1048576)</f>");
    expect(sheet).toContain('<pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/>');
    expect(sheet).toContain('<autoFilter ref="A2:W1048576"/>');
    expect(sheet).toContain('<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>');
    expect(sheet).toContain("Page &amp;P of &amp;N");
    expect(strFromU8(files["xl/workbook.xml"]!)).toContain('<definedName name="_xlnm.Print_Titles" localSheetId="0">Lines!$2:$2</definedName>');
  });

  it("lays out one page group: the title, the fields and a table with its total under it", () => {
    const bytes = starterXlsx(definition, "pageGroup");
    const read = readXlsx(bytes);
    expect(read.sheets.map((sheet) => sheet.name)).toEqual(["Invoice"]);
    expect(read.cells.slice(0, 3).map((c) => `${c.ref}=${c.text}`)).toEqual(["A1=Invoice", "A3=Invoice No", "B3={d.pg.invoiceNo}"]);
    expect(read.cells.map((c) => c.text)).toContain("{d.pg.lines[i].amount:formatN}");
    expect(read.cells.map((c) => c.text)).toContain("{d.pg.lines[i+1]}");
    expect(strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]!)).toContain("<f>SUM(INDIRECT(&quot;G22:G&quot;&amp;ROW()-1))</f>");
  });

  it("makes a row per page group when the definition has no table, and a sheet name Excel takes", () => {
    const def = { ...definition, text: { ...definition.text!, tables: [] }, output: { name: "invoice", title: "Invoice {d.pg.invoiceNo}: copy" } };
    const read = readXlsx(starterXlsx(def));
    expect(read.sheets.map((sheet) => sheet.name)).toEqual(["Invoice copy"]);
    expect(read.cells.map((c) => c.text)).toContain("{d.pgs[i].totalAmount:formatN}");
    expect(read.cells.map((c) => c.text)).toContain("{d.pgs[i+1]}");
    expect(checkXlsx(read, def)).toEqual([]);
  });
});

describe("withoutTags", () => {
  it("drops tags in one pass, and keeps a brace that is never closed", () => {
    expect(withoutTags("Invoice {d.pg.invoiceNo}: copy {d.pg.x}")).toBe("Invoice : copy ");
    expect(withoutTags("a {b")).toBe("a {b");
    const many = "{".repeat(100_000);
    const started = performance.now();
    expect(withoutTags(many)).toBe(many);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("xmlAttribute", () => {
  it("matches the name as text, after whitespace, never part of another name", () => {
    const tag = '<c xr:r="X1" ref="A1:B2"\n r="B5" t="s" a.b+c="1">';
    expect(xmlAttribute(tag, "r")).toBe("B5");
    expect(xmlAttribute(tag, "ref")).toBe("A1:B2");
    expect(xmlAttribute(tag, "xr:r")).toBe("X1");
    expect(xmlAttribute(tag, "a.b+c")).toBe("1");
    expect(xmlAttribute(tag, ".*")).toBeUndefined();
    expect(xmlAttribute(tag, "\\")).toBeUndefined();
  });
});
