import { describe, expect, it } from "vitest";
import { checkTemplate, nunjucksSpans, problemText, renamedRootProblem, templatePaths, templateTags, templateUses } from "../src/tags.js";
import { FIXTURES, loadFixture } from "./helpers/fixtures.js";

const { definition } = loadFixture("invoice");
const page = (body: string) => `<!doctype html>\n<html>\n<body>\n${body}\n</body>\n</html>`;

describe("checkTemplate", () => {
  it.each(FIXTURES)("finds nothing wrong in the %s fixture template", (name) => {
    const fixture = loadFixture(name);
    expect(checkTemplate(fixture.template, fixture.definition)).toEqual([]);
  });

  it("flags fields that are not in the definition, with the line and a likely fix", () => {
    const problems = checkTemplate(page("<p>{d.pg.invoiceNumber}</p>\n<td>{d.pg.lines[i].ammount:formatN(2)}</td>\n<td>{d.pg.lines[i+1]}</td>"), definition);
    expect(problems).toEqual([
      { line: 4, message: "{d.pg.invoiceNumber} is not in the data. Did you mean {d.pg.invoiceNo}?" },
      { line: 5, message: "{d.pg.lines[i].ammount:formatN(2)} is not in the data. Did you mean {d.pg.lines[i].amount}?" },
    ]);
  });

  it("knows pg, pgs, splf and aggregates over a list", () => {
    const html = page(
      "{d.pgs[i].invoiceNo} {d.pgs[i+1]} {d.splf.name} {d.pg.lines[].amount:aggSum} {d.pg.lines[i, quantity > 1].item} {d.pg} {d}",
    );
    expect(checkTemplate(html, definition)).toEqual([]);
  });

  it("says what d is when a tag reads it as a list", () => {
    expect(checkTemplate(page("{d[i].invoiceNo}"), definition)[0]?.message).toMatch(/d is \{ pg, pgs, splf \}: pg is the page group, pgs every page group/);
    expect(checkTemplate(page("{d.invoiceNo}"), definition)[0]?.message).toBe("{d.invoiceNo} is not in the data. Did you mean {d.pg.invoiceNo}?");
  });

  it("does not check fields without a definition", () => {
    expect(checkTemplate(page("{d.pg.anything}"), null)).toEqual([]);
  });

  it("flags smart quotes and double quotes inside tags", () => {
    const problems = checkTemplate(page("{d.pg.invoiceDate:formatD(‘DD.MM.YYYY’)}\n{d.pg.invoiceDate:formatD(\"DD.MM.YYYY\")}\n<img src=\"{d.pg.customerNo}\">"), definition);
    expect(problems.map((p) => [p.line, p.message.replace(/^.* has /, "")])).toEqual([
      [4, "curly quotes, which Carbone prints as text. Use straight single quotes (')."],
      [5, "double quotes, which Carbone prints as text. Use single quotes (')."],
    ]);
  });

  it("flags Nunjucks left in the template", () => {
    const problems = checkTemplate(page("{{ doc.invoiceNo }}\n{% for row in doc.lines %}\n{# note #}\n{% if doc.x %}\n{{ doc.oops"), definition);
    expect(problems.map((p) => p.line)).toEqual([4, 5, 6, 7, 8]);
    expect(problems[0]?.message).toBe("{{ doc.invoiceNo }} is Nunjucks, which templates no longer use. Write a Carbone tag such as {d.pg.invoiceNo} instead.");
    expect(problems[1]?.message).toMatch(/row with \[i\] and a row with \[i\+1\]/);
    expect(problems[2]?.message).toMatch(/HTML comment/);
    expect(problems[3]?.message).toMatch(/:showBegin and :showEnd/);
    expect(problems[4]?.message).toMatch(/not closed/);
  });

  it("flags tags that are never closed", () => {
    expect(checkTemplate(page("<p>{d.pg.invoiceNo</p>\n<p>{d.pg.customerNo}</p>"), definition)).toEqual([
      { line: 4, message: "This tag has no closing }: {d.pg.invoiceNo</p>" },
    ]);
  });

  it("checks asset names when it knows the uploaded assets", () => {
    const html = page(`<img src="{asset('logo')}">\n<img src="{asset('lgo')}">\n<img src="{asset(logo)}">`);
    expect(checkTemplate(html, definition, { assets: ["logo"] }).map((p) => [p.line, p.message.slice(0, 40)])).toEqual([
      [5, 'There is no asset named "lgo". Upload it'],
      [6, "Write an asset as {asset('name')}, with "],
    ]);
    expect(checkTemplate(html, definition).map((p) => p.line)).toEqual([6]);
  });

  it("leaves CSS braces, aliases and options alone", () => {
    const html = `<html><head><style>@media print{body{margin:0}} td{color:red}</style></head><body>{#total = d.pg.totalAmount}{$total} {o.lang=fi} {c.now:formatD('YYYY')}</body></html>`;
    expect(checkTemplate(html, definition)).toEqual([]);
  });

  it("writes problems one per line", () => {
    expect(problemText([{ line: 3, message: "A." }, { line: 9, message: "B." }])).toBe("Line 3: A.\nLine 9: B.");
  });
});

