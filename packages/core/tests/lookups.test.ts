import { describe, expect, it, vi } from "vitest";
import {
  applyLookups,
  bindParameters,
  checkTemplate,
  db2ValueType,
  lookupProblems,
  lookupSchema,
  lookupTestProblems,
  sqlParameters,
  templatePaths,
  type Lookup,
  type LookupQuery,
  type LookupQueryResult,
} from "../src/index.js";
import { loadFixture } from "./helpers/fixtures.js";

const { definition, expected } = loadFixture("invoice");
const groups = expected as Record<string, unknown>[];

const lookup = (over: Partial<Lookup> = {}): Lookup =>
  lookupSchema.parse({ name: "customer", sql: "SELECT NAME, EMAIL, LANG FROM MYLIB.CUSTOMERS WHERE CUSTNO = :customerNo", ...over });

const tested = (l: Lookup, columns: Lookup["checked"] extends infer C ? (C extends { columns: infer K } ? K : never) : never): Lookup => ({
  ...l,
  checked: { sql: l.sql, columns },
});

const CUSTOMER_COLUMNS = [
  { name: "NAME", type: "CHAR" },
  { name: "EMAIL", type: "VARCHAR" },
  { name: "BALANCE", type: "DECIMAL" },
  { name: "SINCE", type: "DATE" },
];

/** A stand-in for the IBM i: one row per customer number, none for 10003. */
function customers(): LookupQuery & ReturnType<typeof vi.fn> {
  return vi.fn(async (_sql: string, params: (string | number | null)[], options: { maxRows: number }): Promise<LookupQueryResult> => {
    const custNo = String(params[0]);
    const rows = custNo === "10003" ? [] : [{ NAME: `Customer ${custNo}`, EMAIL: `ap-${custNo}@example.com   `, BALANCE: "1234.50", SINCE: "2020-01-31" }];
    return { columns: CUSTOMER_COLUMNS, rows: rows.slice(0, options.maxRows), truncated: rows.length > options.maxRows };
  }) as never;
}

describe("bindParameters", () => {
  it("replaces each parameter with a marker and lists the names in order, a repeated one twice", () => {
    expect(bindParameters("SELECT * FROM MYLIB.T WHERE A = :customerNo AND B = :customer.LANG OR C = :customerNo")).toEqual({
      sql: "SELECT * FROM MYLIB.T WHERE A = ? AND B = ? OR C = ?",
      names: ["customerNo", "customer.LANG", "customerNo"],
    });
  });

  it("leaves colons in string constants, delimited names and comments alone", () => {
    const sql = `SELECT ':notOne', "A:B" FROM MYLIB.T -- :comment\nWHERE T = '10:15' /* :block */ AND X = :real`;
    expect(bindParameters(sql)).toEqual({ sql: sql.replace(":real", "?"), names: ["real"] });
    expect(sqlParameters(sql).map((p) => sql.slice(p.start, p.end))).toEqual([":real"]);
  });

  it("takes no parameters from a doubled colon or a name with a colon inside", () => {
    expect(bindParameters("SELECT A::B, X:Y FROM MYLIB.T").names).toEqual([]);
  });
});

describe("db2ValueType", () => {
  it("maps Db2 for i types to the definition's value types", () => {
    expect(["DECIMAL", "NUMERIC", "INTEGER", "SMALLINT", "BIGINT", "DOUBLE", "DECFLOAT"].map(db2ValueType)).toEqual(Array(7).fill("number"));
    expect(db2ValueType("DATE")).toBe("date");
    expect(["CHAR", "VARCHAR", "TIMESTAMP", "TIME", "GRAPHIC"].map(db2ValueType)).toEqual(Array(5).fill("string"));
  });
});

