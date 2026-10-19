import { describe, expect, it } from "vitest";
import { convertNamePattern, convertNunjucks, isNunjucks, nunjucksSpans } from "../src/convert.js";
import { checkTemplate } from "../src/tags.js";
import { fixtureText, loadFixture } from "./helpers/fixtures.js";

describe("convertNunjucks", () => {
  it("converts the invoice template to the Carbone fixture", () => {
    const converted = convertNunjucks(fixtureText("invoice", "template.nunjucks.html"));
    expect(converted).toBe(fixtureText("invoice", "template.html"));
    expect(checkTemplate(converted, loadFixture("invoice").definition)).toEqual([]);
  });

  it("leaves a Carbone template as it is", () => {
    const html = fixtureText("invoice", "template.html");
    expect(isNunjucks(html)).toBe(false);
    expect(convertNunjucks(html)).toBe(html);
  });

  it("converts outputs, filters and assets", () => {
    expect(convertNunjucks("{{ doc.a }} {{doc.lines[0].item}} {{ sample.splf.name }}")).toBe("{d.doc.a} {d.doc.lines[0].item} {d.sample.splf.name}");
    expect(convertNunjucks("{{ doc.n | money }} {{ doc.n | money('EUR') }} {{ doc.n | money(doc.currency) }}")).toBe(
      "{d.doc.n:formatN(2)} {d.doc.n:formatN(2)} EUR {d.doc.n:formatN(2)} {d.doc.currency}",
    );
    expect(convertNunjucks("{{ doc.d | date }} {{ doc.d | date('yyyy-MM-dd') }}")).toBe("{d.doc.d:formatD('DD.MM.YYYY')} {d.doc.d:formatD('YYYY-MM-DD')}");
    expect(convertNunjucks("{{ doc.s | pad(4) }} {{ doc.s | pad(6, 'right') }} {{ doc.s | pad(3, 'left', '0') }}")).toBe(
      "{d.doc.s:padl(4)} {d.doc.s:padr(6)} {d.doc.s:padl(3, '0')}",
    );
    expect(convertNunjucks("{{ doc.s | upper }} {{ doc.s | lower | trim }} {{ doc.s | title }}")).toBe("{d.doc.s:upperCase} {d.doc.s:lowerCase} {d.doc.s:lowerCase:ucWords}");
    expect(convertNunjucks(`<img src="{{ asset('logo') }}"> url("{{ asset("font") }}")`)).toBe(`<img src="{asset('logo')}"> url("{asset('font')}")`);
  });

  it("converts a loop over a table row into an [i] row and an [i+1] row", () => {
    const html = "<tbody>\n  {% for row in doc.lines %}\n  <tr><td>{{ row.item }}</td><td>{{ row.amount | money }}</td></tr>\n  {% endfor %}\n</tbody>";
    expect(convertNunjucks(html)).toBe(
      "<tbody>\n  <tr><td>{d.doc.lines[i].item}</td><td>{d.doc.lines[i].amount:formatN(2)}</td></tr>\n  <tr><td>{d.doc.lines[i+1]}</td></tr>\n</tbody>",
    );
  });

  it("converts a loop over another single element, and nested loops", () => {
    expect(convertNunjucks("<ul>{% for x in doc.lines %}<li>{{ x.item }}</li>{% endfor %}</ul>")).toBe("<ul><li>{d.doc.lines[i].item}</li>\n<li>{d.doc.lines[i+1]}</li></ul>");
    const nested = convertNunjucks("{% for d in documents %}<div>{{ d.invoiceNo }}<ul>{% for l in d.lines %}<li>{{ l.item }}</li>{% endfor %}</ul></div>{% endfor %}");
    expect(nested).toBe("<div>{d.documents[i].invoiceNo}<ul><li>{d.documents[i].lines[i].item}</li>\n<li>{d.documents[i].lines[i+1]}</li></ul></div>\n<div>{d.documents[i+1]}</div>");
  });

  it("converts if, else and comparisons into showBegin and showEnd", () => {
    expect(convertNunjucks("{% if doc.a %}A{% endif %}")).toBe("{d.doc.a:ifNEM:showBegin}A{d.doc.a:showEnd}");
    expect(convertNunjucks("{% if not doc.a %}none{% else %}{{ doc.a }}{% endif %}")).toBe(
      "{d.doc.a:ifEM:showBegin}none{d.doc.a:showEnd}{d.doc.a:ifNEM:showBegin}{d.doc.a}{d.doc.a:showEnd}",
    );
    expect(convertNunjucks("{% if doc.t == 'C' %}credit{% else %}invoice{% endif %}")).toBe(
      "{d.doc.t:ifEQ('C'):showBegin}credit{d.doc.t:showEnd}{d.doc.t:ifNE('C'):showBegin}invoice{d.doc.t:showEnd}",
    );
    expect(convertNunjucks("{% if doc.n >= 10 %}big{% endif %}")).toBe("{d.doc.n:ifGTE(10):showBegin}big{d.doc.n:showEnd}");
    expect(convertNunjucks("{%- if doc.a -%}A{%- endif -%}")).toBe("{d.doc.a:ifNEM:showBegin}A{d.doc.a:showEnd}");
    for (const test of ["doc.notes and doc.notes.length", "doc.notes.length", "doc.notes | length", "doc.notes.length > 0"]) {
      expect(convertNunjucks(`{% if ${test} %}N{% endif %}`)).toBe("{d.doc.notes:ifNEM:showBegin}N{d.doc.notes:showEnd}");
    }
  });

  it("turns comments into HTML comments", () => {
    expect(convertNunjucks("{# the lines #}<p>x</p>")).toBe("<!-- the lines --><p>x</p>");
  });

  it("leaves what it can't map in place, so the tag check flags its line", () => {
    const html = [
      "<p>{{ doc.a | wordcount }}</p>",
      "{% set x = 1 %}",
      "{% if doc.a and doc.b %}<p>{{ doc.a }}</p>{% endif %}",
      "{% if doc.a %}A{% elif doc.b %}B{% endif %}",
      "{% for row in doc.lines %}<td>{{ row.a }}</td><td>{{ row.b }}</td>{% endfor %}",
      "{% for row in doc.lines %}<tr><td>{{ loop.index }}</td></tr>{% endfor %}",
      "{{ other.thing }}",
    ].join("\n");
    const converted = convertNunjucks(html);
    expect(converted.split("\n")).toEqual([
      "<p>{{ doc.a | wordcount }}</p>",
      "{% set x = 1 %}",
      "{% if doc.a and doc.b %}<p>{d.doc.a}</p>{% endif %}",
      "{% if doc.a %}A{% elif doc.b %}B{% endif %}",
      "{% for row in doc.lines %}<td>{{ row.a }}</td><td>{{ row.b }}</td>{% endfor %}",
      "{% for row in doc.lines %}<tr><td>{{ loop.index }}</td></tr>{% endfor %}",
      "{{ other.thing }}",
    ]);
    expect([...new Set(checkTemplate(converted, null).map((p) => p.line))]).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("nunjucksSpans", () => {
  it("finds each span up to the first closer of its kind", () => {
    expect(nunjucksSpans("a {{ x }}} b {%- if y -%} {# c #} {{ open").map((s) => [s.kind, s.inner])).toEqual([
      ["{", " x "],
      ["%", "- if y -"],
      ["#", " c "],
    ]);
  });

  it("stays fast on many openers without a closer", () => {
    const started = performance.now();
    for (const opener of ["{{", "{%", "{#", "{{{{a"]) {
      expect(nunjucksSpans(opener.repeat(50_000))).toEqual([]);
      expect(checkTemplate(convertNunjucks(`${opener.repeat(50_000)}{{ doc.a }}`), null).length).toBeGreaterThan(0);
    }
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("convertNamePattern", () => {
  it("reads names as fields of the document", () => {
    expect(convertNamePattern("invoice-{{ invoiceNo }}")).toBe("invoice-{d.doc.invoiceNo}");
    expect(convertNamePattern("{{ outputName }}")).toBe("{d.doc.outputName}");
    expect(convertNamePattern("invoice-{d.doc.invoiceNo}")).toBe("invoice-{d.doc.invoiceNo}");
  });
});
