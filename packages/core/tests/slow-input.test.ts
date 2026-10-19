import { describe, expect, it } from "vitest";
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
  it("does not slow the tag check, file names or the prepared HTML", () => {
    fast(() => checkTemplate(`{%${" ".repeat(N)}`, null));
    fast(() => namePatternProblems(`${"{{".repeat(N)}`));
    fast(() => prepareHtml(`<html>${"<body".repeat(N)}`, { landscape: true }));
    fast(() => prepareHtml(`<html>${"</head".repeat(N)}<body>x</body></html>`));
  });
});
