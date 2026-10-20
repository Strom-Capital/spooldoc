import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { describe, expect, it } from "vitest";
import { readXlsx, starterXlsx } from "../src/xlsx.js";
import { editXlsx, readXlsxPart, withStyleIndexes, xlsxParts, XlsxEditError } from "../src/xlsx-edit.js";
import { loadFixture } from "./helpers/fixtures.js";
import { testPng } from "./helpers/png.js";

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const RELS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const STYLES = `${HEAD}<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="1"><dxf><font><color rgb="FFC00000"/></font></dxf></dxfs></styleSheet>`;

/** A workbook as Excel saves one: two sheets with shared strings, a rich string, a chart and picture on the second, a calc chain. */
function workbook(options: { strings?: boolean } = {}): Uint8Array {
  const withStrings = options.strings ?? true;
  const lines = `${HEAD}<worksheet ${NS}><sheetData><row r="1"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1" s="1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="2" t="s"><v>3</v></c></row><row r="3"><c r="A3" t="s"><v>4</v></c></row><row r="4"><c r="A4" t="s"><v>5</v></c><c r="B4" s="2"><f>SUM(INDIRECT("B2:B"&amp;ROW()-1))</f><v>0</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="C1:D1"/></mergeCells><conditionalFormatting sqref="B:B"><cfRule type="cellIs" dxfId="0" priority="1" operator="lessThan"><formula>0</formula></cfRule></conditionalFormatting></worksheet>`;
  const chart = `${HEAD}<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="s"><v>5</v></c><c r="B1"><v>12.5</v></c></row></sheetData><drawing r:id="rId1"/></worksheet>`;
  const files: Zippable = {
    "[Content_Types].xml": strToU8(
      `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(`${HEAD}<Relationships ${RELS}><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(
      `${HEAD}<workbook ${NS}><sheets><sheet name="Lines" sheetId="1" r:id="rId1"/><sheet name="Chart data" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">Lines!$1:$1</definedName></definedNames><calcPr calcId="191029"/></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `${HEAD}<Relationships ${RELS}><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${REL}/styles" Target="styles.xml"/>${withStrings ? `<Relationship Id="rId4" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>` : ""}<Relationship Id="rId5" Type="${REL}/calcChain" Target="calcChain.xml"/></Relationships>`,
    ),
    "xl/styles.xml": strToU8(STYLES),
    "xl/calcChain.xml": strToU8(`${HEAD}<calcChain ${NS}><c r="B4" i="1"/></calcChain>`),
    // Without shared strings, the cells hold no text.
    "xl/worksheets/sheet1.xml": strToU8(withStrings ? lines : lines.replace(/ t="s"><v>\d+<\/v>/g, ">")),
    "xl/worksheets/sheet2.xml": strToU8(withStrings ? chart : chart.replace(/ t="s"><v>\d+<\/v>/g, ">")),
    "xl/worksheets/_rels/sheet2.xml.rels": strToU8(`${HEAD}<Relationships ${RELS}><Relationship Id="rId1" Type="${REL}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`),
    "xl/drawings/drawing1.xml": strToU8(`${HEAD}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><xdr:twoCellAnchor/></xdr:wsDr>`),
    "xl/drawings/_rels/drawing1.xml.rels": strToU8(`${HEAD}<Relationships ${RELS}><Relationship Id="rId1" Type="${REL}/chart" Target="../charts/chart1.xml"/><Relationship Id="rId2" Type="${REL}/image" Target="../media/image1.png"/></Relationships>`),
    "xl/charts/chart1.xml": strToU8(`${HEAD}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart/></c:chartSpace>`),
    "xl/media/image1.png": testPng(20, 10),
  };
  if (withStrings) {
    files["xl/sharedStrings.xml"] = strToU8(
      `${HEAD}<sst ${NS} count="7" uniqueCount="6"><si><t>Item</t></si><si><t>Amount</t></si><si><t>{d.pgs[i].lines[i].item}</t></si><si><t>{d.pgs[i].lines[i].amount:formatN}</t></si><si><t>{d.pgs[i+1].lines[i+1]}</t></si><si><r><rPr><b/></rPr><t>Total</t></r><r><t xml:space="preserve"> due</t></r></si></sst>`,
    );
  }
  return zipSync(files);
}

const SHEET1 = "xl/worksheets/sheet1.xml";
const text = (bytes: Uint8Array, part: string): string => strFromU8(unzipSync(bytes)[part]!);

function refusal(edit: () => unknown): string {
  try {
    edit();
  } catch (error) {
    if (error instanceof XlsxEditError) return error.message;
    throw error;
  }
  throw new Error("expected an XlsxEditError");
}

describe("xlsxParts and readXlsxPart", () => {
  it("lists each sheet with its name, then the styles and the workbook, with sizes as they read", () => {
    const bytes = workbook();
    const parts = xlsxParts(bytes);
    expect(parts.map((p) => [p.name, p.sheet])).toEqual([
      [SHEET1, "Lines"],
      ["xl/worksheets/sheet2.xml", "Chart data"],
      ["xl/styles.xml", undefined],
      ["xl/workbook.xml", undefined],
    ]);
    expect(parts[0]!.size).toBe(readXlsxPart(bytes, SHEET1).length);
    expect(() => readXlsxPart(bytes, "xl/sharedStrings.xml")).toThrow(
      'There is no part "xl/sharedStrings.xml". The parts are xl/worksheets/sheet1.xml, xl/worksheets/sheet2.xml, xl/styles.xml, xl/workbook.xml.',
    );
  });

  it("shows shared strings in their cells as inline strings, rich runs kept", () => {
    const sheet = readXlsxPart(workbook(), SHEET1);
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t>Item</t></is></c>');
    expect(sheet).toContain('<c r="B2" s="2" t="inlineStr"><is><t>{d.pgs[i].lines[i].amount:formatN}</t></is></c>');
    expect(sheet).toContain('<c r="A4" t="inlineStr"><is><r><rPr><b/></rPr><t>Total</t></r><r><t xml:space="preserve"> due</t></r></is></c>');
    expect(sheet).not.toContain('t="s"');
  });

  it("shows the index of each font, fill, border, cell format and differential format in the styles", () => {
    const styles = readXlsxPart(workbook(), "xl/styles.xml");
    expect(styles).toContain('<fonts count="2"><!--fontId=0--><font><sz val="10"/><name val="Arial"/></font><!--fontId=1--><font><b/>');
    expect(styles).toContain('<fills count="2"><!--fillId=0--><fill>');
    expect(styles).toContain("<!--fillId=1--><fill>");
    expect(styles).toContain('<borders count="1"><!--borderId=0--><border>');
    expect(styles).toContain('<!--s=2--><xf numFmtId="164"');
    // The font inside a differential format is not a font of the list.
    expect(styles).toContain('<dxfs count="1"><!--dxfId=0--><dxf><font><color rgb="FFC00000"/></font></dxf></dxfs>');
    expect(styles.match(/<!--fontId=/g)).toHaveLength(2);
    expect(styles).not.toContain("<!--s=3-->");
    expect(withStyleIndexes("<styleSheet/>")).toBe("<styleSheet/>");
  });
});

describe("editXlsx", () => {
  it("writes strings back as shared strings, reusing the same item or adding one at the end, and keeps every other entry byte for byte", () => {
    const bytes = workbook();
    const out = editXlsx(bytes, [
      { part: SHEET1, find: "<t>Item</t>", replace: "<t>Amount</t>" },
      { part: SHEET1, find: '<c r="B1" s="1" t="inlineStr"><is><t>Amount</t></is></c>', replace: '<c r="B1" s="1" t="inlineStr"><is><t>Net amount</t></is></c><c r="C1" s="1" t="inlineStr"><is><t>VAT</t></is></c>' },
    ]);
    const sheet = text(out, SHEET1);
    // Amount is item 1 already; Net amount and VAT come after the six items.
    expect(sheet).toContain('<c r="A1" s="1" t="s"><v>1</v></c><c r="B1" s="1" t="s"><v>6</v></c><c r="C1" s="1" t="s"><v>7</v></c>');
    expect(sheet).toContain('<c r="A4" t="s"><v>5</v></c>');
    expect(sheet).not.toContain("inlineStr");
    const sst = text(out, "xl/sharedStrings.xml");
    expect(sst).toContain('count="8" uniqueCount="8"');
    expect(sst).toMatch(/<t xml:space="preserve"> due<\/t><\/r><\/si><si><t>Net amount<\/t><\/si><si><t>VAT<\/t><\/si><\/sst>$/);
    const before = unzipSync(bytes);
    const after = unzipSync(out);
    for (const name of Object.keys(before)) {
      if (name === SHEET1 || name === "xl/sharedStrings.xml") continue;
      expect(after[name], name).toEqual(before[name]);
    }
    // The formula did not change: the calc chain stays.
    expect(after["xl/calcChain.xml"]).toBeDefined();
    expect(readXlsx(out).cells.slice(0, 3).map((c) => c.text)).toEqual(["Amount", "Net amount", "VAT"]);
  });

  it("strips the index comments from the styles and writes each list's count", () => {
    const out = editXlsx(workbook(), [
      { part: "xl/styles.xml", find: "<!--s=2-->", replace: '<!--s=2--><xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><!--s=3-->' },
      { part: "xl/styles.xml", find: '<numFmt numFmtId="164" formatCode="#,##0.00"/>', replace: '<numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy"/>' },
      { part: SHEET1, find: '<c r="A3" t="inlineStr">', replace: '<c r="A3" s="3" t="inlineStr">' },
    ]);
    const styles = text(out, "xl/styles.xml");
    expect(styles).not.toContain("<!--");
    expect(styles).toContain('<numFmts count="2">');
    expect(styles).toContain('<cellXfs count="4">');
    expect(styles).toContain('<fonts count="2">');
    expect(text(out, SHEET1)).toContain('<c r="A3" s="3" t="s"><v>4</v></c>');
  });

  it("drops the calc chain, its relationship and its content type when a formula changes", () => {
    const out = editXlsx(workbook(), [{ part: SHEET1, find: '&amp;ROW()-1))</f><v>0</v>', replace: '&amp;ROW()-1))*1</f><v>0</v>' }]);
    const files = unzipSync(out);
    expect(files["xl/calcChain.xml"]).toBeUndefined();
    expect(strFromU8(files["xl/_rels/workbook.xml.rels"]!)).not.toContain("calcChain");
    expect(strFromU8(files["[Content_Types].xml"]!)).not.toContain("calcChain");
    expect(readXlsx(out).formulas[0]?.formula).toBe('SUM(INDIRECT("B2:B"&ROW()-1))*1');
  });

  it("adds the shared strings part, its relationship and its content type to a workbook without one", () => {
    const bytes = workbook({ strings: false });
    const out = editXlsx(bytes, [{ part: SHEET1, find: "<sheetData>", replace: '<sheetData><row r="9"><c r="A9" t="inlineStr"><is><t>New</t></is></c></row>' }]);
    const files = unzipSync(out);
    expect(strFromU8(files["xl/sharedStrings.xml"]!)).toContain('count="1" uniqueCount="1"><si><t>New</t></si></sst>');
    expect(strFromU8(files["xl/_rels/workbook.xml.rels"]!)).toContain(`<Relationship Id="rId4" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>`);
    expect(strFromU8(files["[Content_Types].xml"]!)).toContain('<Override PartName="/xl/sharedStrings.xml"');
    expect(readXlsx(out).cells.find((c) => c.ref === "A9")?.text).toBe("New");
  });

  it("edits the starter: a header's text and a new cell format", () => {
    const { definition } = loadFixture("invoice");
    const out = editXlsx(starterXlsx(definition), [
      { part: SHEET1, find: '<t xml:space="preserve">Invoice No</t>', replace: "<t>Invoice</t>" },
      { part: "xl/styles.xml", find: "<!--s=8-->", replace: '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><!--s=8-->' },
    ]);
    expect(readXlsx(out).cells[0]).toEqual({ sheet: "Lines", ref: "A1", row: 1, text: "Invoice" });
    expect(text(out, "xl/styles.xml")).toContain('<cellXfs count="10">');
  });

  it("refuses an edit that does not match once, all or none", () => {
    const bytes = workbook();
    expect(refusal(() => editXlsx(bytes, []))).toBe("Give at least one edit.");
    expect(refusal(() => editXlsx(bytes, [{ part: "xl/sharedStrings.xml", find: "x", replace: "y" }]))).toMatch(/^There is no part "xl\/sharedStrings\.xml"\. The parts are /);
    expect(refusal(() => editXlsx(bytes, [{ part: SHEET1, find: "", replace: "y" }]))).toBe(`find is empty. Give text that occurs once in ${SHEET1}.`);
    expect(refusal(() => editXlsx(bytes, [{ part: SHEET1, find: "<t>Item</t>", replace: "<t>Code</t>" }, { part: SHEET1, find: '<v>1</v>', replace: "" }]))).toMatch(
      /^Edit 2: The text to find is not in xl\/worksheets\/sheet1\.xml\. Read the part again: shared strings are written into their cells as inline strings/,
    );
    expect(refusal(() => editXlsx(bytes, [{ part: SHEET1, find: 't="inlineStr"', replace: "" }]))).toBe(
      `The text to find occurs more than once in ${SHEET1}. Give more of the text around it, such as the cell's r="B5".`,
    );
  });

  it.each([
    [SHEET1, '<c r="A3" t="inlineStr">', '<c r="A3" s="9" t="inlineStr">', `After the edits, the cell A3 in ${SHEET1} has style 9, but xl/styles.xml has 3 cell formats (s=0 to s=2). Use one of them, or add one to <cellXfs>. Nothing was saved.`],
    [SHEET1, '<row r="3">', '<row r="3" s="5" customFormat="1">', "After the edits, row 3 in xl/worksheets/sheet1.xml has style 5"],
    [SHEET1, "<sheetData>", '<cols><col min="2" max="2" width="12" style="4"/></cols><sheetData>', "After the edits, the column 2 in xl/worksheets/sheet1.xml has style 4"],
    [SHEET1, 'dxfId="0"', 'dxfId="1"', `After the edits, a conditional format in ${SHEET1} has dxfId="1", but xl/styles.xml has 1 differential formats (dxfId=0 to 0). Use one of them, or add a <dxf> to <dxfs>. Nothing was saved.`],
    [SHEET1, '<mergeCell ref="C1:D1"/>', '<mergeCell ref="C1:D1"/><mergeCell ref="D1:E2"/>', `After the edits, the merges C1:D1 and D1:E2 in ${SHEET1} overlap. Merged ranges cannot overlap: change or remove one. Nothing was saved.`],
    ["xl/styles.xml", '<!--s=1--><xf numFmtId="0" fontId="1"', '<!--s=1--><xf numFmtId="0" fontId="2"', 'After the edits, the cell format s=1 in xl/styles.xml has fontId="2", but there are 2 fonts (fontId=0 to 1). Use one of them, or add one to <fonts>. Nothing was saved.'],
    ["xl/styles.xml", '<xf numFmtId="0" fontId="1" fillId="0"', '<xf numFmtId="0" fontId="1" fillId="7"', 'the cell format s=1 in xl/styles.xml has fillId="7", but there are 2 fills'],
    ["xl/styles.xml", '<xf numFmtId="0" fontId="1" fillId="0" borderId="0"', '<xf numFmtId="0" fontId="1" fillId="0" borderId="3"', 'has borderId="3", but there are 1 borders'],
    ["xl/styles.xml", '<xf numFmtId="164"', '<xf numFmtId="170"', 'After the edits, the cell format s=2 in xl/styles.xml has numFmtId="170", which <numFmts> does not define.'],
    ["xl/styles.xml", '<!--s=2--><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>', "", `After the edits, the cell B2 in ${SHEET1} has style 2, but xl/styles.xml has 2 cell formats (s=0 to s=1).`],
    ["xl/workbook.xml", 'r:id="rId2"', 'r:id="rId9"', 'After the edits, the sheet "Chart data" in xl/workbook.xml has r:id="rId9", which xl/_rels/workbook.xml.rels does not have. Keep each sheet\'s r:id as it was. Nothing was saved.'],
    ["xl/workbook.xml", 'localSheetId="0"', 'localSheetId="2"', 'After the edits, the name _xlnm.Print_Titles in xl/workbook.xml has localSheetId="2", but the workbook has 2 sheets (0 to 1). Nothing was saved.'],
    [SHEET1, "</sheetData>", "</sheetData><mergeCells>", "After the edits, xl/worksheets/sheet1.xml is not well-formed XML: </worksheet> on line 2 closes <mergeCells>, which is still open. Nothing was saved."],
  ])("refuses an edit that breaks a reference or the XML, naming the part: %s %s", (part, find, replace, message) => {
    expect(refusal(() => editXlsx(workbook(), [{ part, find, replace }]))).toContain(message);
  });

  it("refuses a file that is not an Excel workbook, or one too large to edit", () => {
    expect(() => xlsxParts(strToU8("a,b"))).toThrow(/not an Excel workbook/);
    const many: Zippable = { ...unzipSync(workbook()) };
    for (let n = 0; n < 2001; n++) many[`xl/media/extra${n}.bin`] = new Uint8Array(1);
    expect(refusal(() => xlsxParts(zipSync(many)))).toBe("The file is too large to edit: at most 2000 files and 64 MB unzipped.");
  });
});

describe("editXlsx and the text it reads", () => {
  /** The workbook with the shared string "Item" written as text with dollar signs. */
  const dollars = (): Uint8Array => {
    const files = unzipSync(workbook());
    files["xl/sharedStrings.xml"] = strToU8(text(workbook(), "xl/sharedStrings.xml").replace("<t>Item</t>", () => "<t>Fee $&amp; tax in US$$</t>"));
    return zipSync(files);
  };

  it("keeps $& and $$ in a cell's text as they are, read and edited", () => {
    const bytes = dollars();
    expect(readXlsxPart(bytes, SHEET1)).toContain('<c r="A1" s="1" t="inlineStr"><is><t>Fee $&amp; tax in US$$</t></is></c>');
    const out = editXlsx(bytes, [{ part: SHEET1, find: "<t>Amount</t>", replace: "<t>Amount (EUR)</t>" }]);
    expect(text(out, "xl/sharedStrings.xml")).toContain("<si><t>Fee $&amp; tax in US$$</t></si>");
    expect(readXlsx(out).cells.find((c) => c.ref === "A1")?.text).toBe("Fee $& tax in US$$");
  });

  it("checks a style index written in single quotes", () => {
    expect(refusal(() => editXlsx(workbook(), [{ part: SHEET1, find: '<c r="A3" t="inlineStr">', replace: "<c r=\"A3\" s='99' t=\"inlineStr\">" }]))).toMatch(/style 99/);
  });

  it("refuses a workbook written with a namespace prefix", () => {
    const files = unzipSync(workbook());
    files["xl/workbook.xml"] = strToU8(text(workbook(), "xl/workbook.xml").replace(/<(\/?)workbook\b/g, "<$1x:workbook").replace(`xmlns="`, `xmlns:x="`));
    expect(refusal(() => readXlsxPart(zipSync(files), SHEET1))).toMatch(/namespace prefix/);
  });
});
