import { parse as parseYaml, stringify as stringifyYaml, YAMLParseError } from "yaml";
import { z } from "zod";
import { namePatternProblems } from "./template.js";

const identifier = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "use letters, digits and underscores, starting with a letter");

const regexString = z
  .string()
  .min(1)
  .refine(
    (s) => {
      try {
        new RegExp(s);
        return true;
      } catch {
        return false;
      }
    },
    { message: "not a valid regular expression" },
  );

const positiveInt = z.number().int().positive();

/** Value type of a field or column. Numbers and dates are converted; strings are trimmed. */
export const valueTypeSchema = z.enum(["string", "number", "date"]);
export type ValueType = z.infer<typeof valueTypeSchema>;

/**
 * Where a field's value is on the page. Exactly one of:
 * `{ after, length? }`, `{ regex, group? }` or `{ line, column, length }`.
 */
export const fieldAnchorSchema = z
  .object({
    after: z.string().min(1).optional().describe("Label text; the value follows it on the same line"),
    regex: regexString.optional().describe("Regular expression tested line by line; the first match on the page wins"),
    group: z.number().int().nonnegative().optional().describe("Capture group of `regex` (default 1, or 0 when the regex has no groups)"),
    line: positiveInt.optional().describe("Fixed position: 1-based line"),
    column: positiveInt.optional().describe("Fixed position: 1-based column"),
    length: positiveInt.optional().describe("Fixed length of the value (with `after` or a fixed position)"),
  })
  .strict()
  .superRefine((a, ctx) => {
    const kinds = [
      a.after !== undefined ? "after" : null,
      a.regex !== undefined ? "regex" : null,
      a.line !== undefined || a.column !== undefined ? "line/column" : null,
    ].filter((k): k is string => k !== null);
    if (kinds.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message:
          kinds.length === 0
            ? "an anchor needs one of `after`, `regex` or `line`/`column`/`length`"
            : `an anchor needs exactly one of \`after\`, \`regex\` or \`line\`/\`column\`/\`length\`, found ${kinds.join(" and ")}`,
      });
      return;
    }
    if (kinds[0] === "line/column" && (a.line === undefined || a.column === undefined || a.length === undefined)) {
      ctx.addIssue({ code: "custom", message: "a fixed position needs `line`, `column` and `length`" });
    }
    if (kinds[0] !== "regex" && a.group !== undefined) {
      ctx.addIssue({ code: "custom", message: "`group` only goes with `regex`", path: ["group"] });
    }
    if (kinds[0] === "regex" && a.length !== undefined) {
      ctx.addIssue({ code: "custom", message: "`length` does not go with `regex`", path: ["length"] });
    }
  })
  .describe("Exactly one of { after, length? }, { regex, group? } or { line, column, length }");
export type FieldAnchor = z.infer<typeof fieldAnchorSchema>;

/** Which pages of a page group a field is read from: `first` (default), `last`, `all` (first match on any page) or a page number. */
export const pageRuleSchema = z.union([z.enum(["first", "last", "all"]), positiveInt]);
export type PageRule = z.infer<typeof pageRuleSchema>;

export const textFieldSchema = z
  .object({
    name: identifier,
    anchor: fieldAnchorSchema,
    page: pageRuleSchema.optional(),
    type: valueTypeSchema.optional(),
  })
  .strict();
export type TextField = z.infer<typeof textFieldSchema>;

const patternSchema = z.object({ pattern: regexString }).strict();

export const columnSchema = z
  .object({ name: identifier, column: positiveInt, length: positiveInt, type: valueTypeSchema.optional() })
  .strict();
export type Column = z.infer<typeof columnSchema>;

export const tableSchema = z
  .object({
    name: identifier,
    header: patternSchema.describe("The column header line; rows start on the next line"),
    columns: z.array(columnSchema).min(1),
    until: patternSchema.optional().describe("Rows stop before the first line matching this (default: end of the page body)"),
    skip: patternSchema.optional().describe("Lines matching this inside the table are not rows (rules, notes)"),
  })
  .strict();
export type Table = z.infer<typeof tableSchema>;

export const recordColumnSchema = z
  .object({
    name: identifier,
    line: positiveInt.describe("1-based line within the record"),
    column: positiveInt,
    length: positiveInt,
    type: valueTypeSchema.optional(),
  })
  .strict();
export type RecordColumn = z.infer<typeof recordColumnSchema>;

export const recordSchema = z
  .object({
    name: identifier,
    start: patternSchema.describe("A line matching this starts a record"),
    lines: positiveInt.describe("How many printed lines one record spans"),
    columns: z.array(recordColumnSchema).min(1),
  })
  .strict()
  .superRefine((r, ctx) => {
    r.columns.forEach((c, i) => {
      if (c.line > r.lines) {
        ctx.addIssue({ code: "custom", message: `line ${c.line} is past the record's ${r.lines} lines`, path: ["columns", i, "line"] });
      }
    });
  });
export type RecordDef = z.infer<typeof recordSchema>;

