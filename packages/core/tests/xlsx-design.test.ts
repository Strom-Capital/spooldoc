import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { DesignError, imageInfo, type DesignImage } from "../src/design.js";
import { buildXlsx } from "../src/xlsx-design.js";
import { missingPrefixes } from "../src/xlsx-formula.js";
import { checkXlsx, readXlsx } from "../src/xlsx.js";
import { loadFixture } from "./helpers/fixtures.js";
import { testPng } from "./helpers/png.js";
import { linear, TIMING } from "./helpers/linear.js";

const logo = testPng(120, 40);
const images = (name: string): DesignImage | undefined => (name === "logo" ? { data: logo, ...imageInfo(logo)! } : undefined);

/** The workbook's parts as text, by name. */
async function partsOf(design: unknown): Promise<Record<string, string>> {
  const files = unzipSync(await buildXlsx(design, images));
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, /\.(xml|rels|vml)$/.test(name) ? strFromU8(bytes) : ""]));
}

/** The problems of a design that is refused. */
async function problems(design: unknown): Promise<string[]> {
  try {
    await buildXlsx(design, images);
  } catch (error) {
    if (error instanceof DesignError) return error.problems;
    throw error;
  }
  throw new Error("expected a DesignError");
}

const one = (sheet: Record<string, unknown>, workbook: Record<string, unknown> = {}) => ({ sheets: [{ name: "Lines", ...sheet }], ...workbook });

/** An invoice lines sheet with every kind of node a design can have. */
const FULL = {
  defaultFont: { name: "Calibri", size: 11, color: "1A1A1A" },
  activeSheet: 1,
  definedNames: [{ name: "Rates", ref: "Rates!$A$2:$B$9" }, { name: "Local", ref: "Lines!$A$1", sheet: "Lines" }],
  sheets: [
    {
      name: "Lines",
      tabColor: "#1f3a5f",
      views: { frozen: { rows: 4, columns: 1 }, zoom: 90, showGridLines: false },
      columns: [
        { ref: "A:B", width: 12 },
        { ref: "F", width: 14, style: { numFmt: "#,##0.00", alignment: { horizontal: "right" } } },
        { ref: "H", hidden: true, outlineLevel: 1 },
      ],
      rows: [
        { row: 1, height: 30 },
        { row: 2, hidden: true, outlineLevel: 2 },
      ],
      cells: [
        { ref: "A1", value: "Invoices {d.splf.name}", style: { font: { bold: true, size: 14, color: "#C00000", italic: true, underline: "double", strike: true } } },
        {
          ref: "A4",
          value: "Invoice",
          style: {
            fill: { type: "pattern", pattern: "solid", fgColor: "E8E8E8" },
            border: { bottom: { style: "thin", color: "333333" }, top: { style: "double" } },
            alignment: { vertical: "center", wrapText: true, indent: 1, textRotation: 45, shrinkToFit: true },
          },
          note: "The invoice number",
        },
        { ref: "B4", value: "Date", style: { fill: { type: "gradient", degree: 90, stops: [{ position: 0, color: "FFFFFF" }, { position: 1, color: "1F3A5F" }] } } },
        { ref: "B5", value: "{d.pgs[i].invoiceDate:formatD(X):div(86400):add(25569):formatN}", style: { numFmt: "dd.mm.yyyy" } },
        { ref: "F5", value: "{d.pgs[i].lines[i].amount:formatN}" },
        { ref: "A6", value: "{d.pgs[i+1].lines[i+1]}" },
        { ref: "F7", value: { formula: '=SUM(INDIRECT("F5:F"&ROW()-1))', result: 0 } },
        { ref: "G7", value: { formula: 'XLOOKUP("A",Rates!A:A,Rates!B:B)' } },
        { ref: "H7", value: { date: "2026-10-15" } },
        { ref: "H8", value: { richText: [{ text: "Net " }, { text: "total", font: { bold: true } }] } },
        { ref: "H9", value: "Website", hyperlink: "https://example.com/invoices" },
        { ref: "H10", value: "Rates", hyperlink: "#Rates!A1" },
        { ref: "H11", value: 42 },
        { ref: "H12", value: true },
      ],
      merges: ["A1:C1"],
      autoFilter: "A4:F4",
      conditionalFormatting: [
        {
          ref: "F:F",
          rules: [
            { type: "cellIs", operator: "lessThan", formulae: ["0"], style: { font: { color: "C00000" } } },
            { type: "cellIs", operator: "between", formulae: ["1", "10"], style: { fill: { type: "pattern", pattern: "solid", fgColor: "FFF2CC" } } },
            { type: "expression", formulae: ["MOD(ROW(),2)=0"], style: { fill: { type: "pattern", pattern: "solid", fgColor: "F2F2F2" } } },
            { type: "colorScale", cfvo: [{ type: "min" }, { type: "percentile", value: 50 }, { type: "max" }], color: ["F8696B", "FFEB84", "63BE7B"] },
            { type: "dataBar", cfvo: [{ type: "min" }, { type: "max" }], color: "638EC6" },
            { type: "iconSet", iconSet: "3TrafficLights1", cfvo: [{ type: "min" }, { type: "percent", value: 33 }, { type: "percent", value: 67 }] },
            { type: "duplicateValues", style: { font: { bold: true } } },
            { type: "top10", style: { font: { bold: true } } },
            { type: "aboveAverage", style: { font: { italic: true } }, stopIfTrue: true },
          ],
        },
        {
          ref: "C:C",
          rules: [
            { type: "containsText", text: "OY", style: { font: { color: "1F3A5F" } } },
            { type: "beginsWith", text: "NORTH", style: { font: { color: "1F3A5F" } } },
            { type: "endsWith", text: 'LTD"', style: { font: { color: "1F3A5F" } } },
          ],
        },
      ],
      dataValidations: [
        { ref: "D:D", type: "list", formulae: ['"Open,Closed"'], prompt: "Pick one", promptTitle: "Status" },
        { ref: "E2:E10000", type: "whole", formulae: ["1", "100"], error: "Use 1 to 100", errorStyle: "warning" },
        { ref: "G:G", type: "decimal", operator: "greaterThan", formulae: ["0"] },
      ],
      images: [
        { asset: "logo", tl: "D1", altText: "NORTHERN SUPPLY CO" },
        { asset: "logo", range: "A2:B3" },
        { asset: "logo", tl: "E1", ext: { width: 60 } },
      ],
      pageSetup: {
        paperSize: "A3",
        orientation: "landscape",
        fitToWidth: 1,
        fitToHeight: 2,
        margins: { left: "15mm", right: 0.5, top: "2cm", bottom: "36pt", header: 0.2, footer: "0.25in" },
        horizontalCentered: true,
        verticalCentered: true,
        printGridLines: true,
        printArea: "A1:H50",
        printTitlesRow: "4:4",
        printTitlesColumn: "A:A",
      },
      headerFooter: { oddHeader: "&LNORTHERN SUPPLY CO", oddFooter: "&RPage &P of &N", evenFooter: "&LPage &P", firstHeader: "&C&BInvoices", differentFirst: true, differentOddEven: true },
    },
    { name: "Rates", views: { rightToLeft: true }, cells: [{ ref: "A1", value: "Code" }], pageSetup: { scale: 80 } },
  ],
};

