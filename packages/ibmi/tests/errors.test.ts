import { describe, expect, it } from "vitest";
import { classifyError, ConnectionError, guidance, isConnectionLost, messageIdOf, redact, summarize, toConnectionError } from "../src/index.js";

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

  it("redacts a passed-through ConnectionError again, keeping its ID and detail", () => {
    const err = toConnectionError(new ConnectionError("auth", `bad ${PASSWORD}`, { messageId: "CPF22E2", detail: `was ${PASSWORD}` }), [PASSWORD]);
    expect(err.code).toBe("auth");
    expect(err.message).toBe("bad ***");
    expect(err.messageId).toBe("CPF22E2");
    expect(err.detail).toBe("was ***");
  });

  it("handles thrown non-errors", () => {
    const err = toConnectionError(`plain string with ${PASSWORD}`, [PASSWORD]);
    expect(err.code).toBe("other");
    expect(err.message).toBe("plain string with ***");
  });

  const hostCases: [string, unknown, string][] = [
    [
      "an UnknownHostException",
      javaError("java.net.UnknownHostException: ibmi.example.com: nodename nor servname provided, or not known"),
      "Cannot reach ibmi.example.com: unknown host. Check the host name on the Servers page.",
    ],
    [
      "the JDBC driver's host detail",
      javaError("java.sql.SQLException: The application requester cannot establish the connection. (ibmi.example.com)"),
      "Cannot reach ibmi.example.com: unknown host. Check the host name on the Servers page.",
    ],
    [
      "a refused JDBC connection",
      javaError("java.sql.SQLException: The application requester cannot establish the connection. (Connection refused)"),
      "Cannot reach the system: connection refused. Check that the host servers run on the IBM i (STRHOSTSVR SERVER(*ALL)) and that ports 449 and 8470 to 8476 are open.",
    ],
    [
      "a ConnectException",
      javaError("java.net.ConnectException: Connection refused"),
      "Cannot reach the system: connection refused. Check that the host servers run on the IBM i (STRHOSTSVR SERVER(*ALL)) and that ports 449 and 8470 to 8476 are open.",
    ],
    [
      "a timeout",
      javaError("java.net.SocketTimeoutException: Connect timed out"),
      "Cannot reach the system: connection timed out. Check the network and that a firewall lets ports 449 and 8470 to 8476 through.",
    ],
  ];

  it.each(hostCases)("reads the host and reason from %s", (_label, err, message) => {
    const out = toConnectionError(err, [PASSWORD]);
    expect(out.code).toBe("host");
    expect(out.message).toBe(message);
  });

  const dropped: [string, string][] = [
    ["08003", "java.sql.SQLException: The connection does not exist. (08003)"],
    ["08S01", "java.sql.SQLException: [SQL08S01] Communication failure. (08S01)"],
    ["a communication link failure", "java.sql.SQLException: Communication link failure. (Connection reset)"],
    ["a reset connection", "java.net.SocketException: Connection reset"],
    ["a closed socket", "java.net.SocketException: Socket closed"],
    ["a broken pipe", "java.net.SocketException: Broken pipe (Write failed)"],
    ["a dropped connection", "com.ibm.as400.access.ConnectionDroppedException: Connection dropped unexpectedly."],
  ];

  it.each(dropped)("calls %s a dropped connection and says what happens next", (_label, text) => {
    expect(isConnectionLost(text)).toBe(true);
    const err = toConnectionError(javaError(text), [PASSWORD], undefined, { host: "ibmi.example.com" });
    expect(err.code).toBe("host");
    expect(err.message).toBe(
      "The connection to ibmi.example.com dropped. Spooldoc connects again on the next try. If it keeps failing, check the network or VPN to ibmi.example.com.",
    );
  });

  it("still calls a missing library not found", () => {
    const err = toConnectionError(javaError("java.sql.SQLException: [SQL0204] MYLIB in *LIBL type *LIB does not exist."), [PASSWORD]);
    expect(err.code).toBe("notfound");
    expect(isConnectionLost("Library MYLIB does not exist.")).toBe(false);
  });

  it("reads the detail from a Java cause when the bridge message has none", () => {
    const javaCause = {
      toStringSync: () => "java.sql.SQLException: The application requester cannot establish the connection. (ibmi.example.com)",
      getCauseSync: () => null,
    };
    const err = toConnectionError(new Error("Error running static method", { cause: javaCause }), [PASSWORD]);
    expect(err.code).toBe("host");
    expect(err.message).toBe("Cannot reach ibmi.example.com: unknown host. Check the host name on the Servers page.");
  });

  it("redacts the password from a host message", () => {
    const err = toConnectionError(javaError(`java.net.UnknownHostException: ${PASSWORD}.example.com`), [PASSWORD]);
    expect(err.code).toBe("host");
    expect(err.message).toBe("Cannot reach ***.example.com: unknown host. Check the host name on the Servers page.");
  });

  it("prefixes a context when there is no guidance", () => {
    const err = toConnectionError(new Error("java.lang.IllegalStateException: Something odd"), [PASSWORD], "The command");
    expect(err.message).toBe("The command: Something odd");
    expect(err.detail).toBe("The command: Something odd");
    expect(err.messageId).toBeUndefined();
  });

  it("names the host it was given when the error does not", () => {
    const err = toConnectionError(javaError("java.net.ConnectException: Connection refused"), [PASSWORD], undefined, { host: "ibmi.example.com" });
    expect(err.message).toMatch(/^Cannot reach ibmi\.example\.com: connection refused\. /);
  });

  it("keeps the system's own text and message ID next to the guidance", () => {
    const err = toConnectionError(
      javaError("com.ibm.as400.access.AS400Exception: CPF3C40 Spooled file SPDINVOICE not found."),
      [PASSWORD],
      "Spooled file SPDINVOICE number 1 of job 000001/DEMOUSER/QPRTJOB",
      { host: "ibmi.example.com", user: "demouser" },
    );
    expect(err.code).toBe("notfound");
    expect(err.messageId).toBe("CPF3C40");
    expect(err.message).toBe(
      "Spooled file SPDINVOICE number 1 of job 000001/DEMOUSER/QPRTJOB is no longer on ibmi.example.com. It was deleted or printed, or its job's output was cleaned up. (CPF3C40)",
    );
    expect(err.detail).toBe("Spooled file SPDINVOICE number 1 of job 000001/DEMOUSER/QPRTJOB: CPF3C40 Spooled file SPDINVOICE not found.");
  });
});

