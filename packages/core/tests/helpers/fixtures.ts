import { readFileSync } from "node:fs";
import { parseDefinition, sampleSchema, type Definition, type Sample } from "../../src/index.js";

export const FIXTURES = ["invoice", "order-report", "picklist", "picklist-xml"] as const;
export type FixtureName = (typeof FIXTURES)[number];

const base = (name: FixtureName): URL => new URL(`../../fixtures/${name}/`, import.meta.url);

/** Reads a file of a fixture as text. */
export function fixtureText(name: FixtureName, file: string): string {
  return readFileSync(new URL(file, base(name)), "utf8");
}

/** Loads a fixture's sample, definition, template and expected documents. */
export function loadFixture(name: FixtureName): { sample: Sample; definition: Definition; yaml: string; template: string; expected: unknown[] } {
  const yaml = fixtureText(name, "definition.yaml");
  return {
    sample: sampleSchema.parse(JSON.parse(fixtureText(name, "sample.json"))),
    definition: parseDefinition(yaml),
    yaml,
    template: fixtureText(name, "template.html"),
    expected: JSON.parse(fixtureText(name, "expected.json")) as unknown[],
  };
}
