import { describe, expect, it } from "vitest";
import { classifyError, guidance, QUERY_CONTEXT, singleQueryProblem, sqlOutsideLiterals, toConnectionError } from "../src/index.js";
import { jdbcProperties, openJavaJdbc, type JavaModule } from "../src/jt400/bridge.js";
import { describeQuery, runQuery } from "../src/jt400/query.js";
import { linear, TIMING } from "./helpers/linear.js";

describe("singleQueryProblem", () => {
  it.each([
    ["a SELECT", "SELECT CUSNAM FROM MYLIB.CUSTMAST WHERE CUSNO = ?"],
    ["a WITH", "WITH C AS (SELECT * FROM MYLIB.CUSTMAST) SELECT * FROM C"],
    ["a VALUES", "VALUES CURRENT DATE"],
    ["lower case after a comment and a parenthesis", "-- the customer\n/* name */ (select cusnam from mylib.custmast)"],
    ["a semicolon in a string constant", "SELECT * FROM MYLIB.NOTES WHERE TEXT = 'a; b'"],
    ["a semicolon in a delimited name", 'SELECT "A;B" FROM MYLIB.NOTES'],
    ["a semicolon in a comment", "SELECT * FROM MYLIB.NOTES -- one; two\nWHERE ID = ?"],
    ["a doubled quote in a string constant", "SELECT * FROM MYLIB.NOTES WHERE TEXT = 'it''s; fine'"],
  ])("lets %s through", (_label, sql) => {
    expect(singleQueryProblem(sql)).toBeNull();
  });

  it.each([
    ["an INSERT", "INSERT INTO MYLIB.CUSTMAST VALUES (1)", /this one is INSERT/],
    ["a CALL", "CALL MYLIB.MYPGM()", /this one is CALL/],
    ["a DELETE after a comment", "/* SELECT */ DELETE FROM MYLIB.CUSTMAST", /this one is DELETE/],
    ["two statements", "SELECT 1 FROM SYSIBM.SYSDUMMY1; DELETE FROM MYLIB.CUSTMAST", /Remove the semicolon/],
    ["a trailing semicolon", "SELECT 1 FROM SYSIBM.SYSDUMMY1;", /Remove the semicolon/],
    ["a data change in the FROM", "SELECT * FROM FINAL TABLE (INSERT INTO MYLIB.LOG VALUES (1))", /reads data only/],
    ["an empty statement", "  -- nothing\n", /empty/],
  ])("refuses %s", (_label, sql, message) => {
    expect(singleQueryProblem(sql)).toMatch(message);
  });

  it("blanks literals and comments and keeps every offset", () => {
    const sql = "SELECT 'x;y', \"A\" -- c\nFROM T /* d */";
    const code = sqlOutsideLiterals(sql);
    expect(code).toHaveLength(sql.length);
    expect(code).toBe(`SELECT ${" ".repeat(5)}, ${" ".repeat(3)} ${" ".repeat(4)}\nFROM T ${" ".repeat(7)}`);
  });

  it("reads a long statement in linear time", TIMING, () => {
    linear((n) => "SELECT 'a' ".repeat(n), singleQueryProblem, 6_400);
    linear((n) => "SELECT /* a */ -- b\n".repeat(n), singleQueryProblem, 6_400);
  });
});

describe("the read-only connection", () => {
  it("is opened with access read only and a query timeout that cancels", () => {
    expect(jdbcProperties("DEMOUSER", { readOnly: true })).toMatchObject({
      user: "DEMOUSER",
      naming: "sql",
      access: "read only",
      "query timeout mechanism": "cancel",
      "date format": "iso",
    });
    expect(jdbcProperties("DEMOUSER")).not.toHaveProperty("access");
  });

  it("passes the properties and the password to the jt400 driver", async () => {
    const set: Record<string, string> = {};
    let url = "";
    const java = {
      import: (name: string) =>
        name === "java.util.Properties"
          ? class {
              setPropertySync(key: string, value: string) {
                set[key] = value;
              }
            }
          : class {
              async connect(to: string) {
                url = to;
                return { open: true };
              }
            },
    } as unknown as JavaModule;
    await expect(openJavaJdbc("ibmi.example.com", "DEMOUSER", "s3cret!Pw", { readOnly: true }, java)).resolves.toEqual({ open: true });
    expect(url).toBe("jdbc:as400://ibmi.example.com");
    expect(set).toMatchObject({ user: "DEMOUSER", password: "s3cret!Pw", access: "read only", "query timeout mechanism": "cancel" });
  });
});

interface FakeColumn {
  name: string;
  type: string;
  precision?: number;
  scale?: number;
}

