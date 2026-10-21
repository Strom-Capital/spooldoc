import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../src/connection.js";
import { toConnectionError } from "../src/errors.js";
import { closeAllConnections, closeConnection, connectionKey, CONNECT_TIMEOUT_MS, getConnection, IDLE_MS, reconnect } from "../src/jt400/index.js";

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

  describe("a connection that drops", () => {
    const info = { host: creds.host, user: "DEMOUSER", jobCcsid: 37, defaultCcsid: 37, vrm: "V7R5" };
    const queue = { library: "MYLIB", name: "MYOUTQ", files: 1, text: "", dataQueue: null };
    const splf = { name: "QPRINT", number: 1, jobName: "MYJOB", jobUser: "DEMOUSER", jobNumber: "000001" };
    const dropped = () => toConnectionError(new Error("java.sql.SQLException: The connection does not exist. (08003)"), [], undefined, { host: creds.host });

    /** A connection whose calls answer as given; anything not given throws. */
    const fake = (calls: Partial<Connection> = {}) =>
      ({
        describe: vi.fn(async () => info),
        listOutputQueues: vi.fn(async () => [queue]),
        close: vi.fn(async () => undefined),
        ...calls,
      }) as unknown as Connection & { close: ReturnType<typeof vi.fn> };

    let answered = 0;
    /** Answers the next open with `conn`. */
    const answer = async (conn: Connection): Promise<void> => {
      await vi.waitFor(() => expect(opens.length).toBeGreaterThan(answered));
      opens[answered++]?.resolve(conn);
    };

    afterEach(async () => {
      for (const open of opens.slice(answered)) open.resolve(fake());
      await closeAllConnections();
      opens.length = 0;
      answered = 0;
    });

    it("throws the dead connection away and reads again on a new one", async () => {
      const dead = fake({ listOutputQueues: vi.fn(async () => Promise.reject(dropped())) });
      const pending = getConnection(creds);
      await answer(dead);
      const conn = await pending;

      const listed = conn.listOutputQueues();
      await answer(fake());
      await expect(listed).resolves.toEqual([queue]);
      expect(opens).toHaveLength(2);
      expect(dead.close).toHaveBeenCalled();

      // Later calls, and other callers, use the new connection.
      await expect(conn.listOutputQueues()).resolves.toEqual([queue]);
      await getConnection(creds);
      expect(opens).toHaveLength(2);
    });

    it("throws a second failure and keeps no dead connection", async () => {
      const pending = getConnection(creds);
      await answer(fake({ listOutputQueues: vi.fn(async () => Promise.reject(dropped())) }));
      const conn = await pending;

      const listed = conn.listOutputQueues();
      const failed = expect(listed).rejects.toMatchObject({ code: "host", message: expect.stringMatching(/^The connection to ibmi\.example\.com dropped\./) });
      await answer(fake({ listOutputQueues: vi.fn(async () => Promise.reject(dropped())) }));
      await failed;
      expect(opens).toHaveLength(2);

      // The next caller opens a new connection instead of getting the dead one.
      void getConnection(creds);
      await vi.waitFor(() => expect(opens).toHaveLength(3));
    });

    it("does not change the IBM i twice: a hold that drops is not tried again", async () => {
      const dead = fake({ holdSpooledFile: vi.fn(async () => Promise.reject(dropped())) });
      const pending = getConnection(creds);
      await answer(dead);
      const conn = await pending;

      await expect(conn.holdSpooledFile(splf)).rejects.toMatchObject({
        name: "ConnectionError",
        code: "host",
        message:
          "The connection to ibmi.example.com dropped before the IBM i answered. Check whether spooled file QPRINT number 1 of job 000001/DEMOUSER/MYJOB was held, then try again.",
      });
      expect(dead.holdSpooledFile).toHaveBeenCalledTimes(1);
      expect(opens).toHaveLength(1);
      expect(dead.close).toHaveBeenCalled();
    });

    it("keeps the connection after an error about an object", async () => {
      const notFound = toConnectionError(new Error("CPF2105 Object MYOUTQ in MYLIB type *OUTQ not found."), []);
      const live = fake({ listOutputQueues: vi.fn(async () => Promise.reject(notFound)) });
      const pending = getConnection(creds);
      await answer(live);
      const conn = await pending;

      await expect(conn.listOutputQueues()).rejects.toMatchObject({ code: "notfound" });
      await getConnection(creds);
      expect(opens).toHaveLength(1);
      expect(live.close).not.toHaveBeenCalled();
    });

    it("reconnect closes the cached connection and signs on again", async () => {
      const old = fake();
      const pending = getConnection(creds);
      await answer(old);
      await pending;

      const signedOn = reconnect(creds);
      await answer(fake());
      await expect(signedOn).resolves.toEqual(info);
      expect(old.close).toHaveBeenCalled();
      expect(opens).toHaveLength(2);
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
