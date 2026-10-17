import { describe, expect, it } from "vitest";
import { extract } from "../src/extract.js";
import { lineText } from "../src/sample.js";
import { loadFixture } from "./helpers/fixtures.js";

const { sample, definition, expected } = loadFixture("picklist");
const result = extract(definition, sample);
type Doc = { picklistNo: string; lineCount: number; lines: unknown[]; deliverAddress2: string };
const docs = result.documents as Doc[];

describe("pick list extraction", () => {
  it("finds five pick lists with their lines", () => {
    expect(docs.map((d) => d.picklistNo)).toEqual(["700001", "700002", "700003", "700004", "700005"]);
    for (const d of docs) expect(d.lines).toHaveLength(d.lineCount);
  });

  it("reports a blank address line as empty, not missing", () => {
    expect(docs[1]?.deliverAddress2).toBe("");
    const hit = result.hits.find((h) => h.document === 1 && h.name === "deliverAddress2");
    expect(hit?.status).toBe("empty");
  });

  it("points found hits at the printed text", () => {
    for (const h of result.hits.filter((x) => x.status === "found")) {
      const page = sample.pages.find((p) => p.no === h.page);
      if (!page) throw new Error("page");
      expect(lineText(page, h.line).slice(h.column - 1, h.column - 1 + h.length)).toBe(h.value);
    }
  });

  it("equals expected.json", () => {
    expect(result.documents).toEqual(expected);
  });

  it("reports a missing field with a warning", () => {
    const def = structuredClone(definition);
    def.text?.fields?.push({ name: "nothing", anchor: { after: "No such label:" } });
    const r = extract(def, sample);
    expect(r.hits.filter((h) => h.name === "nothing").every((h) => h.status === "missing")).toBe(true);
    expect(r.warnings).toHaveLength(5);
    expect((r.documents[0] as Record<string, unknown>).nothing).toBeNull();
  });
});
