import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { checkDocx, readDocx } from "../src/docx.js";
import { buildDocx, DesignError, imageInfo, type DesignImage } from "../src/docx-design.js";
import { invoiceDesign } from "./helpers/invoice-design.js";
import { loadFixture } from "./helpers/fixtures.js";
import { testPng } from "./helpers/png.js";

const logoBytes = testPng(400, 100);
const logo: DesignImage = { data: logoBytes, type: "png", width: 400, height: 100 };
const images = (name: string): DesignImage | undefined => (name === "logo" ? logo : undefined);

/** The text of each file in a built `.docx`. */
async function parts(design: unknown): Promise<Record<string, string>> {
  const files = unzipSync(await buildDocx(design, images));
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, name.startsWith("word/media/") ? `${bytes.length} bytes` : strFromU8(bytes)]));
}

const section = (children: unknown[], extra: Record<string, unknown> = {}) => ({ sections: [{ children, ...extra }] });
const paragraph = (extra: Record<string, unknown>) => ({ type: "Paragraph", ...extra });

/** The problems a design is refused with. */
async function refused(design: unknown): Promise<string[]> {
  try {
    await buildDocx(design, images);
  } catch (error) {
    if (error instanceof DesignError) return error.problems;
    throw error;
  }
  throw new Error("expected a DesignError");
}

