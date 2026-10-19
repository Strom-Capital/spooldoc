import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { checkDocx, docxConverter, docxProblem, docxProblemText, readDocx, starterDocx } from "../src/docx.js";
import { extract } from "../src/extract.js";
import { checkTemplate } from "../src/tags.js";
import { starterTemplate, templateData } from "../src/template.js";
import { FIXTURES, loadFixture } from "./helpers/fixtures.js";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** A .docx with these parts; `document` is the body's paragraphs. */
function docxOf(document: string, parts: Record<string, string> = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types/>'),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${document}</w:body></w:document>`),
  };
  for (const [name, xml] of Object.entries(parts)) files[name] = strToU8(xml);
  return zipSync(files);
}

const run = (text: string, bold = false) => `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (...runs: string[]) => `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="2000"/></w:tabs></w:pPr>${runs.join("")}</w:p>`;

const { definition } = loadFixture("invoice");

describe("readDocx", () => {
  it("joins a tag Word split over runs, and keeps tabs and line breaks", () => {
    const doc = docxOf(para(run("Invoice "), run("{d.doc.inv", true), run("oiceNo}"), "<w:r><w:tab/><w:t>A</w:t><w:br/><w:t>B</w:t></w:r>"));
    expect(readDocx(doc).paragraphs).toEqual([{ part: "body", text: "Invoice {d.doc.invoiceNo}\tA\nB" }]);
  });

  it("reads headers and footers after the body, writes out entities and skips Word's fallback copy of a text box", () => {
    const header = `<w:hdr ${W}>${para(run("{d.doc.customerName} &amp; &#x41;&#66; &apos;x&apos;"))}</w:hdr>`;
    const footer = `<w:ftr ${W}>${para(run("Page"))}</w:ftr>`;
    const box = `<w:p><w:r><mc:AlternateContent><mc:Choice><w:txbxContent>${para(run("In a box"))}</w:txbxContent></mc:Choice><mc:Fallback><w:txbxContent>${para(run("In a box"))}</w:txbxContent></mc:Fallback></mc:AlternateContent></w:r></w:p>`;
    const doc = docxOf(para(run("Body")) + box, { "word/footer1.xml": footer, "word/header2.xml": header });
    expect(readDocx(doc).paragraphs).toEqual([
      { part: "body", text: "Body" },
      { part: "body", text: "In a box" },
      { part: "header", text: "{d.doc.customerName} & AB 'x'" },
      { part: "footer", text: "Page" },
    ]);
  });

  it("lists the fields, simple or complex", () => {
    const complex = (code: string) =>
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    const doc = docxOf(para(complex("PAGEREF _Toc1 \\h"), `<w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>2</w:t></w:r></w:fldSimple>`));
    const read = readDocx(doc);
    expect(read.fields).toEqual(["PAGEREF", "NUMPAGES"]);
    expect(docxConverter(read)).toBe("L");
    expect(docxConverter({ fields: ["PAGE", "NUMPAGES"] })).toBe("I");
  });

  it("says what is wrong with a file that is not a .docx", () => {
    expect(() => readDocx(strToU8("<html></html>"))).toThrow(/not a Word document/);
    expect(() => readDocx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).toThrow(/Word 97-2003 document \(\.doc\)/);
    expect(() => readDocx(zipSync({ "a.txt": strToU8("a") }))).toThrow(/no word\/document\.xml/);
    expect(() => readDocx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toThrow(/damaged/);
    expect(docxProblem(docxOf(para(run("x"))))).toBeNull();
    expect(docxProblem(strToU8("x"))).toMatch(/not a Word document/);
  });
});

describe("checkDocx", () => {
  it("flags fields not in the definition, curly quotes and pictures as assets, with the part", () => {
    const header = `<w:hdr ${W}>${para(run("{asset('logo')}"))}</w:hdr>`;
    const doc = docxOf(para(run("{d.doc.invoiceNumber}")) + para(run("{d.doc.invoiceDate:formatD(‘DD.MM.YYYY’)}")) + para(run("{d.doc.invoiceNo")), {
      "word/header1.xml": header,
    });
    const problems = checkDocx(readDocx(doc), definition);
    expect(problems).toEqual([
      { part: "body", message: "{d.doc.invoiceNumber} is not in the data. Did you mean {d.doc.invoiceNo}?" },
      { part: "body", message: expect.stringMatching(/curly quotes, which Word types by default.*Turn off smart quotes/) },
      { part: "body", message: "This tag has no closing }: {d.doc.invoiceNo" },
      { part: "header", message: expect.stringMatching(/^\{asset\('logo'\)\} is for HTML templates\. In Word, insert the picture itself/) },
    ]);
    expect(docxProblemText(problems.slice(0, 1))).toBe("Body: {d.doc.invoiceNumber} is not in the data. Did you mean {d.doc.invoiceNo}?");
  });

  it("does not check fields without a definition", () => {
    expect(checkDocx(readDocx(docxOf(para(run("{d.doc.anything}")))), null)).toEqual([]);
  });

  it("sends documents only when the template reads them", () => {
    const { sample, definition: def } = loadFixture("invoice");
    const { documents } = extract(def, sample);
    const plain = readDocx(docxOf(para(run("{d.doc.invoiceNo}"))));
    const all = readDocx(docxOf(para(run("{d.documents[i].invoiceNo}"))));
    expect(templateData(plain, documents[0]!, documents, sample).documents).toBeUndefined();
    expect(templateData(all, documents[0]!, documents, sample).documents).toHaveLength(documents.length);
  });
});

describe("starterDocx", () => {
  it.each(FIXTURES)("makes a %s starter whose tags pass the check", async (name) => {
    const { definition: def } = loadFixture(name);
    const read = readDocx(await starterDocx(def));
    expect(checkDocx(read, def)).toEqual([]);
    expect(read.fields).toEqual(["PAGE", "NUMPAGES"]);
  });

  it("writes a title with a tag in both starter templates", async () => {
    const def = { ...definition, output: { name: "invoice-{d.doc.invoiceNo}", title: "Invoice {d.doc.invoiceNo}" } };
    expect(readDocx(await starterDocx(def)).paragraphs[0]?.text).toBe("Invoice {d.doc.invoiceNo}");
    expect(checkDocx(readDocx(await starterDocx(def)), def)).toEqual([]);
    expect(starterTemplate(def)).toContain("<h1>Invoice {d.doc.invoiceNo}</h1>");
    expect(checkTemplate(starterTemplate(def), def)).toEqual([]);
  });

  it("lays out the invoice: a field line each, hidden when empty, a table loop and page numbers", async () => {
    const bytes = await starterDocx(definition);
    const { paragraphs } = readDocx(bytes);
    const texts = paragraphs.map((p) => p.text);
    expect(texts[0]).toBe("Invoice");
    expect(texts[1]).toMatch(/^Invoice No\t\{d\.doc\.invoiceNo\}\{d\.doc\.invoiceDate:ifEM:hideBegin\}\nInvoice Date\t\{d\.doc\.invoiceDate:formatD\('DD\.MM\.YYYY'\)\}\{d\.doc\.invoiceDate:hideEnd\}/);
    expect(texts).toContain("{d.doc.lines[i].amount:formatN(2)}");
    expect(texts).toContain("{d.doc.lines[i+1]}");
    expect(paragraphs.at(-1)).toEqual({ part: "footer", text: "Page  of " });
    // Each part of a page field in its own run, as Word writes it: ICE prints nothing otherwise.
    const footer = new TextDecoder().decode(unzipSync(bytes)["word/footer1.xml"]);
    expect(footer).toMatch(/<w:r>(<w:rPr>.*?<\/w:rPr>)?<w:fldChar w:fldCharType="begin"\/><\/w:r>/);
  });
});
