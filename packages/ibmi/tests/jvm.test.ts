import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { closeConnection, connectionKey, IDLE_MS } from "../src/jt400/index.js";

const creds = { host: "ibmi.example.com", user: "demouser", password: "s3cret!Pw" };

describe("jt400 connection cache", () => {
  it("keys connections by a SHA-256 of host, user and password, never the raw password", () => {
    const key = connectionKey(creds);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).toBe(createHash("sha256").update("ibmi.example.com|DEMOUSER|s3cret!Pw").digest("hex"));
    expect(key).not.toContain(creds.password);
    expect(connectionKey({ ...creds, password: "other" })).not.toBe(key);
    expect(connectionKey({ ...creds, host: " IBMI.example.com ", user: "DemoUser" })).toBe(key);
  });

  it("closes idle connections after ten minutes", () => {
    expect(IDLE_MS).toBe(10 * 60 * 1000);
  });

  it("ignores an unknown key on close", async () => {
    await expect(closeConnection("0".repeat(64))).resolves.toBeUndefined();
  });

  it("does not load Java when the module is imported", () => {
    const cache = createRequire(import.meta.url).cache;
    expect(Object.keys(cache).some((k) => /[\\/]java[\\/]/.test(k) || k.includes("node-jt400"))).toBe(false);
  });
});
