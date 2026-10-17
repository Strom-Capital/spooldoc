import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openWorkspace, WorkspaceError, type Workspace } from "../src/workspace.js";
import { loadFixture } from "./helpers/fixtures.js";

let dir: string;
let ws: Workspace;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "spooldoc-ws-"));
  ws = openWorkspace(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("workspace", () => {
  it("round trips samples, definitions and templates", async () => {
    const { sample, yaml, template } = loadFixture("invoice");
    expect(await ws.listSamples()).toEqual([]);
    expect(await ws.readSample(sample.id)).toBeNull();
    await ws.writeSample(sample);
    expect(await ws.listSamples()).toEqual([sample.id]);
    expect(await ws.readSample(sample.id)).toEqual(sample);
    await ws.writeDefinition("invoice", yaml);
    expect(await ws.readDefinition("invoice")).toBe(yaml);
    await ws.writeTemplate("invoice", template);
    expect(await ws.readTemplate("invoice")).toBe(template);
    expect(await ws.readTemplate("missing")).toBeNull();
    expect(ws.paths.definition("invoice")).toBe(join(dir, "definitions", "invoice.yaml"));
  });

  it("refuses unsafe names", async () => {
    await expect(ws.readDefinition("../x")).rejects.toThrow(WorkspaceError);
    await expect(ws.writeTemplate("..", "x")).rejects.toThrow(WorkspaceError);
    await expect(ws.writeTemplate("a/b", "x")).rejects.toThrow(WorkspaceError);
    expect(() => ws.paths.sample("a..b")).toThrow(WorkspaceError);
  });

  it("never shows a partial file", async () => {
    const big = "x".repeat(5_000_000);
    const writes = Array.from({ length: 5 }, (_, i) => ws.writeTemplate("big", `${i}${big}`));
    const seen: (string | null)[] = [];
    for (let i = 0; i < 20; i++) seen.push(await ws.readTemplate("big"));
    await Promise.all(writes);
    for (const s of [...seen, await ws.readTemplate("big")]) {
      if (s !== null) expect(s.length).toBe(big.length + 1);
    }
    expect(await readdir(ws.paths.templates)).toEqual(["big.html"]);
  });
});