/** Metadata of columns, as the `ResultSetMetaData` proxy answers. */
const metadata = (columns: FakeColumn[]) => ({
  getColumnCountSync: () => columns.length,
  getColumnLabelSync: (i: number) => columns[i - 1]!.name,
  getColumnTypeNameSync: (i: number) => columns[i - 1]!.type,
  getPrecisionSync: (i: number) => columns[i - 1]!.precision ?? 10,
  getScaleSync: (i: number) => columns[i - 1]!.scale ?? 0,
  isNullableSync: () => 1,
});

/** A `java.sql.Connection` proxy whose statements answer `rows` and record what was set. */
function fakeDb(columns: FakeColumn[], rows: (string | null)[][], parseTypes: string[] = ["QUERY"]) {
  const log: string[] = [];
  let fetched = 0;
  const db = {
    prepareStatement: async (sql: string) => {
      const parse = sql.includes("PARSE_STATEMENT");
      const answer = parse ? parseTypes.map((type) => [type]) : rows;
      const cols = parse ? [{ name: "SQL_STATEMENT_TYPE", type: "VARCHAR" }] : columns;
      let at = -1;
      return {
        setQueryTimeoutSync: (s: number) => log.push(`timeout ${s}`),
        setMaxRowsSync: (n: number) => log.push(`maxRows ${n}`),
        setFetchSizeSync: () => undefined,
        setStringSync: (i: number, v: string) => log.push(`param ${i} = ${v}`),
        setNullSync: (i: number) => log.push(`param ${i} = null`),
        executeQuery: async () => ({
          getMetaDataSync: () => metadata(cols),
          next: async () => {
            if (at + 1 >= answer.length) return false;
            at++;
            if (!parse) fetched++;
            return true;
          },
          getStringSync: (i: number) => answer[at]![i - 1],
          closeSync: () => undefined,
        }),
        getMetaData: async () => metadata(columns),
        getParameterMetaData: async () => ({
          getParameterCountSync: () => 1,
          getParameterTypeNameSync: () => "DECIMAL",
          getPrecisionSync: () => 7,
          getScaleSync: () => 0,
          isNullableSync: () => 0,
        }),
        closeSync: () => log.push(parse ? "close parse" : "close"),
      };
    },
  };
  return { db, log, fetched: () => fetched };
}

describe("runQuery", () => {
  const columns = [
    { name: "CUSNO", type: "DECIMAL", precision: 7 },
    { name: "CUSNAM", type: "CHAR", precision: 30 },
    { name: "NOTE", type: "VARCHAR", precision: 100 },
  ];

  it("binds the values, sets the limits and trims the padding of CHAR only", async () => {
    const fake = fakeDb(columns, [["1001", "ACME OY   ", "keep  "]]);
    const result = await runQuery(fake.db, "SELECT CUSNO, CUSNAM, NOTE FROM MYLIB.CUSTMAST WHERE CUSNO = ? AND REGION = ?", [1001, null], {
      maxRows: 5,
      timeoutSeconds: 10,
    });
    expect(result).toEqual({
      columns: [
        { name: "CUSNO", type: "DECIMAL", precision: 7, scale: 0, nullable: true },
        { name: "CUSNAM", type: "CHAR", precision: 30, scale: 0, nullable: true },
        { name: "NOTE", type: "VARCHAR", precision: 100, scale: 0, nullable: true },
      ],
      rows: [{ CUSNO: "1001", CUSNAM: "ACME OY", NOTE: "keep  " }],
      truncated: false,
    });
    expect(fake.log).toEqual(["timeout 10", "maxRows 6", "param 1 = 1001", "param 2 = null", "close"]);
  });

  it("says when there were more rows than maxRows and reads only one more", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => [String(i), "X", null]);
    const fake = fakeDb(columns, rows);
    const result = await runQuery(fake.db, "SELECT * FROM MYLIB.CUSTMAST", [], { maxRows: 3, timeoutSeconds: 10 });
    expect(result.rows.map((row) => row.CUSNO)).toEqual(["0", "1", "2"]);
    expect(result.truncated).toBe(true);
    expect(fake.fetched()).toBe(4);
  });

  it("does not call a result of exactly maxRows cut off", async () => {
    const fake = fakeDb(columns, [["1", "A", null], ["2", "B", null]]);
    const result = await runQuery(fake.db, "SELECT * FROM MYLIB.CUSTMAST", [], { maxRows: 2, timeoutSeconds: 10 });
    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it("refuses a statement that is not a query before it reaches the IBM i", async () => {
    const fake = fakeDb(columns, []);
    await expect(runQuery(fake.db, "UPDATE MYLIB.CUSTMAST SET CUSNAM = ''", [], { maxRows: 1, timeoutSeconds: 1 })).rejects.toMatchObject({
      name: "ConnectionError",
      code: "query",
    });
    expect(fake.log).toEqual([]);
  });
});