describe("lookupProblems", () => {
  it("finds nothing wrong with a page group lookup on a field", () => {
    expect(lookupProblems(definition, [lookup()])).toEqual([]);
  });

  it("checks names: an identifier, used once, and no field or table of the definition", () => {
    const problems = lookupProblems(definition, [
      lookup({ name: "" }),
      lookup({ name: "my lookup" }),
      lookup({ name: "customer" }),
      lookup({ name: "customer" }),
      lookup({ name: "invoiceNo" }),
      lookup({ name: "lines" }),
      lookup({ name: "item", for: "lines", sql: "SELECT 1 FROM SYSIBM.SYSDUMMY1" }),
    ]);
    expect(problems.map((p) => [p.index, p.message])).toEqual([
      [0, "Lookup 1 has no name. Give it one, such as customer."],
      [1, "my lookup is not a name templates can read. Use letters, digits and underscores, starting with a letter."],
      [3, "Two lookups are named customer. Give each its own name."],
      [4, "invoiceNo is already a field of the definition. Give the lookup another name."],
      [5, "lines is already a table of the definition. Give the lookup another name."],
      [6, "item is already a column of lines. Give the lookup another name."],
    ]);
  });

  it("checks that a row lookup's table exists and that the SQL is there", () => {
    expect(lookupProblems(definition, [lookup({ for: "rows" }), lookup({ name: "other", sql: "  " })]).map((p) => p.message)).toEqual([
      "customer runs once per row of rows, but the definition has no table rows. Pick another table.",
      "Write the SQL of other.",
    ]);
  });

  it("resolves parameters to page group fields, row columns and earlier lookups only", () => {
    const customer = tested(lookup(), [
      { name: "NAME", type: "string" },
      { name: "LANG", type: "string" },
    ]);
    const product = lookup({ name: "product", for: "lines", sql: "SELECT DESC FROM MYLIB.PRODUCTS WHERE ITEM = :item AND LANG = :customer.LANG AND CUR = :currency" });
    expect(lookupProblems(definition, [customer, product])).toEqual([]);
    const problems = lookupProblems(definition, [
      lookup({ name: "first", sql: "SELECT 1 FROM MYLIB.T WHERE A = :later.X AND B = :nothing AND C = :item AND D = :lines" }),
      customer,
      lookup({ name: "later", sql: "SELECT X FROM MYLIB.T WHERE A = :customer AND B = :customer.MISSING AND C = :invoiceNo.x" }),
    ]);
    expect(problems.map((p) => p.message)).toEqual([
      ":later.X reads later, which runs after first. Move later above it.",
      ":nothing is not a field of the page group or an earlier lookup. Check the name against the definition.",
      ":item is not a field of the page group or an earlier lookup. Check the name against the definition.",
      ":lines is the table lines, and a parameter takes one value. To run once per row, set Runs to once per row of lines.",
      ":customer is a whole row of customer. Name one of its columns, such as :customer.NAME.",
      "customer has no column MISSING. Its columns are NAME, LANG.",
      ":invoiceNo.x reads x of invoiceNo, but invoiceNo is a single value. Write :invoiceNo.",
    ]);
  });

  it("finds a name that is both a column of the row and a field of the page group", () => {
    const def = structuredClone(definition);
    def.text!.fields!.push({ name: "item", anchor: { after: "Item:" } });
    const problems = lookupProblems(def, [lookup({ name: "product", for: "lines", sql: "SELECT 1 FROM MYLIB.P WHERE ITEM = :item" })]);
    expect(problems.map((p) => p.message)).toEqual([":item is both a column of lines and a field of the page group. Rename one of them."]);
  });

  it("refuses a parameter that reads every row of an earlier lookup", () => {
    const contacts = lookup({ name: "contacts", result: "many" });
    const problems = lookupProblems(definition, [contacts, lookup({ name: "next", sql: "SELECT 1 FROM MYLIB.T WHERE A = :contacts.EMAIL" })]);
    expect(problems.map((p) => p.message)).toEqual([":contacts.EMAIL reads every row of contacts, and a parameter takes one value. Read one row in contacts."]);
  });

  it("checks only names and SQL without a definition", () => {
    expect(lookupProblems(null, [lookup({ sql: "SELECT 1 FROM MYLIB.T WHERE A = :whatever" })])).toEqual([]);
  });
});

