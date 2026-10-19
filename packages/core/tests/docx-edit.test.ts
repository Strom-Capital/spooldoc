import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readDocx, starterDocx } from "../src/docx.js";
import { docxParts, DocxEditError, editDocx, mergeRuns, readDocxPart, xmlProblem } from "../src/docx-edit.js";
import { pdfPageCount } from "../src/render.js";
import { loadFixture } from "./helpers/fixtures.js";
import { testPng } from "./helpers/png.js";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const BOLD = "<w:rPr><w:b/></w:rPr>";

/** A .docx as Word saves one: the body, a header and footer, styles and a picture. */
function wordFile(body: string): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types/>'),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W}><w:body>${body}</w:body></w:document>`),
    "word/header1.xml": strToU8(`<w:hdr ${W}><w:p><w:r><w:t>Invoice {d.doc.invoiceNo}</w:t></w:r></w:p></w:hdr>`),
    "word/footer1.xml": strToU8(`<w:ftr ${W}><w:p><w:r><w:t>Page</w:t></w:r></w:p></w:ftr>`),
    "word/styles.xml": strToU8(`<w:styles ${W}><w:style w:styleId="Normal"/></w:styles>`),
    "word/media/image1.png": testPng(20, 10),
  });
}

/** Body text as Word writes it: a tag split over runs by spell-checking and later typing. */
const SPLIT_BODY =
  `<w:p><w:r w:rsidR="00A1"><w:t xml:space="preserve">Customer </w:t></w:r><w:proofErr w:type="spellStart"/><w:r w:rsidR="00B2"><w:t>{d.doc.cust</w:t></w:r>` +
  `<w:r w:rsidR="00C3"><w:t>omerName}</w:t></w:r><w:proofErr w:type="spellEnd"/><w:r>${BOLD}<w:t xml:space="preserve"> due </w:t></w:r><w:r>${BOLD}<w:lastRenderedPageBreak/><w:t>{d.doc.dueDate}</w:t></w:r>` +
  `<w:r><w:tab/></w:r><w:r><w:t>end</w:t></w:r></w:p>`;

const files = (bytes: Uint8Array) => unzipSync(bytes);

describe("mergeRuns", () => {
  it("merges adjacent runs with the same formatting and drops spell-check marks", () => {
    expect(mergeRuns(SPLIT_BODY)).toBe(
      `<w:p><w:r w:rsidR="00A1"><w:t xml:space="preserve">Customer {d.doc.customerName}</w:t></w:r><w:r>${BOLD}<w:t xml:space="preserve"> due {d.doc.dueDate}</w:t></w:r>` +
        `<w:r><w:tab/></w:r><w:r><w:t>end</w:t></w:r></w:p>`,
    );
  });

  it("leaves runs with other content, other formatting or nothing to merge as they are", () => {
    const xml = `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>a</w:t></w:r><w:r>${BOLD}<w:t>b</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:rFonts w:ascii="Arial"/></w:rPr><w:t>c</w:t></w:r></w:p>`;
    expect(mergeRuns(xml)).toBe(xml);
  });

  it("merges inside text boxes too, and keeps empty texts", () => {
    const xml = "<w:p><w:r><mc:AlternateContent><w:p><w:r><w:t>x</w:t></w:r><w:r><w:t>y</w:t></w:r></w:p></mc:AlternateContent></w:r><w:r><w:t/></w:r><w:r><w:t>z</w:t></w:r></w:p>";
    expect(mergeRuns(xml)).toBe(
      '<w:p><w:r><mc:AlternateContent><w:p><w:r><w:t xml:space="preserve">xy</w:t></w:r></w:p></mc:AlternateContent></w:r><w:r><w:t xml:space="preserve">z</w:t></w:r></w:p>',
    );
  });
});

describe("xmlProblem", () => {
  it("accepts well-formed XML", () => {
    expect(xmlProblem(`<?xml version="1.0"?>\n<!-- c --><w:document ${W} a='1'><w:t>&amp; &#x41; &lt;</w:t><![CDATA[<x>]]><w:br/></w:document>`)).toBeNull();
  });

  it.each([
    ["<a><b></a>", "</a> on line 1 closes <b>, which is still open."],
    ["<a><b>", "<b> is never closed."],
    ["<a>x & y</a>", "A bare & in text on line 1. Write it as &amp;."],
    ['<a b="1" b="2"/>', "The attribute b twice in <a> on line 1."],
    ["<a b=1/>", "An attribute without a quoted value in <a> on line 1."],
    ['<a b="<"/>', "A < inside an attribute value on line 1. Write it as &lt;."],
    ["<a/><b/>", "A second root element <b> on line 1."],
    ["</a>", "</a> on line 1 closes nothing."],
    ["<a><b</a>", "A tag that is never closed with > on line 1."],
    ["text", "There is no root element."],
  ])("finds the problem in %s", (xml, problem) => {
    expect(xmlProblem(xml)).toBe(problem);
  });
});

describe("docxParts and readDocxPart", () => {
  it("lists the body, headers and footers, and reads a part with its runs merged", () => {
    const bytes = wordFile(SPLIT_BODY);
    expect(docxParts(bytes).map((p) => p.name)).toEqual(["word/document.xml", "word/header1.xml", "word/footer1.xml"]);
    expect(readDocxPart(bytes, "word/document.xml")).toContain("Customer {d.doc.customerName}");
    expect(() => readDocxPart(bytes, "word/styles.xml")).toThrow('There is no part "word/styles.xml". The parts are word/document.xml, word/header1.xml, word/footer1.xml.');
  });

  it("says what is wrong with a file that is not a Word document", () => {
    expect(() => docxParts(new TextEncoder().encode("not a zip"))).toThrow(/not a Word document/);
  });
});

