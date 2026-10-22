import { describe, it } from "vitest";
import { checkTemplate } from "../src/tags.js";
import { namePatternProblems, prepareHtml } from "../src/template.js";
import { linear, TIMING } from "./helpers/linear.js";

describe("long crafted input", () => {
  it("does not slow the tag check, file names or the prepared HTML", TIMING, () => {
    linear((n) => `{%${" ".repeat(n)}`, (text) => checkTemplate(text, null), 51_200);
    linear((n) => "{{".repeat(n), namePatternProblems, 51_200);
    linear((n) => `<html>${"<body".repeat(n)}`, (html) => prepareHtml(html, { landscape: true }), 51_200);
    linear((n) => `<html>${"</head".repeat(n)}<body>x</body></html>`, (html) => prepareHtml(html), 51_200);
  });
});
