import { describe, expect, it } from "vitest";
import { convertNamePattern, convertNunjucks } from "../src/convert.js";
import { checkTemplate } from "../src/tags.js";
import { namePatternProblems, prepareHtml } from "../src/template.js";

/** Runs `fn` and expects it to finish in well under a second, as linear code does on these sizes. */
function fast(fn: () => unknown): void {
  const started = performance.now();
  fn();
  expect(performance.now() - started).toBeLessThan(1000);
}

const N = 50_000;

describe("long crafted input", () => {
  it("does not slow the converter", () => {
    fast(() => convertNunjucks(`{% if doc.a${" ".repeat(N)} %}x{% endif %}`));
    fast(() => convertNunjucks(`{% for r in doc.lines %}${"<tr".repeat(N)}{{ r.a }}{% endfor %}`));
    fast(() => convertNamePattern(`${"{{".repeat(N)}`));
    expect(convertNunjucks("{% if doc.t == 'a<b' %}x{% endif %}")).toBe("{d.doc.t:ifEQ('a<b'):showBegin}x{d.doc.t:showEnd}");
  });

  it("does not slow the tag check, file names or the prepared HTML", () => {
    fast(() => checkTemplate(`{%${" ".repeat(N)}`, null));
    fast(() => namePatternProblems(`${"{{".repeat(N)}`));
    fast(() => prepareHtml(`<html>${"<body".repeat(N)}`, { landscape: true }));
    fast(() => prepareHtml(`<html>${"</head".repeat(N)}<body>x</body></html>`));
  });
});