describe("editDocx", () => {
  it("finds a tag Word split over runs, keeps the formatting and leaves every other file as it was", () => {
    const before = wordFile(SPLIT_BODY);
    const after = editDocx(before, [
      { part: "word/document.xml", find: "{d.doc.dueDate}", replace: "{d.doc.dueDate:formatD('DD.MM.YYYY')}" },
      { part: "word/header1.xml", find: "Invoice ", replace: "Invoice no " },
    ]);
    const old = files(before);
    const out = files(after);
    expect(Object.keys(out)).toEqual(Object.keys(old));
    for (const name of ["[Content_Types].xml", "word/footer1.xml", "word/styles.xml", "word/media/image1.png"]) {
      expect(Buffer.from(out[name]!).equals(Buffer.from(old[name]!))).toBe(true);
    }
    const body = strFromU8(out["word/document.xml"]!);
    expect(body).toContain(`<w:r>${BOLD}<w:t xml:space="preserve"> due {d.doc.dueDate:formatD('DD.MM.YYYY')}</w:t></w:r>`);
    expect(body.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n')).toBe(true);
    expect(readDocx(after).paragraphs.map((p) => p.text)).toEqual([
      "Customer {d.doc.customerName} due {d.doc.dueDate:formatD('DD.MM.YYYY')}\tend",
      "Invoice no {d.doc.invoiceNo}",
      "Page",
    ]);
  });

  it("applies edits in order, so a later edit sees an earlier one", () => {
    const after = editDocx(wordFile(SPLIT_BODY), [
      { part: "word/document.xml", find: "end", replace: "{d.doc.orderNo}" },
      { part: "word/document.xml", find: "{d.doc.orderNo}", replace: "{d.doc.reference}" },
    ]);
    expect(readDocx(after).paragraphs[0]!.text).toMatch(/\t\{d\.doc\.reference\}$/);
  });

  it("edits a starter template, which the docx library wrote", async () => {
    const before = await starterDocx(loadFixture("invoice").definition);
    const after = editDocx(before, [{ part: "word/document.xml", find: ">Invoice<", replace: ">Sales invoice<" }]);
    expect(readDocx(after).paragraphs[0]!.text).toBe("Sales invoice");
  });

  it("refuses text that is missing or found more than once, and parts it does not edit", () => {
    const bytes = wordFile(SPLIT_BODY);
    const error = (edits: Parameters<typeof editDocx>[1]): string => {
      try {
        editDocx(bytes, edits);
      } catch (e) {
        expect(e).toBeInstanceOf(DocxEditError);
        return (e as Error).message;
      }
      throw new Error("expected an error");
    };
    expect(error([{ part: "word/document.xml", find: "{d.doc.missing}", replace: "x" }])).toMatch(/^The text to find is not in word\/document.xml\./);
    expect(error([{ part: "word/document.xml", find: "<w:r>", replace: "<w:r>" }])).toMatch(/occurs more than once/);
    expect(error([{ part: "word/styles.xml", find: "Normal", replace: "x" }])).toMatch(/^There is no part "word\/styles.xml"/);
    expect(error([{ part: "word/document.xml", find: "", replace: "x" }])).toMatch(/find is empty/);
    expect(error([])).toBe("Give at least one edit.");
    expect(error([{ part: "word/document.xml", find: "end", replace: "x" }, { part: "word/document.xml", find: "nope", replace: "y" }])).toMatch(/^Edit 2: /);
  });

  it("refuses an edit that breaks the XML, and saves none of the edits", () => {
    expect(() =>
      editDocx(wordFile(SPLIT_BODY), [
        { part: "word/header1.xml", find: "Invoice", replace: "Bill" },
        { part: "word/document.xml", find: "end</w:t>", replace: "end & more</w:t>" },
      ]),
    ).toThrow("After the edits, word/document.xml is not well-formed XML: A bare & in text on line 2. Write it as &amp;. Nothing was saved.");
    expect(() => editDocx(wordFile(SPLIT_BODY), [{ part: "word/document.xml", find: "<w:t>end</w:t>", replace: "<w:t>end" }])).toThrow(/is not well-formed XML/);
  });

  it("refuses a zip with too many files", () => {
    const many: Record<string, Uint8Array> = { "word/document.xml": strToU8(`<w:document ${W}><w:body/></w:document>`) };
    for (let i = 0; i < 2001; i++) many[`x/${i}`] = new Uint8Array(1);
    expect(() => editDocx(zipSync(many), [{ part: "word/document.xml", find: "<w:body/>", replace: "<w:body></w:body>" }])).toThrow(/too large to edit/);
  });
});

describe("pdfPageCount", () => {
  it("reads the page tree's count, or counts the pages", () => {
    const pdf = (body: string) => new TextEncoder().encode(`%PDF-1.7\n${body}\n%%EOF`);
    expect(pdfPageCount(pdf("1 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj"))).toBe(2);
    expect(pdfPageCount(pdf("1 0 obj<</Count 3/Kids[]/Type/Pages>>endobj"))).toBe(3);
    expect(pdfPageCount(pdf("3 0 obj << /Type /Page >> endobj 4 0 obj << /Type /Page >> endobj"))).toBe(2);
    expect(pdfPageCount(pdf("1 0 obj << /Type /ObjStm >> endobj"))).toBeNull();
  });
});
