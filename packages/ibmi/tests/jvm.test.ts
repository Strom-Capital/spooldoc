import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../src/connection.js";
import { closeConnection, connectionKey, CONNECT_TIMEOUT_MS, getConnection, IDLE_MS } from "../src/jt400/index.js";

const opens = vi.hoisted(() => [] as { resolve(conn: Connection): void }[]);
vi.mock("../src/jt400/connection.js", () => ({
  openJt400Connection: () => new Promise<Connection>((resolve) => opens.push({ resolve })),
}));

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

  describe("a connection that does not open", () => {
    afterEach(async () => {
      vi.useRealTimers();
      for (const open of opens) open.resolve({ close: async () => undefined } as unknown as Connection);
      await closeConnection(connectionKey(creds));
      opens.length = 0;
    });

    it("fails with a host error after the connect timeout and starts over on the next call", async () => {
      vi.useFakeTimers();
      const first = getConnection(creds);
      const failed = expect(first).rejects.toMatchObject({
        name: "ConnectionError",
        code: "host",
        message: expect.stringMatching(/^No answer from ibmi\.example\.com within 45 seconds/),
      });
      await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
      await failed;

      void getConnection(creds);
      expect(opens).toHaveLength(2);

      // The first attempt answering late is closed, not handed out.
      const late = { close: vi.fn(async () => undefined) } as unknown as Connection;
      opens[0]?.resolve(late);
      await vi.advanceTimersByTimeAsync(0);
      expect(late.close).toHaveBeenCalled();
    });
  });

  it("ignores an unknown key on close", async () => {
    await expect(closeConnection("0".repeat(64))).resolves.toBeUndefined();
  });

  it("does not load Java when the module is imported", () => {
    const cache = createRequire(import.meta.url).cache;
    expect(Object.keys(cache).some((k) => /[\\/]java[\\/]/.test(k) || k.includes("node-jt400"))).toBe(false);
  });
});
