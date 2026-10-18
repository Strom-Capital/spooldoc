import { describe, expect, it } from "vitest";
import { extract } from "../src/extract.js";
import { documentName, formatDate, formatMoney, pad, renderTemplate, starterTemplate } from "../src/template.js";
import { FIXTURES, loadFixture } from "./helpers/fixtures.js";

describe("templates", () => {
  it.each(FIXTURES)("starter template renders the %s fixture without errors", (name) => {
    const { sample, definition } = loadFixture(name);
    const { documents } = extract(definition, sample);
    const html = starterTemplate(definition);
    expect(html).toContain("@page { size: A4; margin: 15mm; }");
    const r = renderTemplate(html, { doc: documents[0], documents, sample: { id: sample.id, splf: sample.splf } });
    expect(r.errors).toEqual([]);
    expect(r.html).toContain("<table>");
  });

  it("renders the invoice fixture template with escaping", () => {
    const { sample, definition, template } = loadFixture("invoice");
    const { documents } = extract(definition, sample);
    const r = renderTemplate(template, { doc: documents[2], documents, sample: { id: sample.id, splf: sample.splf } });
    expect(r.errors).toEqual([]);
    expect(r.html).toContain("BAKER &amp; SONS LTD");
    expect(r.html).toContain("1,374.50 EUR");
    expect(r.html).toContain("15.10.2026");
  });

  it("formats with the filters", () => {
    expect(formatMoney(1234.5)).toBe("1,234.50");
    expect(formatMoney(-0.5, "EUR")).toBe("-0.50 EUR");
    expect(formatMoney(null)).toBe("");
    expect(formatDate("2026-10-15")).toBe("15.10.2026");
    expect(formatDate("2026-10-15", "yyyy/MM/dd")).toBe("2026/10/15");
    expect(pad(7, 3, "left", "0")).toBe("007");
    expect(pad("A", 3, "right")).toBe("A  ");
    const r = renderTemplate("{{ n | money('EUR') }} {{ d | date }} [{{ s | pad(4) }}]", { n: 1000, d: "2026-01-02", s: "x" });
    expect(r).toEqual({ html: "1,000.00 EUR 02.01.2026 [   x]", errors: [] });
  });

  it("prints an asset as its data URI, in HTML and in CSS", () => {
    const uri = "data:image/png;base64,iVBORw0KGgo+/=";
    const asset = (name: string) => (name === "logo" ? uri : undefined);
    const r = renderTemplate(`<img src="{{ asset('logo') }}"><style>i { background: url("{{ asset('lo' ~ 'go') }}"); }</style>`, {}, { asset });
    expect(r).toEqual({ html: `<img src="${uri}"><style>i { background: url("${uri}"); }</style>`, errors: [] });
  });

  it("reports an unknown asset, and any asset without a resolver", () => {
    const missing = renderTemplate("{{ asset('logo') }}", {}, { asset: () => undefined });
    expect(missing.errors.join()).toContain('There is no asset named "logo". Upload it on the Assets page.');
    expect(renderTemplate("{{ asset('logo') }}", {}).errors.join()).toContain('There is no asset named "logo"');
  });

  it("lets the data shadow the asset function", () => {
    expect(renderTemplate("{{ asset }}", { asset: "mine" })).toEqual({ html: "mine", errors: [] });
  });

  it("reports a template error instead of throwing", () => {
    const r = renderTemplate("{% for x in %}", {});
    expect(r.html).toBe("");
    expect(r.errors).toHaveLength(1);
  });

  it("names documents from output.name", () => {
    const { sample, definition } = loadFixture("invoice");
    const { documents } = extract(definition, sample);
    expect(documentName(definition, documents[0] as Record<string, unknown>)).toBe("invoice-260101");
  });
});