describe("buildXlsx", () => {
  it("writes every node of the design into the workbook's XML", async () => {
    const parts = await partsOf(FULL);
    const sheet = parts["xl/worksheets/sheet1.xml"]!;
    const styles = parts["xl/styles.xml"]!;
    const workbook = parts["xl/workbook.xml"]!;
    // Sheet properties, views, columns and rows.
    expect(sheet).toContain('<tabColor rgb="FF1F3A5F"/>');
    expect(sheet).toContain('<pageSetUpPr fitToPage="1"/>');
    expect(sheet).toMatch(/<sheetView[^>]*showGridLines="0"[^>]*zoomScale="90"/);
    expect(sheet).toContain('<pane xSplit="1" ySplit="4" topLeftCell="B5" state="frozen" activePane="bottomRight"/>');
    expect(sheet).toContain('<col min="1" max="2" width="12" customWidth="true"/>');
    expect(sheet).toMatch(/<col min="6" max="6" width="14" customWidth="true" style="\d+"\/>/);
    expect(sheet).toMatch(/<col min="8" max="8" width="[\d.]+" hidden="true" outlineLevel="1"\/>/);
    expect(sheet).toContain('<row r="1" ht="30" customHeight="1">');
    expect(sheet).toMatch(/<row r="2" hidden="1" outlineLevel="2"/);
    expect(parts["xl/worksheets/sheet2.xml"]).toMatch(/<sheetView[^>]*rightToLeft="1"/);
    // Values: text with tags as shared strings, a formula without = and with its prefix, a date serial, rich text, a number, a boolean.
    expect(sheet).toMatch(/<c r="F5" t="s" s="\d+"><v>\d+<\/v><\/c>/);
    expect(sheet).toContain('<f>SUM(INDIRECT("F5:F"&amp;ROW()-1))</f><v>0</v>');
    expect(sheet).toContain('<f>_xlfn.XLOOKUP("A",Rates!A:A,Rates!B:B)</f>');
    expect(sheet).toMatch(/<c r="H7" s="\d+"><v>46310<\/v><\/c>/);
    expect(sheet).toMatch(/<c r="H8" t="s"><v>\d+<\/v><\/c>/);
    expect(parts["xl/sharedStrings.xml"]).toMatch(/<si><r><rPr><sz val="11"\/><color rgb="FF1A1A1A"\/><rFont val="Calibri"\/><\/rPr><t[^>]*>Net <\/t><\/r><r><rPr><b\/>/);
    expect(sheet).toContain('<c r="H11"><v>42</v></c>');
    expect(sheet).toContain('<c r="H12" t="b"><v>1</v></c>');
    // Merges, filter, conditional formatting on whole columns, validation, links, notes, pictures, page setup.
    expect(sheet).toContain('<mergeCell ref="A1:C1"/>');
    expect(sheet).toContain('<autoFilter ref="A4:F4"/>');
    expect(sheet).toContain('<conditionalFormatting sqref="F1:F1048576">');
    for (const type of ["cellIs", "expression", "colorScale", "dataBar", "iconSet", "duplicateValues", "top10", "aboveAverage", "containsText", "beginsWith", "endsWith"]) {
      expect(sheet).toContain(`<cfRule type="${type}"`);
    }
    expect(sheet).toMatch(/<cfRule type="cellIs" priority="2" dxfId="\d+" operator="between"><formula>1<\/formula><formula>10<\/formula><\/cfRule>/);
    expect(sheet).toContain('<color rgb="FFF8696B"/><color rgb="FFFFEB84"/><color rgb="FF63BE7B"/>');
    expect(sheet).toContain('<iconSet iconSet="3TrafficLights1"><cfvo type="min"/><cfvo type="percent" val="33"/>');
    expect(sheet).toMatch(/<cfRule type="aboveAverage" priority="9" dxfId="\d+" stopIfTrue="true"\/>/);
    expect(sheet).toContain('operator="containsText" text="OY"><formula>NOT(ISERROR(SEARCH("OY",C1)))</formula>');
    expect(sheet).toContain('<formula>LEFT(C1,LEN("NORTH"))="NORTH"</formula>');
    expect(sheet).toContain('text="LTD&quot;"><formula>RIGHT(C1,LEN("LTD"""))="LTD"""</formula>');
    expect(sheet).toContain(
      '<dataValidation type="list" sqref="D1:D1048576" showInputMessage="1" promptTitle="Status" prompt="Pick one"><formula1>"Open,Closed"</formula1></dataValidation>' +
        '<dataValidation type="whole" sqref="E2:E10000" operator="between" showErrorMessage="1" errorStyle="warning" error="Use 1 to 100"><formula1>1</formula1><formula2>100</formula2></dataValidation>' +
        '<dataValidation type="decimal" sqref="G1:G1048576" operator="greaterThan"><formula1>0</formula1></dataValidation>',
    );
    expect(sheet).toMatch(/<hyperlink ref="H9" r:id="rId\d+"\/>/);
    expect(sheet).toContain('<hyperlink ref="H10" location="Rates!A1"/>');
    expect(parts["xl/worksheets/_rels/sheet1.xml.rels"]).toContain('Target="https://example.com/invoices" TargetMode="External"');
    expect(parts["xl/comments1.xml"]).toContain('<comment ref="A4"');
    expect(parts["xl/comments1.xml"]).toContain("The invoice number");
    expect(sheet).toContain('<printOptions gridLines="1" horizontalCentered="1" verticalCentered="1"/>');
    expect(sheet).toContain('<pageMargins left="0.591" right="0.5" top="0.787" bottom="0.5" header="0.2" footer="0.25"/>');
    expect(sheet).toContain('<pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="2"/>');
    expect(sheet).toContain(
      '<headerFooter differentOddEven="1" differentFirst="1"><oddHeader>&amp;LNORTHERN SUPPLY CO</oddHeader><oddFooter>&amp;RPage &amp;P of &amp;N</oddFooter><evenFooter>&amp;LPage &amp;P</evenFooter><firstHeader>&amp;C&amp;BInvoices</firstHeader></headerFooter>',
    );
    expect(parts["xl/worksheets/sheet2.xml"]).toContain('<pageSetup paperSize="9" orientation="portrait" scale="80"/>');
    expect(parts["xl/worksheets/sheet2.xml"]).not.toContain("fitToPage");
    // Styles: the default font under every font, ARGB colours, fills, borders, alignment, number formats.
    expect(styles).toContain('<font><color rgb="FF1A1A1A"/><sz val="11"/><name val="Calibri"/></font>');
    expect(styles).toContain('<font><b/><i/><u val="double"/><strike/><color rgb="FFC00000"/><sz val="14"/><name val="Calibri"/></font>');
    expect(styles).toContain('<patternFill patternType="solid"><fgColor rgb="FFE8E8E8"/></patternFill>');
    expect(styles).toContain('<gradientFill degree="90"><stop position="0"><color rgb="FFFFFFFF"/></stop><stop position="1"><color rgb="FF1F3A5F"/></stop></gradientFill>');
    expect(styles).toContain('<bottom style="thin"><color rgb="FF333333"/></bottom>');
    expect(styles).toContain('<top style="double"/>');
    expect(styles).toContain('<alignment vertical="center" wrapText="true" shrinkToFit="true" textRotation="45" indent="1"/>');
    expect(styles).toContain('formatCode="dd.mm.yyyy"');
    expect(styles).toContain('formatCode="yyyy-mm-dd"');
    // A conditional format changes only what it gives: no default font in it.
    expect(styles).toMatch(/<dxf><font><color rgb="FFC00000"\/><\/font><\/dxf>/);
    // Workbook: names, print area and titles, the active sheet.
    expect(workbook).toContain('<definedName name="Rates">Rates!$A$2:$B$9</definedName>');
    expect(workbook).toContain('<definedName name="Local" localSheetId="0">Lines!$A$1</definedName>');
    expect(workbook).toContain('<definedName name="_xlnm.Print_Area" localSheetId="0">Lines!$A$1:$H$50</definedName>');
    expect(workbook).toContain('<definedName name="_xlnm.Print_Titles" localSheetId="0">Lines!$4:$4,Lines!$A:$A</definedName>');
    expect(workbook).toContain('<definedName name="_xlnm._FilterDatabase" hidden="1" localSheetId="0">Lines!$A$4:$F$4</definedName>');
    expect(workbook).toContain('activeTab="1"');
  });

  it("names a sheet's print area, print titles and filter with the sheet in quotes when it needs them, the filter's name hidden", async () => {
    const workbook = (
      await partsOf({
        sheets: [
          { name: "Order lines", autoFilter: "A:F", pageSetup: { printArea: "A1:F50", printTitlesRow: "1:1" } },
          { name: "Bob's", pageSetup: { printTitlesColumn: "A:B" } },
        ],
      })
    )["xl/workbook.xml"]!;
    const names = [...workbook.matchAll(/<definedName [^>]*>[^<]*<\/definedName>/g)].map((m) => m[0]);
    expect(names.sort()).toEqual([
      `<definedName name="_xlnm.Print_Area" localSheetId="0">'Order lines'!$A$1:$F$50</definedName>`,
      `<definedName name="_xlnm.Print_Titles" localSheetId="0">'Order lines'!$1:$1</definedName>`,
      `<definedName name="_xlnm.Print_Titles" localSheetId="1">'Bob''s'!$A:$B</definedName>`,
      `<definedName name="_xlnm._FilterDatabase" hidden="1" localSheetId="0">'Order lines'!$A$1:$F$1048576</definedName>`,
    ]);
    // No filter, no filter name.
    expect((await partsOf(one({ cells: [{ ref: "A1", value: "x" }] })))["xl/workbook.xml"]).not.toContain("_FilterDatabase");
  });

  it("anchors a picture with tl to its cell with its size, and one with range over the range", async () => {
    const drawing = (await partsOf(FULL))["xl/drawings/drawing1.xml"]!;
    const anchors = drawing.match(/<xdr:(oneCellAnchor|twoCellAnchor)>[\s\S]*?<\/xdr:\1>/g)!;
    expect(anchors).toHaveLength(3);
    // 120 by 40 pixels, at 9525 EMU a pixel.
    expect(anchors[0]).toMatch(/^<xdr:oneCellAnchor><xdr:from><xdr:col>3<\/xdr:col><xdr:colOff>0<\/xdr:colOff><xdr:row>0<\/xdr:row><xdr:rowOff>0<\/xdr:rowOff><\/xdr:from><xdr:ext cx="1143000" cy="381000"\/><xdr:pic>/);
    expect(anchors[0]).toContain('descr="NORTHERN SUPPLY CO"');
    // B3 is the range's last cell, so the picture ends at the top-left of C4.
    expect(anchors[1]).toMatch(/^<xdr:twoCellAnchor><xdr:from><xdr:col>0<\/xdr:col>.*<xdr:row>1<\/xdr:row>.*<xdr:to><xdr:col>2<\/xdr:col>.*<xdr:row>3<\/xdr:row>/);
    // A width alone keeps the proportions: 60 by 20.
    expect(anchors[2]).toContain('<xdr:ext cx="571500" cy="190500"/>');
  });

  it("makes a file readXlsx reads, with its formulas, ranges and notes, and that passes the check", async () => {
    const bytes = await buildXlsx(FULL, images);
    const read = readXlsx(bytes);
    expect(read.sheets.map((s) => s.name)).toEqual(["Lines", "Rates"]);
    expect(read.sheets[0]).toMatchObject({
      merges: ["A1:C1"],
      formulas: 2,
      pageSetup: true,
      conditionalFormatting: ["F1:F1048576", "C1:C1048576"],
      dataValidations: ["D1:D1048576", "E2:E10000", "G1:G1048576"],
      notes: ["A4"],
      tables: [],
    });
    expect(read.formulas).toEqual([
      { sheet: "Lines", ref: "F7", row: 7, formula: 'SUM(INDIRECT("F5:F"&ROW()-1))' },
      { sheet: "Lines", ref: "G7", row: 7, formula: '_xlfn.XLOOKUP("A",Rates!A:A,Rates!B:B)' },
    ]);
    expect(read.cells.find((c) => c.ref === "F5")).toEqual({ sheet: "Lines", ref: "F5", row: 5, text: "{d.pgs[i].lines[i].amount:formatN}" });
    const { definition } = loadFixture("invoice");
    // The loop is on rows 5 to 6; the note on A4 is above it.
    expect(checkXlsx(read, definition)).toEqual([]);
  });

  it("writes rich text as a shared string, so a :formatN tag in it becomes a number in Carbone, and the check takes it", async () => {
    const design = one({ cells: [{ ref: "A1", value: { richText: [{ text: "{d.pgs[i].lines[i].amount:formatN}", font: { bold: true } }] } }] });
    const parts = await partsOf(design);
    expect(parts["xl/worksheets/sheet1.xml"]).toMatch(/<c r="A1" t="s"><v>0<\/v><\/c>/);
    expect(parts["xl/sharedStrings.xml"]).toMatch(/<si><r><rPr><b\/><sz val="10"\/><rFont val="Arial"\/><\/rPr><t>\{d\.pgs\[i\]\.lines\[i\]\.amount:formatN\}<\/t><\/r><\/si>/);
    const read = readXlsx(await buildXlsx(design, images));
    expect(read.cells).toEqual([{ sheet: "Lines", ref: "A1", row: 1, text: "{d.pgs[i].lines[i].amount:formatN}" }]);
    expect(checkXlsx(read, loadFixture("invoice").definition)).toEqual([]);
  });

  it("gives every sheet an A4 page setup, one page wide, when the design gives none", async () => {
    const sheet = (await partsOf(one({ cells: [{ ref: "A1", value: "x" }] })))["xl/worksheets/sheet1.xml"]!;
    expect(sheet).toContain('<pageSetUpPr fitToPage="1"/>');
    expect(sheet).toContain('<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>');
    expect(sheet).toContain('<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>');
    // A fit to width alone is any number of pages tall; Letter and a paper number are taken too.
    const fit = (await partsOf(one({ pageSetup: { fitToWidth: 2, paperSize: "Letter" } })))["xl/worksheets/sheet1.xml"]!;
    expect(fit).toContain('<pageSetup paperSize="1" orientation="portrait" fitToWidth="2" fitToHeight="0"/>');
    expect((await partsOf(one({ pageSetup: { paperSize: 11 } })))["xl/worksheets/sheet1.xml"]).toContain('paperSize="11"');
  });

  it("writes the default font, Arial 10 when not given, under each style's font, and a column's style under its cells", async () => {
    const parts = await partsOf(
      one({ columns: [{ ref: "B", style: { numFmt: "0.0", font: { italic: true } } }], cells: [{ ref: "A1", value: "x", style: { font: { bold: true } } }, { ref: "B2", value: 1.5, style: { font: { color: "1F3A5F" } } }] }),
    );
    const styles = parts["xl/styles.xml"]!;
    expect(styles).toContain('<font><sz val="10"/><name val="Arial"/></font>');
    expect(styles).toContain('<font><b/><sz val="10"/><name val="Arial"/></font>');
    // B2 takes the column's number format and italics, and its own colour.
    expect(styles).toContain('<font><i/><color rgb="FF1F3A5F"/><sz val="10"/><name val="Arial"/></font>');
    const b2 = /<c r="B2" s="(\d+)">/.exec(parts["xl/worksheets/sheet1.xml"]!)![1];
    const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)![1]!.match(/<xf [^>]*>/g)!;
    expect(xfs[Number(b2)]).toMatch(/numFmtId="16\d"/);
  });

  it("refuses unknown keys and values, each with its path", async () => {
    expect(
      await problems({
        sheets: [
          {
            name: "Lines",
            tables: [],
            cells: [
              { ref: "A1", value: "x", style: { fill: { type: "solid" } } },
              { ref: "B1", style: { fill: { type: "pattern", pattern: "solid", stops: [] } } },
              { ref: "C1", style: { font: { color: "red" } } },
              { ref: "1A" },
            ],
          },
        ],
      }),
    ).toEqual([
      'sheets[0].cells[0].style.fill.type: Invalid option: expected one of "pattern"|"gradient"',
      "sheets[0].cells[1].style.fill.stops: Too small: expected array to have >=2 items",
      'sheets[0].cells[1].style.fill.stops: "stops" is not used by a pattern fill. Use "type", "pattern", "fgColor", "bgColor".',
      'sheets[0].cells[2].style.font.color: Use six hex digits such as "1F3A5F"',
      'sheets[0].cells[3].ref: Use a cell such as "B5"',
      'sheets[0]: Unknown key "tables"',
    ]);
  });

  it("refuses rules, validations, pictures and page setups that miss or mix keys", async () => {
    expect(
      await problems(
        one({
          cells: [{ ref: "A1", value: [1] }],
          conditionalFormatting: [{ ref: "A:A", rules: [{ type: "cellIs", formulae: ["1"], style: {} }, { type: "dataBar", cfvo: [{ type: "min" }, { type: "max" }], color: "638EC6", style: {} }] }],
          dataValidations: [{ ref: "B:B", type: "whole", formulae: ["1"] }, { ref: "C:C", type: "list", operator: "equal", formulae: ['"a"'] }],
          images: [{ asset: "logo", tl: "A1", range: "A1:B2", ext: { width: 10 } }],
          pageSetup: { scale: 80, fitToWidth: 1 },
          autoFilter: "A1:",
        }),
      ),
    ).toEqual([
      'sheets[0].autoFilter: Use a range such as "A2:F9", whole columns such as "A:F", or a cell',
      "sheets[0].conditionalFormatting[0].rules[0].operator: Give the operator: between, notBetween, equal, notEqual, greaterThan, lessThan, greaterThanOrEqual, lessThanOrEqual",
      'sheets[0].conditionalFormatting[0].rules[1].style: "style" is not used by a dataBar rule. Use "type", "cfvo", "color".',
      "sheets[0].dataValidations[0].formulae: Give two formulae, the low and the high value",
      "sheets[0].dataValidations[1].operator: A list validation takes no operator",
      'sheets[0].images[0].tl: Give "tl" (and "ext") or "range", one of them',
      'sheets[0].images[0].ext: A picture with "range" fills the range: give "ext" with "tl"',
      "sheets[0].pageSetup.scale: Give scale, or fitToWidth and fitToHeight, not both: fitting to pages sets the scale",
    ]);
  });

  it("refuses what the checks after the schema find, each with its path", async () => {
    const found = await problems({
      definedNames: [{ name: "A1", ref: "Nowhere!$A$1" }, { name: "_xlnm.Print_Area", ref: "Lines!$A$1", sheet: "Other" }],
      activeSheet: 4,
      sheets: [
        {
          name: "Lines",
          columns: [{ ref: "A:C" }, { ref: "B" }, { ref: "AMK" }],
          rows: [{ row: 2 }, { row: 2 }],
          cells: [
            { ref: "A1", value: { date: "2026-02-30" } },
            { ref: "a1", value: "again" },
            { ref: "B1", value: { formula: "SUM(A:A)", extra: 1 } },
            // Rich text may hold :formatN: it is a shared string, as Carbone needs it.
            { ref: "C1", value: { richText: [{ text: "{d.pg.total:formatN}" }] } },
            { ref: "D1", value: "x", hyperlink: "ftp://example.com" },
            { ref: "E1", value: "x", hyperlink: "#Nowhere!A1" },
          ],
          merges: ["A1:B2", "B2:C3", "D1"],
          images: [{ asset: "missing", tl: "A1" }],
        },
        { name: "lines" },
        { name: "Bad:name" },
        { name: "History" },
      ],
    });
    expect(found).toEqual([
      "sheets[1].name: sheets[0] has this name already. Give each sheet its own name.",
      "sheets[2].name: A sheet name cannot hold [ ] : * ? / or \\.",
      'sheets[3].name: "History" is a name Excel keeps for itself. Use another.',
      "sheets[0].columns[1].ref: Column B is in an earlier entry too. Give each column once.",
      "sheets[0].columns[2].ref: Columns go up to AMJ.",
      "sheets[0].rows[1].row: Row 2 is in an earlier entry too. Give each row once.",
      'sheets[0].cells[0].value: Give a date as { "date": "2026-10-15" }, from 1900-03-01 on.',
      "sheets[0].cells[1].ref: A1 is given in cells[0] too. Give each cell once.",
      'sheets[0].cells[2].value: Unknown key "extra"',
      "sheets[0].cells[4].hyperlink: Use a URL that starts with https://, http:// or mailto:, or a place such as #Lines!A1.",
      "sheets[0].cells[5].hyperlink: Use a place in the workbook such as #'Order lines'!A1, with a sheet of this workbook.",
      "sheets[0].merges[1]: B2:C3 overlaps merges[0] (A1:B2). Merged ranges cannot overlap.",
      "sheets[0].merges[2]: A merge needs at least two cells.",
      'sheets[0].images[0].asset: There is no PNG or JPEG asset "missing". Use one of the uploaded image assets.',
      "activeSheet: There are 4 sheets: use 0 to 3.",
      "definedNames[0].name: A name cannot look like a cell. Use a word such as Rates.",
      "definedNames[0].ref: Use a sheet and range such as Lines!$A$2:$B$20, with a sheet of this workbook.",
      "definedNames[1].name: Set print areas and print titles in the sheet's pageSetup.",
      'definedNames[1].sheet: There is no sheet "Other".',
    ]);
  });

  it("lists at most 30 problems, and refuses a design over its limits", async () => {
    const many = one({ cells: Array.from({ length: 40 }, (_, n) => ({ ref: `A${n + 1}`, value: [n] })) });
    expect(await problems(many)).toHaveLength(30);
    const huge = one({ cells: Array.from({ length: 7000 }, (_, n) => ({ ref: `A${n + 1}`, style: { font: { bold: true } } })) });
    expect(await problems(huge)).toEqual(["(the document): The design has more than 20000 nodes. Make it smaller."]);
    expect(await problems(one({ cells: Array.from({ length: 10_001 }, (_, n) => ({ ref: `A${n + 1}` })) }))).toEqual(["sheets[0].cells: Give at most 10000 cells on a sheet"]);
    expect(await problems({ sheets: [] })).toEqual(["sheets: Give at least one sheet"]);
    expect(await problems(one({ cells: [{ ref: "A1", value: "x".repeat(32_768) }] }))).toEqual(["sheets[0].cells[0].value: Use at most 32767 characters."]);
    expect(await problems(one({ cells: [{ ref: "XFE1" }, { ref: "A1048577" }] }))).toEqual(["sheets[0].cells[0].ref: The cell is outside the sheet", "sheets[0].cells[1].ref: The cell is outside the sheet"]);
    expect(await problems(one({ columns: [{ ref: "A", width: 300 }], rows: [{ row: 1, height: 500 }], views: { zoom: 5 }, pageSetup: { scale: 5, margins: { left: 11 } } }))).toEqual([
      "sheets[0].views.zoom: Too small: expected number to be >=10",
      "sheets[0].columns[0].width: Too big: expected number to be <=255",
      "sheets[0].rows[0].height: Too big: expected number to be <=409",
      "sheets[0].pageSetup.scale: Too small: expected number to be >=10",
      "sheets[0].pageSetup.margins.left: Use 0 to 10 inches",
    ]);
  });
});