describe("describeQuery", () => {
  const columns = [{ name: "CUSNAM", type: "CHAR", precision: 30 }];

  it("describes the columns and the parameter markers without reading rows", async () => {
    const fake = fakeDb(columns, [["ACME", null]]);
    await expect(describeQuery(fake.db, "SELECT CUSNAM FROM MYLIB.CUSTMAST WHERE CUSNO = ?")).resolves.toEqual({
      columns: [{ name: "CUSNAM", type: "CHAR", precision: 30, scale: 0, nullable: true }],
      parameters: [{ type: "DECIMAL", precision: 7, scale: 0, nullable: false }],
    });
    expect(fake.fetched()).toBe(0);
  });

  it("refuses a statement Db2 for i does not read as a query", async () => {
    const fake = fakeDb(columns, [], ["QUERY", "INSERT"]);
    await expect(describeQuery(fake.db, "SELECT * FROM MYLIB.CUSTMAST")).rejects.toMatchObject({
      code: "query",
      message: "A lookup runs one SELECT statement only, and Db2 for i reads this one as INSERT.",
    });
  });
});

describe("query errors", () => {
  const target = { host: "ibmi.example.com", user: "demouser" };
  const fail = (text: string) => toConnectionError(new Error(`java.sql.SQLException: ${text}`), ["s3cret!Pw"], QUERY_CONTEXT, target);

  it("explains a syntax error near the token Db2 for i stopped at", () => {
    const err = fail("[SQL0104] Token FORM was not valid. Valid tokens: , FROM INTO.");
    expect(err.code).toBe("query");
    expect(err.message).toBe("The query is not valid SQL: Db2 for i did not expect FORM there. Check the statement near FORM. (SQL0104)");
    expect(err.detail).toBe("The query: [SQL0104] Token FORM was not valid. Valid tokens: , FROM INTO.");
  });

  it("names a column that is not there, rather than calling it a missing object", () => {
    const err = fail("[SQL0206] Column or global variable CUSNAME not found.");
    expect(err.code).toBe("query");
    expect(err.message).toMatch(/^Column CUSNAME is not in the tables of the query\./);
    expect(classifyError("[SQL0206] Column or global variable CUSNAME not found.")).toBe("notfound");
  });

  it("says a value does not fit the type of its parameter", () => {
    const err = fail("[SQL0420] Character in CAST argument not valid.");
    expect(err.code).toBe("query");
    expect(err.message).toMatch(/^A value given to a parameter of the query does not fit its type/);
    expect(fail("Data type mismatch.").code).toBe("query");
  });

  it("calls a canceled query a timeout, which is not tried again as a dropped connection", () => {
    const err = fail("[SQL0952] Processing of the SQL statement ended. Reason code 10.");
    expect(err.code).toBe("timeout");
    expect(err.message).toMatch(/^The query ran longer than its time limit, so ibmi\.example\.com canceled it\./);
    expect(fail("Operation cancelled.").code).toBe("timeout");
  });

  it("says the read-only connection refused a change", () => {
    const err = fail("Connection authorization failure occurred.");
    expect(err.code).toBe("query");
    expect(err.message).toBe("The query would change data, and the read-only connection refused it. A lookup runs one SELECT statement only.");
  });

  it("names a missing table and how to qualify it", () => {
    const err = fail("[SQL0204] CUSTMAST in DEMOUSER type *FILE not found.");
    expect(err.code).toBe("notfound");
    expect(err.message).toBe(
      "Table or view DEMOUSER/CUSTMAST does not exist on ibmi.example.com. Check its name and library in the query. A name without a library is looked for in library DEMOUSER, so qualify it, such as MYLIB.CUSTMAST. (SQL0204)",
    );
    expect(fail("[SQL0204] MYLIB in QSYS type *LIB not found.").message).toMatch(/^Library MYLIB does not exist on ibmi\.example\.com\./);
    expect(fail("[SQL0204] CUSTMAST in *LIBL type *FILE not found.").message).toMatch(/^Table or view CUSTMAST does not exist/);
  });

  it("names the table a user profile is not authorized to", () => {
    const err = fail("[SQL0551] Not authorized to object CUSTMAST in MYLIB type *FILE.");
    expect(err.code).toBe("authority");
    expect(err.message).toBe(
      "DEMOUSER is not authorized to table or view MYLIB/CUSTMAST. A security officer can grant it, for example with GRTOBJAUT OBJ(MYLIB/CUSTMAST) OBJTYPE(*FILE) USER(DEMOUSER) AUT(*USE). (SQL0551)",
    );
  });

  it("still calls a dropped connection a host error", () => {
    expect(fail("The connection does not exist. (08003)").code).toBe("host");
  });

  it("looks for a missing table in linear time", TIMING, () => {
    linear((n) => "A".repeat(n), (text) => guidance("notfound", text, QUERY_CONTEXT), 6_400);
    linear((n) => "Token ".repeat(n), (text) => guidance("query", `SQL0104 ${text}`, QUERY_CONTEXT), 6_400);
  });
});
