import { describe, expect, it } from "vitest";
import { matchesSample, matchProblems } from "../src/extract.js";
import { loadFixture } from "./helpers/fixtures.js";

const { sample, definition } = loadFixture("invoice");

describe("matchProblems", () => {
  it("accepts a sample without match rules or with rules it meets", () => {
    expect(matchProblems({ ...definition, match: undefined }, sample)).toEqual([]);
    expect(matchProblems({ ...definition, match: { splf: sample.splf.name } }, sample)).toEqual([]);
    expect(matchesSample({ ...definition, match: { splf: sample.splf.name } }, sample)).toBe(true);
  });

  it("names every rule the sample fails", () => {
    const def = { ...definition, match: { splf: "OTHER", queue: "NOQUEUE", userData: "XYZ", page1: "^NEVER THERE$" } };
    expect(matchProblems(def, sample)).toEqual([
      `spooled file name is ${sample.splf.name}, not OTHER`,
      `output queue is ${sample.attributes.queue.name}, not NOQUEUE`,
      `user data is ${sample.attributes.userData || "empty"}, not XYZ`,
      "page 1 does not match /^NEVER THERE$/",
    ]);
    expect(matchesSample(def, sample)).toBe(false);
  });
});