describe("guidance", () => {
  const target = { host: "ibmi.example.com", user: "demouser" };
  const cases: [string, ConnectionError["code"], string, string | undefined, string][] = [
    ["a wrong password", "auth", "AS400SecurityException: Password is not correct.", undefined, "ibmi.example.com did not accept the password for DEMOUSER. Check it on the Servers page; repeated wrong passwords can disable the profile."],
    ["a wrong JDBC password", "auth", "SQLException: The application server rejected the connection. (Password is incorrect.:DEMOUSER)", undefined, "ibmi.example.com did not accept the password for DEMOUSER. Check it on the Servers page; repeated wrong passwords can disable the profile."],
    ["a disabled profile", "auth", "CPF22E3 User profile DEMOUSER is disabled.", undefined, "The user profile DEMOUSER is disabled on ibmi.example.com. A security officer can enable it with CHGUSRPRF USRPRF(DEMOUSER) STATUS(*ENABLED)."],
    ["an expired password", "auth", "AS400SecurityException: Password has expired.", undefined, "The password of DEMOUSER has expired. Set a new one on the IBM i, then enter it for the server on the Servers page."],
    ["a profile without a password", "auth", "CPF22E5 No password associated with user DEMOUSER.", undefined, "DEMOUSER has no password (PASSWORD(*NONE)), so it cannot sign on. Use a user profile with a password."],
    ["an unknown user", "auth", "AS400SecurityException: User ID is not known.", undefined, "There is no user profile DEMOUSER on ibmi.example.com. Check the user on the Servers page."],
    ["any other sign-on failure", "auth", "[SQL30082] Authorization failure on distributed database connection attempt.", undefined, "ibmi.example.com did not accept the user profile or password. Check them on the Servers page."],
    ["no authority to an output queue", "authority", "[SQL0551] Not authorized to object FORMS in MYLIB type *OUTQ.", undefined, "DEMOUSER is not authorized to output queue MYLIB/FORMS. A security officer can grant it, for example with GRTOBJAUT OBJ(MYLIB/FORMS) OBJTYPE(*OUTQ) USER(DEMOUSER) AUT(*USE)."],
    ["no authority to a library", "authority", "CPF2182 Not authorized to library MYLIB.", undefined, "DEMOUSER is not authorized to library MYLIB. A security officer can grant it with GRTOBJAUT OBJ(MYLIB) OBJTYPE(*LIB) USER(DEMOUSER) AUT(*USE)."],
    ["no authority to a spooled file", "authority", "CPF3401 Not authorized to spooled file.", "Spooled file X number 1 of job 1/U/J", "DEMOUSER is not authorized to this spooled file. Working with other users' spooled files needs *SPLCTL special authority, or *JOBCTL on an output queue created with OPRCTL(*YES)."],
    ["no authority to something unnamed", "authority", "not authorized", "Data queue MYLIB/SPOOLDOC", "DEMOUSER is not authorized to data queue MYLIB/SPOOLDOC. A security officer can grant it; the details name the object."],
    ["a missing output queue", "notfound", "CPF2105 Object FORMS in MYLIB type *OUTQ not found.", undefined, "Output queue MYLIB/FORMS does not exist on ibmi.example.com. If it was renamed or deleted, point the job's source at another queue."],
    ["a missing data queue", "notfound", "[SQL0204] SPOOLDOC in MYLIB type *DTAQ not found.", undefined, "Data queue MYLIB/SPOOLDOC does not exist on ibmi.example.com. Turn on real-time watching for the queue again to create it."],
    ["a missing library", "notfound", "CPF2110 Library MYLIB not found.", undefined, "Library MYLIB does not exist on ibmi.example.com. Check the name, or change the job's source if the library was renamed."],
    ["a missing spooled file", "notfound", "CPF3344 File QPRINT number 3 no longer in the system.", undefined, "The spooled file is no longer on ibmi.example.com. It was deleted or printed, or its job's output was cleaned up."],
  ];

  it.each(cases)("says what to do about %s", (_label, code, text, context, expected) => {
    expect(guidance(code, text, context, target)).toBe(expected);
  });

  it("leaves errors it cannot help with to the system's text", () => {
    expect(guidance("other", "Something odd", undefined, target)).toBeUndefined();
    expect(guidance("notfound", "not found", undefined, target)).toBeUndefined();
  });

  it("reads without a host or user", () => {
    expect(guidance("auth", "Password is not correct.")).toBe(
      "The IBM i did not accept the password for the user profile. Check it on the Servers page; repeated wrong passwords can disable the profile.",
    );
    expect(guidance("auth", "User profile is disabled.")).toBe(
      "The user profile is disabled on the IBM i. A security officer can enable it with CHGUSRPRF USRPRF(name) STATUS(*ENABLED).",
    );
  });
});

describe("helpers", () => {
  it("reads the IBM i message ID", () => {
    expect(messageIdOf("com.ibm.as400.access.AS400Exception: CPF22E2 Password not correct")).toBe("CPF22E2");
    expect(messageIdOf("[SQL0551] Not authorized")).toBe("SQL0551");
    expect(messageIdOf("Password is not correct.")).toBeUndefined();
  });

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
