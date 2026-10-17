import { describe, expect, it } from "vitest";
import { DefinitionError, definitionJsonSchema, formatDefinition, parseDefinition } from "../src/definition.js";
import { FIXTURES, loadFixture } from "./helpers/fixtures.js";

const base = `
type: test
version: 1
source: text
text:
  page: { width: 80, length: 66 }
  fields:
`;

describe("definitions", () => {
  it.each(FIXTURES)("parses the %s fixture", (name) => {
    const { definition } = loadFixture(name);
    expect(definition.type).toBe(name);
  });

  it("rejects a field with two anchors, with a path", () => {
    const yaml = `${base}    - { name: a, anchor: { after: "No:", regex: "x" } }\n`;
    expect(() => parseDefinition(yaml)).toThrow(DefinitionError);
    expect(() => parseDefinition(yaml)).toThrow(/text\.fields\[0\]\.anchor: an anchor needs exactly one of/);
  });

  it("rejects a field with no anchor kind, with a path", () => {
    const yaml = `${base}    - { name: a, anchor: { group: 1 } }\n`;
    expect(() => parseDefinition(yaml)).toThrow(/text\.fields\[0\]\.anchor: an anchor needs one of/);
  });

  it("rejects an incomplete fixed position and a bad regex", () => {
    expect(() => parseDefinition(`${base}    - { name: a, anchor: { line: 1, column: 2 } }\n`)).toThrow(/needs `line`, `column` and `length`/);
    expect(() => parseDefinition(`${base}    - { name: a, anchor: { regex: "(" } }\n`)).toThrow(/text\.fields\[0\]\.anchor\.regex: not a valid regular expression/);
  });

  it("rejects a split field that is not a field, and bad YAML", () => {
    expect(() => parseDefinition(`${base}    - { name: a, anchor: { after: "x" } }\n  split: { field: b }\n`)).toThrow(/text\.split\.field/);
    expect(() => parseDefinition("type: [")).toThrow(/YAML/);
  });

  it.each(FIXTURES)("round trips %s through formatDefinition", (name) => {
    const { definition } = loadFixture(name);
    expect(parseDefinition(formatDefinition(definition))).toEqual(definition);
  });

  it("exports a JSON Schema", () => {
    const schema = definitionJsonSchema as { type?: string; properties?: Record<string, unknown> };
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties ?? {})).toEqual(expect.arrayContaining(["type", "source", "text", "xml"]));
  });
});
