import { describe, expect, it } from "vitest";
import { parseDefinition, DefinitionError } from "../src/definition.js";
import { extract } from "../src/extract.js";
import { checkTemplate } from "../src/tags.js";
import { documentName, HIDE_PDF_ELEMENTS, namePatternProblems, pdfLandscape, prepareHtml, starterTemplate, templateData } from "../src/template.js";
import { FIXTURES, loadFixture } from "./helpers/fixtures.js";

describe("starterTemplate", () => {
  it.each(FIXTURES)("is a Carbone template the %s definition's data fits", (name) => {
    const { definition } = loadFixture(name);
    const html = starterTemplate(definition);
    expect(html).toContain("@page { size: A4; margin: 15mm; }");
    expect(html).toContain(HIDE_PDF_ELEMENTS);
    expect(html).toMatch(/\{d\.doc\.\w+\[i\]\.\w+/);
    expect(html).toMatch(/<tr><td>\{d\.doc\.\w+\[i\+1\]\}<\/td><\/tr>/);
    expect(html).not.toMatch(/\{\{|\{%/);
    expect(checkTemplate(html, definition)).toEqual([]);
  });

  it("formats dates and numbers, and shows a field only when it has a value", () => {
    const html = starterTemplate(loadFixture("invoice").definition);
    expect(html).toContain("{d.doc.invoiceDate:ifNEM:showBegin}<dt>Invoice Date</dt><dd>{d.doc.invoiceDate:formatD('DD.MM.YYYY')}</dd>{d.doc.invoiceDate:showEnd}");
    expect(html).toContain('<td class="num">{d.doc.lines[i].amount:formatN(2)}</td>');
    expect(html).toContain("<td>{d.doc.lines[i].item}</td>");
  });
});

describe("prepareHtml", () => {
  const uri = "data:image/png;base64,iVBORw0KGgo+/=";
  const asset = (name: string) => (name === "logo" ? uri : undefined);

  it("writes assets in as data URIs, in HTML and in CSS", () => {
    const html = prepareHtml(`<html><head></head><body><img src="{asset('logo')}"><i style="background: url({asset("logo")})"></i></body></html>`, { asset });
    expect(html).toContain(`<img src="${uri}">`);
    expect(html).toContain(`url(${uri})`);
  });

  it("refuses an asset that is not uploaded", () => {
    expect(() => prepareHtml("<html><body>{asset('nope')}</body></html>", { asset })).toThrow('There is no asset named "nope". Upload it on the Assets page.');
  });

  it("makes a fragment a full document, since Carbone reads a fragment as XML", () => {
    const html = prepareHtml("<p>{d.doc.x}</p>");
    expect(html).toMatch(/^<!doctype html>\n<html>/);
    expect(html).toContain("<body>\n<p>{d.doc.x}</p>\n</body>");
  });

  it("hides Carbone's PDF elements in the HTML, in the head or else the body", () => {
    expect(prepareHtml("<html><head><title>x</title></head><body></body></html>")).toContain(`<style>${HIDE_PDF_ELEMENTS}</style>\n</head>`);
    expect(prepareHtml('<html><body class="a">x</body></html>')).toContain(`<body class="a"><style>${HIDE_PDF_ELEMENTS}</style>x`);
  });

  it("asks for landscape pages only when told to, and keeps the template's own options", () => {
    expect(prepareHtml("<html><body>x</body></html>", { landscape: true })).toContain('<carbone-pdf-options landscape="true"></carbone-pdf-options>');
    expect(prepareHtml("<html><body>x</body></html>")).not.toContain("<carbone-pdf-options");
    const own = '<html><body><carbone-pdf-options margin-top="1" />x</body></html>';
    expect(prepareHtml(own, { landscape: true }).match(/<carbone-pdf-options/g)).toHaveLength(1);
  });
});

describe("pdfLandscape", () => {
  const page = (rule: string) => `<html><head><style>${rule}</style></head><body></body></html>`;

  it("is landscape above 160 columns when the template sets no @page size", () => {
    expect(pdfLandscape(page(""), 198)).toBe(true);
    expect(pdfLandscape(page("@page { margin: 1cm }"), 198)).toBe(true);
    expect(pdfLandscape(page(""), 132)).toBe(false);
    expect(pdfLandscape(page(""))).toBe(false);
  });

  it("leaves it to the template's @page size, which wins in Carbone", () => {
    expect(pdfLandscape(page("@page { size: A4; }"), 198)).toBe(false);
    expect(pdfLandscape(page("@page { size: A4 landscape; }"), 80)).toBe(false);
  });
});

describe("templateData", () => {
  const doc = { a: 1 };
  const sample = { id: "S", splf: { name: "QPRINT" }, extra: "not sent" };

  it("sends documents only when the template reads them", () => {
    expect(templateData("<p>{d.doc.a}</p>", doc, [doc, doc], sample)).toEqual({ doc, sample: { id: "S", splf: { name: "QPRINT" } } });
    expect(templateData("<p>{d.documents[i].a}</p>", doc, [doc, doc], sample).documents).toHaveLength(2);
    expect(templateData("<p>{d.documents[].a:aggSum}</p>", doc, [doc], sample).documents).toHaveLength(1);
  });
});

describe("documentName", () => {
  it("names documents from output.name tags", () => {
    const { sample, definition } = loadFixture("invoice");
    const { documents } = extract(definition, sample);
    expect(documentName(definition, documents[0] as Record<string, unknown>)).toBe("invoice-260101");
  });

  it("converts a name pattern from before Carbone", () => {
    const { definition } = loadFixture("invoice");
    expect(documentName({ ...definition, output: { name: "invoice-{{ invoiceNo }}" } }, { invoiceNo: "260101" })).toBe("invoice-260101");
  });

  it("makes names safe and falls back to type-n", () => {
    const { definition } = loadFixture("invoice");
    expect(documentName({ ...definition, output: { name: "{d.doc.a}/{d.doc.b}" } }, { a: "x y", b: "../z" })).toBe("x_y_.._z");
    expect(documentName({ ...definition, output: { name: "{d.doc.missing}" } }, {}, 2)).toBe(`${definition.type}-3`);
    expect(documentName({ ...definition, output: undefined }, {}, 0)).toBe(`${definition.type}-1`);
  });

  it("refuses formatters and Nunjucks it can't convert in output.name", () => {
    expect(namePatternProblems("inv-{d.doc.no}")).toEqual([]);
    expect(namePatternProblems("inv-{{ no }}")).toEqual([]);
    expect(namePatternProblems("inv-{d.doc.date:formatD(YYYY)}")[0]).toMatch(/without formatters/);
    expect(namePatternProblems("inv-{{ no | wordcount }}")[0]).toMatch(/write fields as \{d\.doc\.invoiceNo\}/);
    const { yaml } = loadFixture("invoice");
    expect(() => parseDefinition(yaml.replace("invoice-{d.doc.invoiceNo}", "invoice-{d.doc.invoiceNo:upperCase}"))).toThrow(DefinitionError);
  });
});
