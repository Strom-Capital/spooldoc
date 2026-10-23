import { describe, expect, it, vi } from "vitest";
import { openJt400Connection } from "../src/jt400/connection.js";

const bridge = vi.hoisted(() => ({
  opened: [] as unknown[][],
  readOnly: { closed: false },
}));

vi.mock("../src/jt400/bridge.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/jt400/bridge.js")>();
  /** A Java class whose objects take any call. */
  const anything = class {
    constructor() {
      return new Proxy({}, { get: () => () => undefined });
    }
  };
  return {
    ...actual,
    loadJava: () => ({ import: () => anything }),
    openJdbc: async () => ({ query: async () => [], close: async () => undefined }),
    openJavaJdbc: async (...args: unknown[]) => {
      bridge.opened.push(args);
      return {
        prepareStatement: async () => {
          throw new Error("java.sql.SQLException: [SQL0204] CUSTMAST in MYLIB type *FILE not found.");
        },
        close: async () => {
          bridge.readOnly.closed = true;
        },
      };
    },
  };
});

describe("the query connection", () => {
  it("opens read only on the first query, is kept, and is closed with the connection", async () => {
    const conn = await openJt400Connection({ host: "ibmi.example.com", user: "demouser", password: "s3cret!Pw" });
    expect(bridge.opened).toEqual([]);

    const sql = "SELECT * FROM MYLIB.CUSTMAST";
    await expect(conn.query(sql, [], { maxRows: 1, timeoutSeconds: 5 })).rejects.toMatchObject({ code: "notfound" });
    await expect(conn.describeQuery("INSERT INTO MYLIB.CUSTMAST VALUES (1)")).rejects.toMatchObject({
      code: "query",
      message: "A lookup runs one SELECT statement only, and this one is INSERT. Use SELECT, WITH or VALUES.",
    });
    expect(bridge.opened).toEqual([["ibmi.example.com", "demouser", "s3cret!Pw", { readOnly: true }]]);

    await conn.close();
    expect(bridge.readOnly.closed).toBe(true);
    await expect(conn.query(sql, [], { maxRows: 1, timeoutSeconds: 5 })).rejects.toMatchObject({ code: "other" });
  });
});