describe("function prefixes", () => {
  /** The formula of A1, a conditional format and a validation, as the design's file stores them. */
  async function written(formula: string): Promise<string[]> {
    const design = one({
      cells: [{ ref: "A1", value: { formula } }],
      conditionalFormatting: [{ ref: "B:B", rules: [{ type: "expression", formulae: [formula], style: { font: { bold: true } } }] }],
      dataValidations: [{ ref: "C:C", type: "custom", formulae: [formula] }],
    });
    const sheet = (await partsOf(design))["xl/worksheets/sheet1.xml"]!;
    const decode = (xml: string) => xml.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    return [/<f>(.*?)<\/f>/.exec(sheet)![1]!, /<formula>(.*?)<\/formula>/.exec(sheet)![1]!, /<formula1>(.*?)<\/formula1>/.exec(sheet)![1]!].map(decode);
  }

  it.each([
    ['XLOOKUP("A",A:A,B:B)', '_xlfn.XLOOKUP("A",A:A,B:B)'],
    ['IFNA(TEXTJOIN(",",TRUE,A1:A9),"")', '_xlfn.IFNA(_xlfn.TEXTJOIN(",",TRUE,A1:A9),"")'],
    ["SUM(FILTER(C2:C9,C2:C9>5))+ROWS(_xlfn._xlws.FILTER(C2:C9,C2:C9>5))", "SUM(_xlfn._xlws.FILTER(C2:C9,C2:C9>5))+ROWS(_xlfn._xlws.FILTER(C2:C9,C2:C9>5))"],
    ["_xlfn.XLOOKUP(1,A:A,B:B)", "_xlfn.XLOOKUP(1,A:A,B:B)"],
    ['"IFS(1)"&IFS(A1>1,"x",TRUE,"y")', '"IFS(1)"&_xlfn.IFS(A1>1,"x",TRUE,"y")'],
    ["'SORT (old)'!A1+SORT(A1:A9)", "'SORT (old)'!A1+_xlfn._xlws.SORT(A1:A9)"],
    ['SUMIFS(C:C,A:A,"X")+INDEX(B:B,MATCH(1,A:A,0))', 'SUMIFS(C:C,A:A,"X")+INDEX(B:B,MATCH(1,A:A,0))'],
    ["MYSORT(A1)+CONCAT(A1,B1)+CONCATENATE(A1)", "MYSORT(A1)+_xlfn.CONCAT(A1,B1)+CONCATENATE(A1)"],
  ])("writes %s in a design as %s", async (formula, prefixed) => {
    expect(await written(formula)).toEqual([prefixed, prefixed, prefixed]);
    expect(missingPrefixes(prefixed)).toEqual([]);
  });

  it("finds a wrong prefix in a design's file, so the check names it", async () => {
    const [cell] = await written("ROWS(_xlfn.FILTER(C2:C9,C2:C9>5))");
    expect(missingPrefixes(cell!)).toEqual([{ name: "FILTER", prefixed: "_xlfn._xlws.FILTER" }]);
  });

  it("names each newer function written without its prefix once", () => {
    expect(missingPrefixes('XLOOKUP(1,A:A,B:B)+XLOOKUP(2,A:A,B:B)+_xlfn.FILTER(A:A,A:A>1)+"MAXIFS("')).toEqual([
      { name: "XLOOKUP", prefixed: "_xlfn.XLOOKUP" },
      { name: "FILTER", prefixed: "_xlfn._xlws.FILTER" },
    ]);
  });

  it("reads a long formula in linear time", TIMING, () => {
    expect(missingPrefixes("A".repeat(200_000))).toEqual([]);
    expect(missingPrefixes(`${"_xlfn.".repeat(50_000)}A`)).toEqual([]);
    expect(missingPrefixes(`${"SUM(".repeat(20_000)}XLOOKUP(1)`)).toEqual([{ name: "XLOOKUP", prefixed: "_xlfn.XLOOKUP" }]);
    linear((n) => "A".repeat(n), missingPrefixes, 204_800);
    linear((n) => `${"_xlfn.".repeat(n)}A`, missingPrefixes, 51_200);
    linear((n) => `${"SUM(".repeat(n)}XLOOKUP(1)`, missingPrefixes, 19_200);
  });
});