describe("lookupTestProblems", () => {
  it("asks to test a lookup that was never tested or changed since", () => {
    const ok = tested(lookup(), [{ name: "EMAIL", type: "string" }]);
    const changed = { ...ok, name: "changed", sql: `${ok.sql} AND 1 = 1` };
    expect(lookupTestProblems([ok, lookup({ name: "fresh" }), changed]).map((p) => [p.index, p.message])).toEqual([
      [1, "Test lookup fresh before you save this version."],
      [2, "changed changed since its test. Test it again before you save this version."],
    ]);
  });
});

describe("templatePaths with lookups", () => {
  it("adds each lookup and its tested columns, under pg and pgs", () => {
    const customer = tested(lookup(), [{ name: "EMAIL", type: "string" }]);
    const contacts = tested(lookup({ name: "contacts", result: "many" }), [{ name: "PHONE", type: "string" }]);
    const product = tested(lookup({ name: "product", for: "lines", sql: "SELECT DESC FROM MYLIB.P WHERE ITEM = :item" }), [{ name: "DESC", type: "string" }]);
    const paths = templatePaths(definition, [customer, contacts, product, lookup({ name: "untested" })]);
    for (const path of ["pg.customer", "pg.customer.EMAIL", "pgs[].customer.EMAIL", "pg.contacts", "pg.contacts[].PHONE", "pg.lines[].product.DESC", "pg.untested"]) {
      expect(paths.has(path), path).toBe(true);
    }
    expect(paths.has("pg.untested.EMAIL")).toBe(false);
    const html = "<p>{d.pg.customer.EMAIL}</p><p>{d.pg.lines[i].product.DESC}</p><p>{d.pg.lines[i+1]}</p><p>{d.pg.contacts[i].PHONE}{d.pg.contacts[i+1]}</p>";
    expect(checkTemplate(html, definition, { lookups: [customer, contacts, product] })).toEqual([]);
    expect(checkTemplate(html, definition)).toHaveLength(4);
  });
});