describe("templateTags and templateUses", () => {
  it("reads the tags in order and skips Nunjucks", () => {
    expect(templateTags("{{ doc.x }} {d.pg.a} {#a = d.b} {$a} {t(Total)}").map((t) => t.text)).toEqual(["{d.pg.a}", "{#a = d.b}", "{$a}", "{t(Total)}"]);
  });

  it("knows when a template reads pgs, and does not take pg for pgs or pgs for pg", () => {
    expect(templateUses("{d.pgs[i].a}", "pgs")).toBe(true);
    expect(templateUses("{d.pgs:len}", "pgs")).toBe(true);
    expect(templateUses("{d.pg.pgs}", "pgs")).toBe(false);
    expect(templateUses("{d.pg.a}", "pgs")).toBe(false);
    expect(templateUses("<p>d.pgs</p>", "pgs")).toBe(false);
    expect(templateUses("{d.pg.a}", "pg")).toBe(true);
    expect(templateUses("{d.pgs[i].a}", "pg")).toBe(false);
  });

  it("says what an old tag is now called, with or without a definition", () => {
    const html = page("<p>{d.pageGroup.invoiceNo}</p>\n<p>{d.pageGroups:len}</p>\n<p>{d.pageGroups[i].lines[i].amount:formatN(2)}</p>");
    const expected = [
      { line: 4, message: "d.pageGroup is now d.pg. Write {d.pg.invoiceNo} instead of {d.pageGroup.invoiceNo}." },
      { line: 5, message: "d.pageGroups is now d.pgs. Write {d.pgs:len} instead of {d.pageGroups:len}." },
      { line: 6, message: "d.pageGroups is now d.pgs. Write {d.pgs[i].lines[i].amount:formatN(2)} instead of {d.pageGroups[i].lines[i].amount:formatN(2)}." },
    ];
    expect(checkTemplate(html, definition)).toEqual(expected);
    expect(checkTemplate(html, null)).toEqual(expected);
  });

  it("does not take a field named like an old root for an old tag", () => {
    expect(checkTemplate(page("{d.pg.pageGroup}"), null)).toEqual([]);
    expect(renamedRootProblem("{d.pageGroupX}")).toBeUndefined();
    expect(renamedRootProblem("{d.pg.a}")).toBeUndefined();
  });

  it("lists the paths of a definition", () => {
    const paths = templatePaths(definition);
    expect(paths).toContain("pg.invoiceNo");
    expect(paths).toContain("pg.lines[].amount");
    expect(paths).toContain("pgs[].lines[].amount");
    expect(paths).toContain("splf.jobNumber");
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
      expect(checkTemplate(`${opener.repeat(50_000)}{{ doc.a }}`, null).length).toBeGreaterThan(0);
    }
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
