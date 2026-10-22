import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { extract } from "../src/extract.js";
import { templateData } from "../src/template.js";
import { checkXlsx, columnName, withoutTags, readXlsx, readXlsxValues, sheetsWithoutPageSetup, starterXlsx, xlsxHardRefresh, xlsxProblem, xlsxProblemText, xlsxValueTag } from "../src/xlsx.js";
import { xmlAttribute } from "../src/xml.js";
import { FIXTURES, loadFixture } from "./helpers/fixtures.js";
import { linear, TIMING } from "./helpers/linear.js";

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** A cell with a shared string, an inline string or a formula. */
const s = (ref: string, n: number) => `<c r="${ref}" t="s"><v>${n}</v></c>`;
const inline = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;

/** An .xlsx with these sheets (name to the XML inside `<worksheet>`) and shared strings. */
function xlsxOf(sheets: Record<string, string>, strings: string[] = [], extra: Record<string, string> = {}): Uint8Array {
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
  for (const [name, xml] of Object.entries(extra)) files[name] = strToU8(xml);
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
      { sheet: "Lines", ref: "C2", row: 2, text: "{d.splf.name} & more", inline: true },
      { sheet: "Order lines", ref: "A1", row: 1, text: "Second", inline: true },
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
    const none = { conditionalFormatting: [], dataValidations: [], notes: [], tables: [] };
    expect(read.sheets).toEqual([
      { name: "Lines", merges: ["A1:C1"], formulas: 2, pageSetup: true, ...none },
      { name: "Plain", merges: [], formulas: 0, pageSetup: false, ...none },
    ]);
    expect(read.formulas).toEqual([
      { sheet: "Lines", ref: "A1", row: 1, formula: "SUM(A2:A3)" },
      { sheet: "Lines", ref: "B1", row: 1, formula: '"x"' },
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

const RELS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** A sheet with a loop on rows 5 and 6, conditional formatting, validation, notes and a table, as Excel saves them. */
function loopSheet(ranges: { cf: string; dv: string; ext: string; table: string; notes: string[] }): Uint8Array {
  const strings = ["Invoice", "{d.pgs[i].invoiceNo}", "{d.pgs[i+1]}"];
  const sheet =
    `<sheetData><row r="4">${s("A4", 0)}</row><row r="5">${s("A5", 1)}</row><row r="6">${s("A6", 2)}</row></sheetData>` +
    `<conditionalFormatting sqref="${ranges.cf}"><cfRule type="expression" dxfId="0" priority="1"><formula>A5&gt;0</formula></cfRule></conditionalFormatting>` +
    `<dataValidations count="1"><dataValidation type="list" sqref="${ranges.dv}"><formula1>"a,b"</formula1></dataValidation></dataValidations>` +
    `<legacyDrawing r:id="rId2"/><tableParts count="1"><tablePart r:id="rId3"/></tableParts>` +
    `<extLst><ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}"><x14:conditionalFormattings><x14:conditionalFormatting xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><x14:cfRule type="dataBar" id="{1}"/><xm:sqref>${ranges.ext}</xm:sqref></x14:conditionalFormatting></x14:conditionalFormattings></ext></extLst>`;
  return xlsxOf({ Lines: sheet }, strings, {
    "xl/worksheets/_rels/sheet1.xml.rels": `<Relationships ${RELS}><Relationship Id="rId2" Type="${REL}/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/><Relationship Id="rId1" Type="${REL}/comments" Target="../comments1.xml"/><Relationship Id="rId3" Type="${REL}/table" Target="../tables/table1.xml"/></Relationships>`,
    "xl/comments1.xml": `<comments ${NS}><authors><author>NORTHERN SUPPLY CO</author></authors><commentList>${ranges.notes.map((ref) => `<comment ref="${ref}" authorId="0"><text><t>Note</t></text></comment>`).join("")}</commentList></comments>`,
    "xl/tables/table1.xml": `<table ${NS} id="1" name="Table1" displayName="Lines_table" ref="${ranges.table}"><autoFilter ref="${ranges.table}"/></table>`,
  });
}

describe("readXlsx: ranges, notes and tables", () => {
  it("reads conditional formatting and validation ranges, Excel's newer ones too, notes through the sheet's relationships, and tables", () => {
    const read = readXlsx(loopSheet({ cf: "A5:A6 C5:C6", dv: "B:B", ext: "D5:D6", table: "A4:C6", notes: ["A4", "B5"] }));
    expect(read.sheets[0]).toMatchObject({
      conditionalFormatting: ["A5:A6 C5:C6", "D5:D6"],
      dataValidations: ["B:B"],
      notes: ["A4", "B5"],
      tables: [{ name: "Lines_table", ref: "A4:C6" }],
    });
  });
});

describe("readXlsxValues", () => {
  const styles = `<styleSheet ${NS}><numFmts count="2"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00\ &quot;EUR&quot;"/></numFmts><cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="14"/><xf numFmtId="22"/></cellXfs></styleSheet>`;

  it("reads every cell with a value or formula, its type, formula, number format and a date as ISO", () => {
    const sheet =
      `<sheetData><row r="1">${s("A1", 0)}${inline("B1", "Inline")}<c r="C1" s="1"><v>46310</v></c><c r="D1" s="2"><v>1234.5</v></c><c r="E1" s="3"><v>46310</v></c><c r="F1" s="4"><v>46310.5625</v></c></row>` +
      `<row r="2"><c r="A2" t="e"><f>_xlfn.XLOOKUP(1,B:B,C:C)</f><v>#N/A</v></c><c r="B2" t="str"><f>"x"&amp;"y"</f><v>xy</v></c><c r="C2" t="b"><v>1</v></c><c r="D2"><f>SUM(D1:D1)</f></c><c r="E2" s="1"/></row>` +
      `<row><c t="s"><v>0</v></c><c/><c><v>3</v></c></row></sheetData>`;
    expect(readXlsxValues(xlsxOf({ Lines: sheet, Empty: "<sheetData/>" }, ["Amount"], { "xl/styles.xml": styles }))).toEqual([
      { sheet: "Lines", ref: "A1", type: "s", value: "Amount" },
      { sheet: "Lines", ref: "B1", type: "inlineStr", value: "Inline" },
      { sheet: "Lines", ref: "C1", type: "n", value: 46310, format: "dd.mm.yyyy", display: "2026-10-15" },
      { sheet: "Lines", ref: "D1", type: "n", value: 1234.5, format: '#,##0.00\ "EUR"' },
      { sheet: "Lines", ref: "E1", type: "n", value: 46310, format: "mm-dd-yy", display: "2026-10-15" },
      { sheet: "Lines", ref: "F1", type: "n", value: 46310.5625, format: "m/d/yy h:mm", display: "2026-10-15 13:30:00" },
      { sheet: "Lines", ref: "A2", type: "e", value: "#N/A", formula: "_xlfn.XLOOKUP(1,B:B,C:C)" },
      { sheet: "Lines", ref: "B2", type: "str", value: "xy", formula: '"x"&"y"' },
      { sheet: "Lines", ref: "C2", type: "b", value: true },
      { sheet: "Lines", ref: "D2", type: "n", value: null, formula: "SUM(D1:D1)" },
      // Rows and cells without r follow the one before.
      { sheet: "Lines", ref: "A3", type: "s", value: "Amount" },
      { sheet: "Lines", ref: "C3", type: "n", value: 3 },
    ]);
  });

  it("takes the 1904 date system and says what is wrong with a file that is not a .xlsx", () => {
    const bytes = xlsxOf({ Lines: `<sheetData><row r="1"><c r="A1" s="1"><v>44848</v></c></row></sheetData>` }, [], { "xl/styles.xml": styles });
    const files = unzipSync(bytes);
    files["xl/workbook.xml"] = strToU8(strFromU8(files["xl/workbook.xml"]!).replace("<sheets>", '<workbookPr date1904="1"/><sheets>'));
    expect(readXlsxValues(zipSync(files))[0]?.display).toBe("2026-10-15");
    expect(() => readXlsxValues(strToU8("a,b"))).toThrow(/not an Excel workbook/);
  });
});

describe("checkXlsx", () => {
  const sheetOf = (...cells: string[]) => xlsxOf({ Lines: `<sheetData><row r="1">${cells.map((_, n) => s(`${columnName(n + 1)}1`, n)).join("")}</row></sheetData>` }, cells);

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

describe("checkXlsx: what Carbone does not move", () => {
  it("flags ranges, tables and notes that end on or sit in the loop, and takes whole columns and far rows", () => {
    const problems = checkXlsx(readXlsx(loopSheet({ cf: "A1:A1 C5:C6", dv: "B4:B5", ext: "D5:D6", table: "A4:C6", notes: ["A4", "B5"] })), definition);
    expect(problems).toEqual([
      { sheet: "Lines", ref: "A4", message: expect.stringMatching(/^The Excel table Lines_table \(A4:C6\) ends on the loop rows 5 to 6, and a table does not grow over the rows Carbone adds\. Convert it to a range/) },
      { sheet: "Lines", ref: "B4", message: "The data validation on B4:B5 ends on the loop rows 5 to 6, and Carbone does not stretch it over the rows it adds. Apply it to whole columns, or end it on a far row such as 10000." },
      { sheet: "Lines", ref: "B5", message: "The note is at or below the loop on row 5, and Carbone does not move notes with the rows it adds. Move it above the loop, or delete it." },
      { sheet: "Lines", ref: "C5", message: "The conditional formatting on C5:C6 ends on the loop rows 5 to 6, and Carbone does not stretch it over the rows it adds. Apply it to whole columns, or end it on a far row such as 10000." },
      { sheet: "Lines", ref: "D5", message: expect.stringContaining("The conditional formatting on D5:D6 ends on the loop rows 5 to 6") },
    ]);
    expect(checkXlsx(readXlsx(loopSheet({ cf: "A:A", dv: "B5:B10000", ext: "D1:D1048576", table: "A1:C2", notes: ["A4"] })), definition)).toEqual([]);
  });

  it("flags :formatN in an inline string, and a newer function without its prefix", () => {
    const sheet = `<sheetData><row r="1">${inline("A1", "{d.pgs[i].netAmount:formatN}")}<c r="B1"><f>XLOOKUP(1,A:A,B:B)+_xlfn.FILTER(A:A,A:A&gt;1)</f></c><c r="C1"><f>_xlfn.IFNA(1,2)</f></c></row></sheetData>`;
    expect(checkXlsx(readXlsx(xlsxOf({ Lines: sheet })), definition)).toEqual([
      { sheet: "Lines", ref: "A1", message: "The cell is an inline string, so Carbone writes :formatN as text and SUM gives 0. Type the tag into the cell again in Excel, which saves it as a shared string." },
      { sheet: "Lines", ref: "B1", message: "XLOOKUP needs its prefix in the file, or LibreOffice computes #NAME?. Write _xlfn.XLOOKUP in the formula." },
      { sheet: "Lines", ref: "B1", message: "FILTER needs its prefix in the file, or LibreOffice computes #NAME?. Write _xlfn._xlws.FILTER in the formula." },
    ]);
  });
});

describe("starterXlsx", () => {
  it.each(FIXTURES)("makes %s starters whose tags pass the check, with a page setup on every sheet", async (name) => {
    const { definition: def } = loadFixture(name);
    for (const scope of ["splf", "pageGroup"] as const) {
      const read = readXlsx(await starterXlsx(def, scope));
      expect(checkXlsx(read, def, scope)).toEqual([]);
      expect(sheetsWithoutPageSetup(read)).toEqual([]);
      expect(read.sheets.every((sheet) => sheet.merges.length === 0)).toBe(true);
      // From :formatN: the flat starter has no formulas, the page group one has its totals.
      expect(xlsxHardRefresh(read)).toBe(true);
      expect(read.sheets.some((sheet) => sheet.formulas > 0)).toBe(scope === "pageGroup");
    }
  });

  it("lays out a whole spooled file as one flat sheet: a header row, a row per line with the page group's fields, and no totals", async () => {
    const bytes = await starterXlsx(definition);
    const read = readXlsx(bytes);
    expect(read.sheets.map((sheet) => sheet.name)).toEqual(["Lines"]);
    const row = (n: number) => read.cells.filter((c) => c.row === n).map((c) => c.text);
    expect(row(1).slice(0, 3)).toEqual(["Invoice No", "Invoice Date", "Due Date"]);
    expect(row(1)).toContain("Amount");
    expect(row(2).slice(0, 2)).toEqual(["{d.pgs[i].invoiceNo}", "{d.pgs[i].invoiceDate:formatD(X):div(86400):add(25569):formatN}"]);
    expect(row(2)).toContain("{d.pgs[i].lines[i].amount:formatN}");
    expect(row(3)).toEqual(["{d.pgs[i+1].lines[i+1]}"]);
    expect(read.sheets[0]!.formulas).toBe(0);
    const files = unzipSync(bytes);
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain('<pane ySplit="1" topLeftCell="A2" state="frozen" activePane="bottomLeft"/>');
    expect(sheet).toContain('<autoFilter ref="A1:W1048576"/>');
    expect(sheet).toContain('<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>');
    expect(sheet).toContain("Page &amp;P of &amp;N");
    expect(strFromU8(files["xl/workbook.xml"]!)).toContain('<definedName name="_xlnm.Print_Titles" localSheetId="0">Lines!$1:$1</definedName>');
  });

  it("lays out one page group: the title, the fields and a table with its total under it", async () => {
    const bytes = await starterXlsx(definition, "pageGroup");
    const read = readXlsx(bytes);
    expect(read.sheets.map((sheet) => sheet.name)).toEqual(["Invoice"]);
    expect(read.cells.slice(0, 3).map((c) => `${c.ref}=${c.text}`)).toEqual(["A1=Invoice", "A3=Invoice No", "B3={d.pg.invoiceNo}"]);
    expect(read.cells.map((c) => c.text)).toContain("{d.pg.lines[i].amount:formatN}");
    expect(read.cells.map((c) => c.text)).toContain("{d.pg.lines[i+1]}");
    expect(strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]!)).toContain('<f>SUM(INDIRECT("G22:G"&amp;ROW()-1))</f>');
  });

  it("makes a row per page group when the definition has no table, and a sheet name Excel takes", async () => {
    const def = { ...definition, text: { ...definition.text!, tables: [] }, output: { name: "invoice", title: "Invoice {d.pg.invoiceNo}: copy" } };
    const read = readXlsx(await starterXlsx(def));
    expect(read.sheets.map((sheet) => sheet.name)).toEqual(["Invoice copy"]);
    expect(read.cells.map((c) => c.text)).toContain("{d.pgs[i].totalAmount:formatN}");
    expect(read.cells.map((c) => c.text)).toContain("{d.pgs[i+1]}");
    expect(checkXlsx(read, def)).toEqual([]);
  });

  it("names no sheet History, which Excel keeps for itself, and none with an apostrophe at either end", async () => {
    const lines = definition.text!.tables![0]!;
    const history = { ...definition, text: { ...definition.text!, tables: [{ ...lines, name: "history" }] } };
    expect(readXlsx(await starterXlsx(history)).sheets.map((sheet) => sheet.name)).toEqual(["History 2"]);
    const quoted = { ...definition, text: { ...definition.text!, tables: [] }, output: { name: "invoice", title: "'Invoices'" } };
    expect(readXlsx(await starterXlsx(quoted)).sheets.map((sheet) => sheet.name)).toEqual(["Invoices"]);
  });
});

describe("withoutTags", () => {
  it("drops tags in one pass, and keeps a brace that is never closed", TIMING, () => {
    expect(withoutTags("Invoice {d.pg.invoiceNo}: copy {d.pg.x}")).toBe("Invoice : copy ");
    expect(withoutTags("a {b")).toBe("a {b");
    expect(withoutTags("{".repeat(100_000))).toBe("{".repeat(100_000));
    linear((n) => "{".repeat(n), withoutTags, 102_400);
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