describe("applyLookups", () => {
  it("adds one row as an object, typed by Db2 type, without trailing blanks", async () => {
    const query = customers();
    const result = await applyLookups(groups, [lookup()], query);
    expect(result.groups[0]!.customer).toEqual({ NAME: "Customer 10001", EMAIL: "ap-10001@example.com", BALANCE: 1234.5, SINCE: "2020-01-31" });
    expect(query).toHaveBeenCalledWith("SELECT NAME, EMAIL, LANG FROM MYLIB.CUSTOMERS WHERE CUSTNO = ?", ["10001"], { maxRows: 1, timeoutSeconds: 30 });
    expect(result.traces[0]).toMatchObject({ lookup: "customer", pageGroup: 0, parameters: [{ name: "customerNo", value: "10001" }], rows: 1, cached: false });
    // The page groups passed in are not changed.
    expect(groups[0]!.customer).toBeUndefined();
  });

  it("adds every row as a list for a lookup that reads all rows", async () => {
    const result = await applyLookups(groups, [lookup({ result: "many" })], customers(), { only: [0] });
    expect(result.groups[0]!.customer).toEqual([expect.objectContaining({ NAME: "Customer 10001" })]);
    expect(result.groups[1]).toBe(groups[1]);
  });

  it("stops, warns or leaves it empty when no row is found, as the lookup says", async () => {
    const names = ["invoice-260101", "invoice-260102"];
    const only = [1];
    await expect(applyLookups(groups, [lookup({ missing: "fail" })], customers(), { only, names })).rejects.toThrow(
      "No row in customer for customerNo 10003 (invoice-260102). Check the values, or set When no row is found to Warn and leave it empty.",
    );
    const warned = await applyLookups(groups, [lookup({ missing: "warn" })], customers(), { only, names });
    expect(warned.misses).toEqual([{ lookup: "customer", pageGroup: 1, text: "No row in customer for customerNo 10003 (invoice-260102)" }]);
    expect(warned.groups[1]!.customer).toEqual({ NAME: null, EMAIL: null, BALANCE: null, SINCE: null });
    const empty = await applyLookups(groups, [lookup({ missing: "empty", result: "many" })], customers(), { only, names });
    expect(empty.misses).toEqual([]);
    expect(empty.groups[1]!.customer).toEqual([]);
  });

  it("stops when a lookup of one row finds more than one", async () => {
    const query: LookupQuery = async () => ({ columns: [{ name: "A", type: "CHAR" }], rows: [{ A: "1" }], truncated: true });
    await expect(applyLookups(groups, [lookup()], query, { only: [0] })).rejects.toThrow(
      "customer returned more than one row for customerNo 10001. Add a condition, or FETCH FIRST 1 ROW ONLY.",
    );
  });

  it("stops at more than 1,000 rows instead of cutting them off", async () => {
    const query = vi.fn<LookupQuery>(async (_sql, _params, options) => ({
      columns: [{ name: "A", type: "CHAR" }],
      rows: Array.from({ length: options.maxRows }, (_, i) => ({ A: String(i) })),
      truncated: true,
    }));
    await expect(applyLookups(groups, [lookup({ result: "many" })], query, { only: [0] })).rejects.toThrow(
      "customer returned more than 1,000 rows for customerNo 10001. A lookup reads at most 1,000 rows. Add a condition.",
    );
    expect(query.mock.calls[0]![2].maxRows).toBe(1000);
  });

  it("runs a row lookup once per distinct set of parameters, across page groups", async () => {
    const query = vi.fn<LookupQuery>(async (_sql, params) => ({ columns: [{ name: "DESC", type: "VARCHAR" }], rows: [{ DESC: `About ${String(params[0])}` }], truncated: false }));
    const product = lookup({ name: "product", for: "lines", sql: "SELECT DESC FROM MYLIB.PRODUCTS WHERE ITEM = :item" });
    const result = await applyLookups(groups, [product], query);
    const items = groups.flatMap((g) => (g.lines as { item: string }[]).map((l) => l.item));
    expect(query).toHaveBeenCalledTimes(new Set(items).size);
    expect(items.length).toBeGreaterThan(new Set(items).size);
    expect(((result.groups[0]!.lines as Record<string, unknown>[])[0]!.product as Record<string, unknown>).DESC).toBe("About A-1001");
    expect(result.traces.filter((t) => t.cached).length).toBe(items.length - new Set(items).size);
    expect(result.traces[0]).toMatchObject({ row: 0, pageGroup: 0 });
  });

  it("binds a column of an earlier lookup", async () => {
    const query = vi.fn<LookupQuery>(async (sql) =>
      sql.includes("CUSTOMERS")
        ? { columns: [{ name: "LANG", type: "CHAR" }], rows: [{ LANG: "FI" }], truncated: false }
        : { columns: [{ name: "TEXT", type: "VARCHAR" }], rows: [{ TEXT: "Hei" }], truncated: false },
    );
    const greeting = lookup({ name: "greeting", sql: "SELECT TEXT FROM MYLIB.TEXTS WHERE LANG = :customer.LANG AND KIND = 'A:B'" });
    const result = await applyLookups(groups, [lookup(), greeting], query, { only: [0] });
    expect(query.mock.calls[1]).toEqual(["SELECT TEXT FROM MYLIB.TEXTS WHERE LANG = ? AND KIND = 'A:B'", ["FI"], { maxRows: 1, timeoutSeconds: 30 }]);
    expect(result.groups[0]!.greeting).toEqual({ TEXT: "Hei" });
  });

  it("does not run a lookup that reads a column of an earlier one that found no row, and says so in the earlier miss", async () => {
    const query = vi.fn<LookupQuery>(async (sql, params, options) => {
      if (sql.includes("CUSTOMERS")) {
        const found = await customers()(sql, params, options);
        return { ...found, columns: [...found.columns, { name: "LANG", type: "CHAR" }], rows: found.rows.map((r) => ({ ...r, LANG: "FI" })) };
      }
      return { columns: [{ name: "DESCRIPTION", type: "VARCHAR" }], rows: [{ DESCRIPTION: "Kuvaus" }], truncated: false };
    });
    const product = tested(lookup({ name: "product", for: "lines", sql: "SELECT DESCRIPTION FROM MYLIB.ITEMS WHERE ITEMNO = :item AND LANG = :customer.LANG" }), [
      { name: "DESCRIPTION", type: "string" },
    ]);
    const greeting = lookup({ name: "greeting", sql: "SELECT TEXT FROM MYLIB.TEXTS WHERE LANG = :customer.LANG" });
    const result = await applyLookups(groups, [lookup(), product, greeting], query, { only: [1], names: ["invoice-260101", "invoice-260102"] });
    // Only the customer query ran: none per line, and no greeting.
    expect(query).toHaveBeenCalledTimes(1);
    expect(result.misses).toEqual([
      {
        lookup: "customer",
        pageGroup: 1,
        text: "No row in customer for customerNo 10003 (invoice-260102). product and greeting are left empty",
        leftEmpty: ["product", "greeting"],
      },
    ]);
    const lines = result.groups[1]!.lines as Record<string, unknown>[];
    expect(lines.every((line) => JSON.stringify(line.product) === JSON.stringify({ DESCRIPTION: null }))).toBe(true);
    expect(result.groups[1]!.greeting).toEqual({});
    expect(result.traces.filter((t) => t.skippedFor === "customer")).toHaveLength(lines.length + 1);

    // A page group whose customer is found runs the line lookup as usual.
    const found = await applyLookups(groups, [lookup(), product], query, { only: [0] });
    expect(found.misses).toEqual([]);
    expect(((found.groups[0]!.lines as Record<string, unknown>[])[0]!.product as Record<string, unknown>).DESCRIPTION).toBe("Kuvaus");
  });

  it("stops at the earlier lookup when it must find a row, before the later one runs", async () => {
    const query = vi.fn<LookupQuery>(customers());
    const product = lookup({ name: "product", for: "lines", sql: "SELECT 1 FROM MYLIB.ITEMS WHERE ITEMNO = :item AND LANG = :customer.LANG" });
    await expect(applyLookups(groups, [lookup({ missing: "fail" }), product], query, { only: [1] })).rejects.toThrow(/^No row in customer for customerNo 10003/);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("runs a lookup whose parameter is empty on the page, bound as NULL", async () => {
    const query = vi.fn<LookupQuery>(async () => ({ columns: [{ name: "A", type: "CHAR" }], rows: [], truncated: false }));
    const blank = groups.map((g) => ({ ...g, customerNo: null }));
    const result = await applyLookups(blank, [lookup()], query, { only: [0] });
    expect(query.mock.calls[0]![1]).toEqual([null]);
    expect(result.misses[0]!.text).toBe("No row in customer for customerNo (empty)");
  });

  it("names the lookup when the query fails, and keeps Db2's text as the detail", async () => {
    const failure = Object.assign(new Error("MYLIB.CUSTOMERS was not found (SQL0204). Check the library and table."), { detail: "SQL0204 CUSTOMERS in MYLIB type *FILE not found." });
    const query: LookupQuery = async () => {
      throw failure;
    };
    const error = await applyLookups(groups, [lookup()], query, { only: [0] }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      name: "LookupError",
      lookup: "customer",
      message: "Could not run customer: MYLIB.CUSTOMERS was not found (SQL0204). Check the library and table.",
      detail: "SQL0204 CUSTOMERS in MYLIB type *FILE not found.",
    });
  });

  it("does nothing without lookups", async () => {
    const query = vi.fn<LookupQuery>();
    const result = await applyLookups(groups, [], query);
    expect(result.groups[0]).toBe(groups[0]);
    expect(query).not.toHaveBeenCalled();
  });
});