export const textSourceSchema = z
  .object({
    page: z.object({ width: positiveInt, length: positiveInt }).strict(),
    skipFirstPage: z.boolean().optional(),
    header: z.object({ lines: z.number().int().nonnegative() }).strict().optional(),
    footer: z.object({ fromLine: positiveInt }).strict().optional(),
    split: z.object({ field: identifier }).strict().optional(),
    fields: z.array(textFieldSchema).optional(),
    tables: z.array(tableSchema).optional(),
    records: z.array(recordSchema).optional(),
  })
  .strict();
export type TextSource = z.infer<typeof textSourceSchema>;

/** An XML value: a slash path relative to its parent, optionally with a type. */
export const xmlValueSchema = z.union([
  z.string().min(1),
  z.object({ path: z.string().min(1), type: valueTypeSchema.optional() }).strict(),
]);
export type XmlValue = z.infer<typeof xmlValueSchema>;

export const xmlSourceSchema = z
  .object({
    pageGroup: z.string().min(1).describe("Name of the element that holds one page group"),
    fields: z.record(identifier, xmlValueSchema).optional().describe("Field name to slash path from the root"),
    groups: z
      .record(
        identifier,
        z.object({ path: z.string().min(1), map: z.record(identifier, xmlValueSchema) }).strict(),
      )
      .optional()
      .describe("Repeating elements: path from the root, and child paths per item"),
  })
  .strict();
export type XmlSource = z.infer<typeof xmlSourceSchema>;

export const definitionSchema = z
  .object({
    type: z.string().regex(/^[a-z0-9-]+$/, "use lowercase letters, digits and dashes"),
    version: z.literal(1),
    match: z
      .object({
        splf: z.string().optional(),
        queue: z.string().optional(),
        userData: z.string().optional(),
        page1: regexString.optional().describe("Regular expression tested on the text of page 1"),
      })
      .strict()
      .optional(),
    source: z.enum(["text", "xml"]),
    text: textSourceSchema.optional(),
    xml: xmlSourceSchema.optional(),
    output: z
      .object({
        name: z.string().min(1).describe("File name of each document, with tags such as {d.pageGroup.invoiceNo}"),
        title: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.source === "text" && !d.text) ctx.addIssue({ code: "custom", message: "`source: text` needs a `text` section", path: ["text"] });
    if (d.source === "xml" && !d.xml) ctx.addIssue({ code: "custom", message: "`source: xml` needs an `xml` section", path: ["xml"] });
    const split = d.text?.split?.field;
    if (split && !d.text?.fields?.some((f) => f.name === split)) {
      ctx.addIssue({ code: "custom", message: `split field \`${split}\` is not in \`fields\``, path: ["text", "split", "field"] });
    }
    for (const problem of d.output?.name ? namePatternProblems(d.output.name) : []) {
      ctx.addIssue({ code: "custom", message: problem, path: ["output", "name"] });
    }
    const names = new Set<string>();
    const add = (name: string, path: (string | number)[]): void => {
      if (names.has(name)) ctx.addIssue({ code: "custom", message: `duplicate name \`${name}\``, path });
      names.add(name);
    };
    d.text?.fields?.forEach((f, i) => add(f.name, ["text", "fields", i, "name"]));
    d.text?.tables?.forEach((t, i) => add(t.name, ["text", "tables", i, "name"]));
    d.text?.records?.forEach((r, i) => add(r.name, ["text", "records", i, "name"]));
  });

/** A definition: how to find the page groups of a spooled file and the values in them. */
export type Definition = z.infer<typeof definitionSchema>;

/** Thrown when a definition is not valid YAML or does not match the schema. */
export class DefinitionError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid definition:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "DefinitionError";
    this.issues = issues;
  }
}

/** Formats an issue path as `text.fields[0].anchor`. */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const p of path) {
    if (typeof p === "number") out += `[${p}]`;
    else out += out ? `.${String(p)}` : String(p);
  }
  return out || "(root)";
}

/** Validates a definition object. Throws `DefinitionError` with readable paths. */
export function validateDefinition(value: unknown): Definition {
  const result = definitionSchema.safeParse(value);
  if (!result.success) {
    throw new DefinitionError(result.error.issues.map((i) => `${formatIssuePath(i.path)}: ${i.message}`));
  }
  return result.data;
}

/** Parses and validates definition YAML. Throws `DefinitionError`. */
export function parseDefinition(yaml: string): Definition {
  let value: unknown;
  try {
    value = parseYaml(yaml, { prettyErrors: true });
  } catch (err) {
    const msg = err instanceof YAMLParseError || err instanceof Error ? err.message : String(err);
    throw new DefinitionError([`YAML: ${msg}`]);
  }
  return validateDefinition(value);
}

/** Formats a definition as YAML. */
export function formatDefinition(def: Definition): string {
  return stringifyYaml(def, { lineWidth: 0 });
}

/** JSON Schema of a definition, for model prompts. */
export const definitionJsonSchema = z.toJSONSchema(definitionSchema);