describe("buildDocx", () => {
  it("builds the invoice design into a Word template that reads and checks clean", async () => {
    const bytes = await buildDocx(invoiceDesign, images);
    const template = readDocx(bytes);
    expect(checkDocx(template, loadFixture("invoice").definition)).toEqual([]);
    expect(template.fields).toEqual(["PAGE", "NUMPAGES"]);
    const text = template.text;
    expect(text).toContain("{d.pageGroup.lines[i].amount:formatN(2)}");
    expect(text).toContain("{d.pageGroup.lines[i+1]}");
    expect(text).toContain("{d.pageGroup.address1}{d.pageGroup.address2:ifEM:hideBegin}\n{d.pageGroup.address2}{d.pageGroup.address2:hideEnd}");
    expect(template.paragraphs.some((p) => p.part === "header" && p.text === "Invoice {d.pageGroup.invoiceNo}\t{d.pageGroup.customerName}")).toBe(true);
  });

  it("puts each part of a page field in its own run, as Word does", async () => {
    const files = await parts(section([paragraph({ children: [{ type: "PageNumber", field: "NUMPAGES", size: 16, color: "555555" }] })]));
    const body = files["word/document.xml"]!;
    const runs = body.match(/<w:r>[\s\S]*?<\/w:r>/g)!;
    expect(runs).toHaveLength(4);
    expect(runs[0]).toContain('w:fldCharType="begin"');
    expect(runs[1]).toContain("<w:instrText xml:space=\"preserve\"> NUMPAGES </w:instrText>");
    expect(runs[2]).toContain('w:fldCharType="separate"');
    expect(runs[3]).toContain('w:fldCharType="end"');
    for (const run of runs) expect(run).toContain('<w:sz w:val="16"/>');
  });

  it("makes an A4 page with 20 mm margins unless the design says otherwise", async () => {
    const plain = (await parts(section([paragraph({ text: "x" })])))["word/document.xml"]!;
    expect(plain).toMatch(/<w:pgSz w:w="11906" w:h="16838"/);
    expect(plain).toMatch(/<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/);
    const letter = (
      await parts(section([paragraph({ text: "x" })], { properties: { page: { size: { width: "8.5in", height: "11in", orientation: "landscape" }, margin: { top: "15mm", left: 720 } } } }))
    )["word/document.xml"]!;
    expect(letter).toMatch(/<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/);
    expect(letter).toMatch(/<w:pgMar w:top="850" w:right="1134" w:bottom="1134" w:left="720"/);
  });

  it("writes paragraph and run formatting with units converted", async () => {
    const body = (
      await parts(
        section([
          paragraph({
            alignment: "right",
            spacing: { before: "6pt", after: 120, line: 276 },
            indent: { left: "1cm", hanging: "5mm" },
            border: { bottom: { style: "single", size: 6, color: "#333333", space: 2 } },
            shading: { fill: "f2f2f2" },
            tabStops: [{ type: "right", position: "170mm", leader: "dot" }],
            keepNext: true,
            keepLines: true,
            pageBreakBefore: true,
            children: [
              {
                type: "TextRun",
                text: "Total",
                bold: true,
                italics: true,
                underline: { type: "double", color: "1F3A5F" },
                color: "1F3A5F",
                size: "10.5pt",
                font: "Georgia",
                allCaps: true,
                characterSpacing: 20,
                highlight: "yellow",
              },
              { type: "TextRun", text: "2", superScript: true, break: 1 },
              { type: "Tab" },
            ],
          }),
          paragraph({ heading: "Heading1", text: "Lines" }),
          paragraph({ style: "Small", text: "Small" }),
          paragraph({ bullet: { level: 1 }, text: "A note" }),
        ]),
      )
    )["word/document.xml"]!;
    expect(body).toContain('<w:jc w:val="right"/>');
    expect(body).toMatch(/<w:spacing w:after="120" w:before="120" w:line="276"\/>/);
    expect(body).toMatch(/<w:ind w:left="567" w:hanging="283"\/>/);
    expect(body).toMatch(/<w:bottom w:val="single" w:color="333333" w:sz="6" w:space="2"\/>/);
    expect(body).toMatch(/<w:shd w:fill="F2F2F2" w:color="auto" w:val="clear"\/>/);
    expect(body).toMatch(/<w:tab w:val="right" w:pos="9638" w:leader="dot"\/>/);
    for (const tag of ["<w:keepNext/>", "<w:keepLines/>", "<w:pageBreakBefore/>", "<w:b/>", "<w:i/>", "<w:caps/>", '<w:vertAlign w:val="superscript"/>', "<w:br/>", "<w:tab/>"]) {
      expect(body).toContain(tag);
    }
    expect(body).toContain('<w:u w:val="double" w:color="1F3A5F"/>');
    expect(body).toContain('<w:sz w:val="21"/>');
    expect(body).toContain('<w:rFonts w:ascii="Georgia" w:cs="Georgia" w:eastAsia="Georgia" w:hAnsi="Georgia"/>');
    expect(body).toContain('<w:spacing w:val="20"/>');
    expect(body).toContain('<w:highlight w:val="yellow"/>');
    expect(body).toContain('<w:pStyle w:val="Heading1"/>');
    expect(body).toContain('<w:pStyle w:val="Small"/>');
    expect(body).toMatch(/<w:numPr><w:ilvl w:val="1"\/>/);
  });

  it("writes named paragraph styles and the default font", async () => {
    const styles = (
      await parts({
        styles: {
          default: { document: { run: { font: "Arial", size: 20 } }, heading1: { run: { size: "14pt", bold: true, color: "1F3A5F" } } },
          paragraphStyles: [{ id: "Small", name: "Small", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 15, color: "555555" }, paragraph: { spacing: { after: 0 } } }],
        },
        sections: [{ children: [paragraph({ style: "Small", text: "x" })] }],
      })
    )["word/styles.xml"]!;
    expect(styles).toMatch(/<w:style w:type="paragraph" w:styleId="Small">[\s\S]*?<w:name w:val="Small"\/>[\s\S]*?<w:basedOn w:val="Normal"\/>[\s\S]*?<w:sz w:val="15"\/>/);
    expect(styles).toMatch(/<w:docDefaults>[\s\S]*?w:ascii="Arial"[\s\S]*?<w:sz w:val="20"\/>/);
    expect(styles).toMatch(/w:styleId="Heading1">[\s\S]*?<w:sz w:val="28"\/>/);
  });

  it("builds tables with widths, borders, shading, merged cells and header rows", async () => {
    const cell = (text: string, extra: Record<string, unknown> = {}) => ({ type: "TableCell", children: [paragraph({ text })], ...extra });
    const body = (
      await parts(
        section([
          {
            type: "Table",
            width: { size: "100%", type: "pct" },
            columnWidths: ["60mm", "40mm", 1000],
            layout: "fixed",
            alignment: "center",
            borders: { top: { style: "none" }, insideHorizontal: { style: "single", size: 4, color: "CCCCCC" } },
            margins: { top: 60, bottom: 60, left: "2mm", right: "2mm" },
            rows: [
              {
                type: "TableRow",
                tableHeader: true,
                cantSplit: true,
                height: { value: "8mm", rule: "exact" },
                children: [cell("A", { columnSpan: 2, shading: { fill: "1F3A5F" } }), cell("B", { rowSpan: 2, verticalAlign: "center" })],
              },
              {
                type: "TableRow",
                children: [
                  cell("C", { width: { size: "60mm", type: "dxa" }, borders: { bottom: { style: "double", size: 6 } }, margins: { left: 0 } }),
                  { type: "TableCell" },
                ],
              },
            ],
          },
        ]),
      )
    )["word/document.xml"]!;
    expect(body).toContain('<w:tblW w:type="pct" w:w="100%"/>');
    expect(body).toContain('<w:tblLayout w:type="fixed"/>');
    expect(body).toMatch(/<w:gridCol w:w="3402"\/><w:gridCol w:w="2268"\/><w:gridCol w:w="1000"\/>/);
    expect(body).toContain("<w:tblHeader/>");
    expect(body).toContain("<w:cantSplit/>");
    expect(body).toMatch(/<w:trHeight w:val="454" w:hRule="exact"\/>/);
    expect(body).toContain('<w:gridSpan w:val="2"/>');
    expect(body).toContain('<w:vMerge w:val="restart"/>');
    expect(body).toContain('<w:vAlign w:val="center"/>');
    expect(body).toMatch(/<w:shd w:fill="1F3A5F" w:color="auto" w:val="clear"\/>/);
    expect(body).toContain('<w:tcW w:type="dxa" w:w="3402"/>');
    // An empty cell still gets the paragraph Word needs.
    expect(body).toMatch(/<w:tc><w:tcPr>[\s\S]*?<\/w:tcPr><w:p\/><\/w:tc>|<w:tc><w:p\/><\/w:tc>/);
  });

  it("puts first, default and even headers and footers in their own parts", async () => {
    const files = await parts({
      evenAndOddHeaderAndFooters: true,
      sections: [
        {
          properties: { titlePage: true },
          headers: { first: { children: [paragraph({ children: [{ type: "ImageRun", asset: "logo", width: 200 }] })] }, default: { children: [paragraph({ text: "Running head" })] } },
          footers: { default: { children: [paragraph({ text: "Odd" })] }, even: { children: [paragraph({ text: "Even" })] } },
          children: [paragraph({ text: "Body" })],
        },
      ],
    });
    const body = files["word/document.xml"]!;
    expect(body).toContain("<w:titlePg/>");
    expect(body).toMatch(/<w:headerReference w:type="first"/);
    expect(body).toMatch(/<w:footerReference w:type="even"/);
    expect(files["word/settings.xml"]).toContain("<w:evenAndOddHeaders/>");
    const headers = Object.keys(files).filter((name) => /^word\/header\d+\.xml$/.test(name));
    const footers = Object.keys(files).filter((name) => /^word\/footer\d+\.xml$/.test(name));
    expect(headers).toHaveLength(2);
    expect(footers).toHaveLength(2);
    expect(Object.keys(files).filter((name) => /^word\/media\/.+/.test(name))).toHaveLength(1);
    expect(files[headers.find((name) => files[name]!.includes("<w:drawing>"))!]).toMatch(/<wp:extent cx="1905000" cy="476250"\/>/);
  });

  it("keeps an image's proportions when one side is given, and fits it to the page when none is", async () => {
    const extent = async (image: Record<string, unknown>) => {
      const body = (await parts(section([paragraph({ children: [{ type: "ImageRun", asset: "logo", ...image }] })])))["word/document.xml"]!;
      const [, cx, cy] = /<wp:extent cx="(\d+)" cy="(\d+)"\/>/.exec(body)!;
      return [Number(cx) / 9525, Number(cy) / 9525];
    };
    expect(await extent({ height: 50 })).toEqual([200, 50]);
    expect(await extent({})).toEqual([400, 100]);
    expect(await extent({ width: 120, height: 90, altText: "Company logo" })).toEqual([120, 90]);
  });

  it("refuses unknown node types with their path and the types allowed there", async () => {
    expect(await refused(section([{ type: "Image" }]))).toEqual(['sections[0].children[0]: "Image" is not allowed here. Use "Paragraph", "Table".']);
    expect(await refused(section([paragraph({ children: [{ type: "Paragraph" }] })]))).toEqual([
      'sections[0].children[0].children[0]: "Paragraph" is not allowed here. Use "TextRun", "Tab", "PageNumber", "ImageRun".',
    ]);
    expect(await refused(section([{ text: "no type" }]))).toEqual(['sections[0].children[0]: Give the node a type. Use "Paragraph", "Table".']);
    expect(await refused(section([{ type: "ImportedXmlComponent", rootKey: "w:p" }]))).toHaveLength(1);
    expect(await refused(section([{ type: "Table", rows: [{ type: "TableCell" }] }]))).toEqual(['sections[0].children[0].rows[0]: "TableCell" is not allowed here. Use "TableRow".']);
  });

  it("refuses unknown keys, bad values and missing assets, all at once", async () => {
    const problems = await refused(
      section([
        paragraph({ text: "a", onClick: "x" }),
        paragraph({ alignment: "middle" }),
        paragraph({ children: [{ type: "TextRun", text: "a", color: "red", size: "12px" }] }),
        paragraph({ children: [{ type: "ImageRun", asset: "missing" }] }),
        paragraph({ text: "a", children: [{ type: "Tab" }] }),
        { type: "Table", rows: [] },
        paragraph({ style: "Small", bullet: { level: 0 }, text: "a" }),
      ]),
    );
    expect(problems).toEqual([
      'sections[0].children[0]: Unknown key "onClick"',
      expect.stringMatching(/^sections\[0\]\.children\[1\]\.alignment: /),
      'sections[0].children[2].children[0].color: Use six hex digits such as "1F3A5F", or "auto"',
      expect.stringMatching(/^sections\[0\]\.children\[2\]\.children\[0\]\.size: Use half-points/),
      'sections[0].children[3].children[0].asset: There is no PNG or JPEG asset "missing". Use one of the uploaded image assets.',
      'sections[0].children[4]: Give "text" or "children", not both.',
      "sections[0].children[5].rows: A table needs at least one row",
      'sections[0].children[6]: Give one of "style" and "bullet": each sets the paragraph\'s style. Format a bullet with its own keys.',
    ]);
    expect(await refused({ sections: [] })).toEqual(["sections: Give at least one section"]);
    expect(await refused({ sections: [{ children: [] }], script: "x" })).toEqual(['(the document): Unknown key "script"']);
    expect(await refused("not a tree")).toHaveLength(1);
  });

  it("refuses tables nested too deep and designs with too many nodes", async () => {
    let table: unknown = paragraph({ text: "deep" });
    for (let i = 0; i < 4; i++) table = { type: "Table", rows: [{ type: "TableRow", children: [{ type: "TableCell", children: [table] }] }] };
    expect((await refused(section([table])))[0]).toMatch(/Tables can sit at most 3 deep/);
    const many = Array.from({ length: 2000 }, () => paragraph({ children: Array.from({ length: 11 }, () => ({ type: "Tab" })) }));
    expect(await refused(section(many))).toContain("(the document): The design has more than 20000 nodes. Make it smaller.");
  });
});

describe("imageInfo", () => {
  it("reads the size of a PNG and a JPEG, and nothing else", () => {
    expect(imageInfo(testPng(320, 80))).toEqual({ type: "png", width: 320, height: 80 });
    // SOI, an APP0 segment of 16 bytes, then a baseline frame of 600 x 200.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x02, 0x58, 0x03]);
    expect(imageInfo(jpeg)).toEqual({ type: "jpg", width: 600, height: 200 });
    expect(imageInfo(new TextEncoder().encode("GIF89a........"))).toBeNull();
    expect(imageInfo(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});
