import { describe, expect, it } from "vitest";
import { classifyError, ConnectionError, redact, summarize, toConnectionError } from "../src/index.js";

const PASSWORD = "s3cret!Pw";

const javaError = (text: string): Error => {
  const err = new Error(`Error running instance method\n${text}\n\tat com.ibm.as400.access.AS400.signon(AS400.java:1)\n\t... 3 more`);
  return err;
};

describe("toConnectionError", () => {
  const cases: [string, string, ConnectionError["code"]][] = [
    ["wrong password", "com.ibm.as400.access.AS400SecurityException: Password is not correct.", "auth"],
    ["JDBC wrong password", "java.sql.SQLException: The application server rejected the connection. (Password is incorrect.:DEMOUSER)", "auth"],
    ["disabled profile", "com.ibm.as400.access.AS400SecurityException: User profile is disabled.", "auth"],
    ["unknown user", "com.ibm.as400.access.AS400SecurityException: User ID is not known.", "auth"],
    ["unknown host", "java.net.UnknownHostException: ibmi.example.com: nodename nor servname provided, or not known", "host"],
    ["JDBC unknown host", "java.sql.SQLException: The application requester cannot establish the connection. (ibmi.example.com)", "host"],
    ["spooled file not found", "com.ibm.as400.access.AS400Exception: CPF3C40 Spooled file SPDINVOICE not found.", "notfound"],
    ["job not found", "com.ibm.as400.access.AS400Exception: CPF3342 Job 000001/DEMOUSER/QPRTJOB not found.", "notfound"],
    ["not authorized", "com.ibm.as400.access.AS400Exception: CPF3401 Not authorized to spooled file.", "authority"],
    ["SQL not authorized", "java.sql.SQLException: [SQL0551] Not authorized to object OUTPUT_QUEUE_INFO in QSYS2 type *FILE.", "authority"],
    ["anything else", "java.lang.IllegalStateException: Something odd", "other"],
  ];

  it.each(cases)("maps %s", (_label, text, code) => {
    const err = toConnectionError(javaError(text), [PASSWORD]);
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.code).toBe(code);
    expect(err.message).not.toContain("\tat ");
    expect(err.message).not.toMatch(/^Error running/);
  });

  it("never carries the password, in any case, in the message", () => {
    const texts = [
      `java.sql.SQLException: login failed for DEMOUSER/${PASSWORD}`,
      `connection string PWD=${PASSWORD.toUpperCase()};UID=DEMOUSER`,
      `password ${PASSWORD.toLowerCase()} rejected`,
      `url ?password=${encodeURIComponent(PASSWORD)}`,
    ];
    for (const text of texts) {
      const err = toConnectionError(new Error(text, { cause: new Error(`inner ${PASSWORD}`) }), [PASSWORD], `Context ${PASSWORD}`);
      expect(err.message).not.toContain(PASSWORD);
      expect(err.message.toLowerCase()).not.toContain(PASSWORD.toLowerCase());
      expect(err.message).not.toContain(encodeURIComponent(PASSWORD));
      expect(err.cause).toBeUndefined();
      expect(err.stack ?? "").not.toContain(PASSWORD);
    }
  });

  it("redacts a passed-through ConnectionError again", () => {
    const err = toConnectionError(new ConnectionError("auth", `bad ${PASSWORD}`), [PASSWORD]);
    expect(err.code).toBe("auth");
    expect(err.message).toBe("bad ***");
  });

  it("handles thrown non-errors", () => {
    const err = toConnectionError(`plain string with ${PASSWORD}`, [PASSWORD]);
    expect(err.code).toBe("other");
    expect(err.message).toBe("plain string with ***");
  });

  it("prefixes a context", () => {
    const err = toConnectionError(new Error("com.ibm.as400.access.AS400Exception: CPF3C40 not found."), [PASSWORD], "Spooled file X");
    expect(err.message).toBe("Spooled file X: CPF3C40 not found.");
  });
});

describe("helpers", () => {
  it("classifies by code before falling back to other", () => {
    expect(classifyError("CPF3C40")).toBe("notfound");
    expect(classifyError("")).toBe("other");
  });

  it("redact ignores empty secrets", () => {
    expect(redact("abc", ["", PASSWORD])).toBe("abc");
  });

  it("summarize takes the innermost exception message", () => {
    expect(summarize("Error running\njava.lang.RuntimeException: outer\nCaused by: java.io.IOException: inner\n\tat x")).toBe("inner");
    expect(summarize("just text")).toBe("just text");
  });
});
