import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { writeXlsx, type Cell, type CellStyle, type ColumnDef, type ConditionalRule, type DataValidation, type WriteOptions, type WriteSheet } from "hucre/xlsx";
import { z } from "zod";
import { DesignError, issueMessage, pathText, type DesignImage, type Path } from "./design.js";
import { withFunctionPrefixes } from "./xlsx-formula.js";
import { columnName, columnNumber, LAST_COLUMN, LAST_ROW, parseRange, parseRef, relationships, relsOf, sheetFiles } from "./xlsx-parts.js";

/**
 * Excel templates designed as data: a JSON tree of sheets, each with its columns, rows,
 * cells and page setup, in the key names of exceljs and hucre (`font`, `fill`, `border`,
 * `alignment`, `numFmt`, `pageSetup`, `headerFooter`). Spooldoc checks the tree against an
 * allow-list and writes it with hucre. Nothing in the tree runs: an unknown key or value
 * is refused with its path. This is how the agent writes an Excel template.
 */

type SheetImage = NonNullable<WriteSheet["images"]>[number];

/** Most nodes (objects and list items) in one design, so a runaway tree is refused before it is checked. */
const MAX_NODES = 20_000;
/** Most cells one sheet of a design may give. */
const MAX_CELLS = 10_000;
/** The longest text of a cell, as Excel takes it. */
const MAX_TEXT = 32_767;
/** The longest formula, as Excel takes it. */
const MAX_FORMULA = 8192;
/** The last column a column setting may reach: AMJ. */
const MAX_COLUMN = 1024;
/** Widest picture, in pixels, when the design gives no size. */
const MAX_IMAGE_WIDTH = 600;
/** Most problems one error lists. */
const MAX_PROBLEMS = 30;

/** The font of every cell unless a style says otherwise, when the design gives none. */
const DEFAULT_FONT = { name: "Arial", size: 10 };
/** The page margins in inches, when the design gives none: as the starter's. */
const DEFAULT_MARGINS = { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 };
/** The number format of a `{ date }` cell without one. */
const DEFAULT_DATE_FORMAT = "yyyy-mm-dd";

const CELL = /^([A-Za-z]{1,3})([1-9]\d{0,6})$/;

/** A cell such as `B5`, in capitals. */
const cellRef = z
  .string()
  .regex(CELL, 'Use a cell such as "B5"')
  .transform((ref) => ref.toUpperCase())
  .refine((ref) => {
    const at = parseRef(ref);
    return at !== undefined && at.row <= LAST_ROW && at.column <= LAST_COLUMN;
  }, "The cell is outside the sheet");

/** A range such as `A2:F9`, `A:F` or `2:9`, as the file writes it: `A2:F9`, `A1:F1048576`, `A2:XFD9`. */
function rangeText(range: string): string | undefined {
  if (!/^\$?[A-Za-z]{0,3}\$?\d{0,7}(?::\$?[A-Za-z]{0,3}\$?\d{0,7})?$/.test(range)) return undefined;
  const at = parseRange(range);
  if (!at || at.bottom > LAST_ROW || at.right > LAST_COLUMN) return undefined;
  const from = `${columnName(at.left)}${at.top}`;
  const to = `${columnName(at.right)}${at.bottom}`;
  return from === to ? from : `${from}:${to}`;
}

const range = z
  .string()
  .min(1)
  .max(40)
  .transform((value, ctx) => {
    const text = rangeText(value.toUpperCase());
    if (text === undefined) ctx.addIssue({ code: "custom", message: 'Use a range such as "A2:F9", whole columns such as "A:F", or a cell' });
    return text ?? "";
  });

/** One or more ranges separated by spaces, as conditional formatting and data validation take them. */
const ranges = z
  .string()
  .min(1)
  .max(500)
  .transform((value, ctx) => {
    const parts = value.trim().split(/\s+/).map((part) => rangeText(part.toUpperCase()));
    if (parts.some((part) => part === undefined)) {
      ctx.addIssue({ code: "custom", message: 'Use ranges such as "A2:F9" or whole columns such as "F:F", separated by spaces' });
    }
    return parts.join(" ");
  });

/** A colour: six hex digits, with or without `#`, written as ARGB (`FF1F3A5F`), as Excel and LibreOffice read it. */
const color = z
  .string()
  .regex(/^#?[0-9A-Fa-f]{6}$/, 'Use six hex digits such as "1F3A5F"')
  .transform((value) => `FF${value.replace(/^#/, "").toUpperCase()}`);

const font = z.strictObject({
  name: z.string().min(1).max(31).optional(),
  /** Points. */
  size: z.number().min(1).max(409).optional(),
  color: color.optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.union([z.boolean(), z.enum(["single", "double", "singleAccounting", "doubleAccounting"])]).optional(),
  strike: z.boolean().optional(),
  vertAlign: z.enum(["superscript", "subscript"]).optional(),
});
type Font = z.output<typeof font>;

const FILL_PATTERNS = [
  "none",
  "solid",
  "darkDown",
  "darkGray",
  "darkGrid",
  "darkHorizontal",
  "darkTrellis",
  "darkUp",
  "darkVertical",
  "gray0625",
  "gray125",
  "lightDown",
  "lightGray",
  "lightGrid",
  "lightHorizontal",
  "lightTrellis",
  "lightUp",
  "lightVertical",
  "mediumGray",
] as const;

/** Only the keys of the fill's type. */
function onlyKeys(value: Record<string, unknown>, keys: readonly string[], what: string, ctx: z.RefinementCtx): void {
  for (const key of Object.keys(value)) {
    if (value[key] !== undefined && !keys.includes(key)) ctx.addIssue({ code: "custom", path: [key], message: `"${key}" is not used by ${what}. Use ${keys.map((k) => `"${k}"`).join(", ")}.` });
  }
}

const fill = z
  .strictObject({
    type: z.enum(["pattern", "gradient"]),
    pattern: z.enum(FILL_PATTERNS).optional(),
    fgColor: color.optional(),
    bgColor: color.optional(),
    /** Degrees, for a linear gradient. */
    degree: z.number().min(0).max(359).optional(),
    stops: z
      .array(z.strictObject({ position: z.number().min(0).max(1), color }))
      .min(2)
      .max(10)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "pattern") {
      onlyKeys(value, ["type", "pattern", "fgColor", "bgColor"], "a pattern fill", ctx);
      if (!value.pattern) ctx.addIssue({ code: "custom", path: ["pattern"], message: 'Give the pattern, such as "solid" with fgColor' });
    } else {
      onlyKeys(value, ["type", "degree", "stops"], "a gradient fill", ctx);
      if (!value.stops) ctx.addIssue({ code: "custom", path: ["stops"], message: "Give at least two stops, each with a position from 0 to 1 and a color" });
    }
  });

const borderSide = z.strictObject({
  style: z.enum(["thin", "medium", "thick", "dotted", "dashed", "double", "hair", "mediumDashed", "dashDot", "mediumDashDot", "dashDotDot", "mediumDashDotDot", "slantDashDot"]),
  color: color.optional(),
});

const border = z.strictObject({
  top: borderSide.optional(),
  right: borderSide.optional(),
  bottom: borderSide.optional(),
  left: borderSide.optional(),
  diagonal: borderSide.optional(),
  diagonalUp: z.boolean().optional(),
  diagonalDown: z.boolean().optional(),
});

const alignment = z.strictObject({
  horizontal: z.enum(["left", "center", "right", "fill", "justify", "centerContinuous", "distributed", "general"]).optional(),
  vertical: z.enum(["top", "center", "bottom", "justify", "distributed"]).optional(),
  wrapText: z.boolean().optional(),
  shrinkToFit: z.boolean().optional(),
  /** Indent levels, each about three characters. */
  indent: z.number().int().min(0).max(250).optional(),
  /** Degrees from 0 to 180, or 255 for letters stacked top to bottom. */
  textRotation: z
    .number()
    .int()
    .refine((n) => (n >= 0 && n <= 180) || n === 255, "Use 0 to 180 degrees, or 255 for stacked letters")
    .optional(),
});

const style = z.strictObject({
  /** An Excel number format such as `#,##0.00` or `dd.mm.yyyy`. */
  numFmt: z.string().min(1).max(255).optional(),
  font: font.optional(),
  fill: fill.optional(),
  border: border.optional(),
  alignment: alignment.optional(),
});
type Style = z.output<typeof style>;

const cell = z.strictObject({
  ref: cellRef,
  /** Text (tags allowed), a number, a boolean, `{ date }`, `{ richText }` or `{ formula, result }`; checked on its own. */
  value: z.unknown().optional(),
  style: style.optional(),
  /** A URL, or a place in the workbook such as `#'Order lines'!A1`. */
  hyperlink: z.string().min(1).max(2000).optional(),
  /** A note (a comment in the file). */
  note: z.string().min(1).max(2000).optional(),
});

const column = z.strictObject({
  /** A column such as `B`, or columns such as `B:D`. */
  ref: z.string().regex(/^[A-Za-z]{1,3}(:[A-Za-z]{1,3})?$/, 'Use a column such as "B", or columns such as "B:D"'),
  /** Characters of the default font. */
  width: z.number().min(0).max(255).optional(),
  hidden: z.boolean().optional(),
  outlineLevel: z.number().int().min(0).max(7).optional(),
  style: style.optional(),
});

const row = z.strictObject({
  /** 1-based. */
  row: z.number().int().min(1).max(LAST_ROW),
  /** Points. */
  height: z.number().min(0).max(409).optional(),
  hidden: z.boolean().optional(),
  outlineLevel: z.number().int().min(0).max(7).optional(),
});

const views = z.strictObject({
  /** Rows at the top and columns at the left that stay in view. */
  frozen: z.strictObject({ rows: z.number().int().min(0).max(1000).optional(), columns: z.number().int().min(0).max(100).optional() }).optional(),
  /** Percent. */
  zoom: z.number().int().min(10).max(400).optional(),
  showGridLines: z.boolean().optional(),
  rightToLeft: z.boolean().optional(),
});

const OPERATORS = ["between", "notBetween", "equal", "notEqual", "greaterThan", "lessThan", "greaterThanOrEqual", "lessThanOrEqual"] as const;
const formula = z
  .string()
  .min(1)
  .max(MAX_FORMULA)
  .transform((value) => withFunctionPrefixes(value.replace(/^=/, "")));

const cfvo = z.strictObject({
  type: z.enum(["min", "max", "num", "percent", "percentile"]),
  value: z.union([z.number().finite(), z.string().min(1).max(255)]).optional(),
});

const ICON_SETS = [
  "3Arrows",
  "3ArrowsGray",
  "3Flags",
  "3TrafficLights1",
  "3TrafficLights2",
  "3Signs",
  "3Symbols",
  "3Symbols2",
  "4Arrows",
  "4ArrowsGray",
  "4RedToBlack",
  "4Rating",
  "4TrafficLights",
  "5Arrows",
  "5ArrowsGray",
  "5Rating",
  "5Quarters",
] as const;

/** The keys each conditional formatting rule takes, besides `type`. */
const RULE_KEYS: Record<string, readonly string[]> = {
  cellIs: ["operator", "formulae", "style", "stopIfTrue"],
  expression: ["formulae", "style", "stopIfTrue"],
  colorScale: ["cfvo", "color"],
  dataBar: ["cfvo", "color"],
  iconSet: ["iconSet", "cfvo", "reverse", "showValue"],
  containsText: ["text", "style", "stopIfTrue"],
  beginsWith: ["text", "style", "stopIfTrue"],
  endsWith: ["text", "style", "stopIfTrue"],
  duplicateValues: ["style", "stopIfTrue"],
  top10: ["style", "stopIfTrue"],
  aboveAverage: ["style", "stopIfTrue"],
};

const rule = z
  .strictObject({
    type: z.enum(Object.keys(RULE_KEYS) as [string, ...string[]]),
    operator: z.enum(OPERATORS).optional(),
    formulae: z.array(formula).min(1).max(2).optional(),
    /** The look of the cells the rule applies to: font, fill, border and number format. */
    style: style.optional(),
    stopIfTrue: z.boolean().optional(),
    text: z.string().min(1).max(255).optional(),
    cfvo: z.array(cfvo).min(2).max(5).optional(),
    /** One colour for a data bar; one for each `cfvo` for a colour scale. */
    color: z.union([color, z.array(color).min(2).max(3)]).optional(),
    iconSet: z.enum(ICON_SETS).optional(),
    reverse: z.boolean().optional(),
    showValue: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const keys = RULE_KEYS[value.type]!;
    onlyKeys(value, ["type", ...keys], `a ${value.type} rule`, ctx);
    const need = (key: string, message: string) => {
      if ((value as Record<string, unknown>)[key] === undefined) ctx.addIssue({ code: "custom", path: [key], message });
    };
    if (keys.includes("style")) need("style", "Give the style the cells take, such as a fill or a font colour");
    switch (value.type) {
      case "cellIs": {
        need("operator", `Give the operator: ${OPERATORS.join(", ")}`);
        const two = value.operator === "between" || value.operator === "notBetween";
        if (value.formulae?.length !== (two ? 2 : 1)) ctx.addIssue({ code: "custom", path: ["formulae"], message: two ? "Give two formulae, the low and the high value" : "Give one formula, the value to compare with" });
        break;
      }
      case "expression":
        if (value.formulae?.length !== 1) ctx.addIssue({ code: "custom", path: ["formulae"], message: "Give one formula, true for the cells to format, written for the first cell of the range" });
        break;
      case "colorScale":
        if (!value.cfvo || value.cfvo.length > 3 || !Array.isArray(value.color) || value.color.length !== value.cfvo.length) {
          ctx.addIssue({ code: "custom", path: ["color"], message: "Give two or three cfvo, such as min and max, and as many colours" });
        }
        break;
      case "dataBar":
        if (value.cfvo?.length !== 2 || typeof value.color !== "string") ctx.addIssue({ code: "custom", path: ["color"], message: "Give two cfvo, such as min and max, and one colour" });
        break;
      case "iconSet": {
        need("iconSet", `Give the icon set: ${ICON_SETS.join(", ")}`);
        const icons = Number(value.iconSet?.[0] ?? 0);
        if (value.cfvo?.length !== icons || value.cfvo.some((c) => c.type === "max")) {
          ctx.addIssue({ code: "custom", path: ["cfvo"], message: `Give one cfvo for each of the ${icons || 3} icons, where each icon starts, such as percent 0, 33 and 67; none of type max` });
        }
        break;
      }
      case "containsText":
      case "beginsWith":
      case "endsWith":
        need("text", "Give the text to look for");
        break;
    }
  });

const conditionalFormatting = z.strictObject({ ref: ranges, rules: z.array(rule).min(1).max(20) });

const VALIDATION_TYPES = ["list", "whole", "decimal", "date", "textLength", "custom"] as const;

const dataValidation = z
  .strictObject({
    ref: ranges,
    type: z.enum(VALIDATION_TYPES),
    operator: z.enum(OPERATORS).optional(),
    /** A list as `"\"Open,Closed\""` or a range; the bounds; or, for custom, a formula true for valid values. */
    formulae: z.array(z.string().min(1).max(255).transform((value) => withFunctionPrefixes(value.replace(/^=/, "")))).min(1).max(2),
    allowBlank: z.boolean().optional(),
    showInputMessage: z.boolean().optional(),
    promptTitle: z.string().min(1).max(32).optional(),
    prompt: z.string().min(1).max(255).optional(),
    showErrorMessage: z.boolean().optional(),
    errorTitle: z.string().min(1).max(32).optional(),
    error: z.string().min(1).max(255).optional(),
    errorStyle: z.enum(["stop", "warning", "information"]).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "list" || value.type === "custom") {
      if (value.operator) ctx.addIssue({ code: "custom", path: ["operator"], message: `A ${value.type} validation takes no operator` });
      if (value.formulae.length !== 1) ctx.addIssue({ code: "custom", path: ["formulae"], message: "Give one formula" });
      return;
    }
    const two = (value.operator ?? "between") === "between" || value.operator === "notBetween";
    if (value.formulae.length !== (two ? 2 : 1)) ctx.addIssue({ code: "custom", path: ["formulae"], message: two ? "Give two formulae, the low and the high value" : "Give one formula" });
  });

const image = z
  .strictObject({
    /** The name of an uploaded PNG or JPEG asset. */
    asset: z.string().min(1).max(64),
    /** The cell of the picture's top-left corner; it keeps its size. */
    tl: cellRef.optional(),
    /** Pixels; give one and the other keeps the picture's proportions. */
    ext: z.strictObject({ width: z.number().int().min(1).max(4000).optional(), height: z.number().int().min(1).max(4000).optional() }).optional(),
    /** The cells the picture fills, such as `A1:C4`. */
    range: range.optional(),
    altText: z.string().max(200).optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.tl === undefined) === (value.range === undefined)) ctx.addIssue({ code: "custom", path: ["tl"], message: 'Give "tl" (and "ext") or "range", one of them' });
    if (value.ext && value.range !== undefined) ctx.addIssue({ code: "custom", path: ["ext"], message: 'A picture with "range" fills the range: give "ext" with "tl"' });
  });

const UNIT_INCHES: Record<string, number> = { mm: 1 / 25.4, cm: 1 / 2.54, in: 1, pt: 1 / 72 };
const UNIT = /^(\d+(?:\.\d+)?)(mm|cm|in|pt)$/;

/** A page margin: inches as a number, or a length with a unit such as `"15mm"`. */
const margin = z
  .union([z.number().finite(), z.string().regex(UNIT, 'Use inches as a number, or a length with a unit such as "15mm", "1.5cm", "0.5in" or "36pt"')])
  .transform((value) => {
    if (typeof value === "number") return value;
    const m = UNIT.exec(value)!;
    return Math.round(Number(m[1]) * UNIT_INCHES[m[2]!]! * 1000) / 1000;
  })
  .refine((inches) => inches >= 0 && inches <= 10, "Use 0 to 10 inches");

const PAPER = { A3: "a3", A4: "a4", A5: "a5", Letter: "letter", Legal: "legal" } as const;

const pageSetup = z
  .strictObject({
    /** `A4`, `A3`, `A5`, `Letter`, `Legal`, or Excel's paper size number. */
    paperSize: z.union([z.enum(Object.keys(PAPER) as [keyof typeof PAPER, ...(keyof typeof PAPER)[]]), z.number().int().min(1).max(118)]).optional(),
    orientation: z.enum(["portrait", "landscape"]).optional(),
    /** Pages wide; 0 for as many as needed. */
    fitToWidth: z.number().int().min(0).max(100).optional(),
    /** Pages tall; 0 for as many as needed. */
    fitToHeight: z.number().int().min(0).max(100).optional(),
    /** Percent, instead of fitting to pages. */
    scale: z.number().int().min(10).max(400).optional(),
    margins: z
      .strictObject({ top: margin.optional(), right: margin.optional(), bottom: margin.optional(), left: margin.optional(), header: margin.optional(), footer: margin.optional() })
      .optional(),
    horizontalCentered: z.boolean().optional(),
    verticalCentered: z.boolean().optional(),
    printGridLines: z.boolean().optional(),
    /** The cells to print, such as `A1:F50`. */
    printArea: range.optional(),
    /** Rows repeated at the top of each page, such as `1:1` or `4:5`. */
    printTitlesRow: z
      .string()
      .regex(/^\$?\d{1,7}(:\$?\d{1,7})?$/, 'Use rows such as "1:1" or "4:5"')
      .transform((value) => {
        const [a, b = a] = value.replace(/\$/g, "").split(":");
        return `$${a}:$${b}`;
      })
      .optional(),
    /** Columns repeated at the left of each page, such as `A:A`. */
    printTitlesColumn: z
      .string()
      .regex(/^\$?[A-Za-z]{1,3}(:\$?[A-Za-z]{1,3})?$/, 'Use columns such as "A:A" or "A:B"')
      .transform((value) => {
        const [a, b = a] = value.replace(/\$/g, "").toUpperCase().split(":");
        return `$${a}:$${b}`;
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scale !== undefined && (value.fitToWidth !== undefined || value.fitToHeight !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["scale"], message: "Give scale, or fitToWidth and fitToHeight, not both: fitting to pages sets the scale" });
    }
  });

const headerText = z.string().max(255, "Use at most 255 characters, codes included").optional();
const headerFooter = z.strictObject({
  oddHeader: headerText,
  oddFooter: headerText,
  evenHeader: headerText,
  evenFooter: headerText,
  firstHeader: headerText,
  firstFooter: headerText,
  differentOddEven: z.boolean().optional(),
  differentFirst: z.boolean().optional(),
});

const sheet = z.strictObject({
  name: z.string().min(1).max(31, "Use at most 31 characters"),
  tabColor: color.optional(),
  views: views.optional(),
  columns: z.array(column).max(500).optional(),
  rows: z.array(row).max(5000).optional(),
  cells: z.array(cell).max(MAX_CELLS, `Give at most ${MAX_CELLS} cells on a sheet`).optional(),
  merges: z.array(range).max(1000).optional(),
  /** The header row of a filter, such as `A1:F1`, or whole columns such as `A:F`. */
  autoFilter: range.optional(),
  conditionalFormatting: z.array(conditionalFormatting).max(100).optional(),
  dataValidations: z.array(dataValidation).max(100).optional(),
  images: z.array(image).max(20).optional(),
  pageSetup: pageSetup.optional(),
  headerFooter: headerFooter.optional(),
});
type SheetDesign = z.output<typeof sheet>;

const NAME = /^[A-Za-z_\\][A-Za-z0-9_.\\]{0,254}$/;

const workbook = z.strictObject({
  sheets: z.array(sheet).min(1, "Give at least one sheet").max(50),
  /** The font of every cell unless a style says otherwise. Arial 10 when not given. */
  defaultFont: z.strictObject({ name: z.string().min(1).max(31).optional(), size: z.number().min(1).max(409).optional(), color: color.optional() }).optional(),
  /** Named ranges, such as `{ "name": "Rates", "ref": "Rates!$A$2:$B$20" }`; `sheet` makes the name local to that sheet. */
  definedNames: z
    .array(
      z.strictObject({
        name: z.string().regex(NAME, "Use letters, digits, underscores and dots, starting with a letter or underscore"),
        ref: z.string().min(1).max(500),
        sheet: z.string().min(1).max(31).optional(),
      }),
    )
    .max(100)
    .optional(),
  /** The sheet that opens first, 0-based. */
  activeSheet: z.number().int().min(0).optional(),
});

/** A design as `buildXlsx` takes it, before it is checked. */
export type XlsxDesign = z.input<typeof workbook>;

/** The number of objects and list items in a tree, counted up to `limit + 1`. */
function countNodes(value: unknown, limit: number): number {
  let count = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0 && count <= limit) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;
    count++;
    stack.push(...(Array.isArray(node) ? node : Object.values(node)));
  }
  return count;
}

/** A `{ date }` value, `YYYY-MM-DD`, as an Excel date serial, or undefined when it is no real date. */
function dateSerial(text: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return undefined;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const date = new Date(ms);
  if (date.getUTCFullYear() !== Number(m[1]) || date.getUTCMonth() !== Number(m[2]) - 1 || date.getUTCDate() !== Number(m[3])) return undefined;
  const serial = ms / 86_400_000 + 25569;
  return serial >= 61 ? serial : undefined;
}

/** The styles combined: `over` wins key by key, with fonts, borders and alignments combined too and a fill replaced. */
function mergeStyle(base: Style | undefined, over: Style | undefined): Style | undefined {
  if (!base) return over;
  if (!over) return base;
  return {
    ...base,
    ...over,
    ...(base.font || over.font ? { font: { ...base.font, ...over.font } } : {}),
    ...(base.border || over.border ? { border: { ...base.border, ...over.border } } : {}),
    ...(base.alignment || over.alignment ? { alignment: { ...base.alignment, ...over.alignment } } : {}),
  };
}

type HucreFont = NonNullable<CellStyle["font"]>;

/** A font as hucre takes it, with the default font under it so it keeps its name and size. */
function toFont(value: Font, base: Font | undefined): HucreFont {
  const full = { ...base, ...value };
  return {
    ...(full.name !== undefined ? { name: full.name } : {}),
    ...(full.size !== undefined ? { size: full.size } : {}),
    ...(full.color !== undefined ? { color: { rgb: full.color } } : {}),
    ...(full.bold !== undefined ? { bold: full.bold } : {}),
    ...(full.italic !== undefined ? { italic: full.italic } : {}),
    ...(full.underline !== undefined ? { underline: full.underline } : {}),
    ...(full.strike !== undefined ? { strikethrough: full.strike } : {}),
    ...(full.vertAlign !== undefined ? { vertAlign: full.vertAlign } : {}),
  };
}

/** A style as hucre takes it. A conditional format's style (`base` undefined) changes only what it gives. */
function toStyle(value: Style, base: Font | undefined): CellStyle {
  const out: CellStyle = {};
  if (value.numFmt !== undefined) out.numFmt = value.numFmt;
  if (value.font) out.font = toFont(value.font, base);
  if (value.fill) {
    out.fill =
      value.fill.type === "pattern"
        ? {
            type: "pattern",
            pattern: value.fill.pattern!,
            ...(value.fill.fgColor ? { fgColor: { rgb: value.fill.fgColor } } : {}),
            ...(value.fill.bgColor ? { bgColor: { rgb: value.fill.bgColor } } : {}),
          }
        : { type: "gradient", ...(value.fill.degree !== undefined ? { degree: value.fill.degree } : {}), stops: value.fill.stops!.map((s) => ({ position: s.position, color: { rgb: s.color } })) };
  }
  if (value.border) {
    const { diagonalUp, diagonalDown, ...sides } = value.border;
    out.border = {
      ...Object.fromEntries(Object.entries(sides).flatMap(([side, b]) => (b ? [[side, { style: b.style, ...(b.color ? { color: { rgb: b.color } } : {}) }]] : []))),
      ...(diagonalUp !== undefined ? { diagonalUp } : {}),
      ...(diagonalDown !== undefined ? { diagonalDown } : {}),
    };
  }
  if (value.alignment) out.alignment = { ...value.alignment };
  return out;
}

/** A sheet name as a reference needs it: `Lines`, or `'Order lines'` with quotes. */
const quoted = (name: string): string => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);

/** The sheet and range of a reference such as `'Order lines'!$A$2:$F$9`, or undefined. */
function splitReference(ref: string): { sheet: string; range: string } | undefined {
  const m = /^(?:'((?:[^']|'')+)'|([^'!:[\]*?/\\]+))!(.+)$/.exec(ref);
  if (!m) return undefined;
  return { sheet: (m[1] ?? m[2]!).replace(/''/g, "'"), range: m[3]! };
}

/** A picture placed by its top-left cell, to be anchored to that cell alone with its size. */
interface OneCellPicture {
  sheet: number;
  /** Its place among the sheet's pictures. */
  index: number;
}

/** The name Excel gives a sheet's filter range. */
const FILTER_NAME = "_xlnm._FilterDatabase";

/** A range with each cell absolute: `A1:F50` as `$A$1:$F$50`. */
const absolute = (range: string): string => range.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2");

/**
 * The names Excel keeps for a sheet's print area, print titles and filter, local to the
 * sheet. hucre writes the first two without the quotes a sheet name such as `Order lines`
 * needs, and the filter's not at all. Excel writes `_xlnm._FilterDatabase` with every
 * filter, as LibreOffice and the other writers do; `finish` hides it, as Excel does.
 */
function builtInNames(design: SheetDesign): { name: string; range: string; scope: string }[] {
  const sheet = quoted(design.name);
  const page = design.pageSetup;
  const titles = [page?.printTitlesRow, page?.printTitlesColumn].filter((t) => t !== undefined).map((t) => `${sheet}!${t}`);
  return [
    ...(page?.printArea !== undefined ? [{ name: "_xlnm.Print_Area", range: `${sheet}!${absolute(page.printArea)}`, scope: design.name }] : []),
    ...(titles.length > 0 ? [{ name: "_xlnm.Print_Titles", range: titles.join(","), scope: design.name }] : []),
    ...(design.autoFilter !== undefined ? [{ name: FILTER_NAME, range: `${sheet}!${absolute(design.autoFilter)}`, scope: design.name }] : []),
  ];
}

/** Checks a design and turns it into hucre's options, collecting every problem with its path. */
class Builder {
  readonly problems: string[] = [];
  readonly oneCell: OneCellPicture[] = [];
  private names = new Set<string>();

  constructor(private readonly images: (name: string) => DesignImage | undefined) {}

  problem(path: Path, message: string): void {
    if (this.problems.length < MAX_PROBLEMS) this.problems.push(`${pathText(path)}: ${message}`);
  }

  workbook(design: z.output<typeof workbook>): WriteOptions {
    const defaultFont: Font = { ...DEFAULT_FONT, ...design.defaultFont };
    const used = new Map<string, number>();
    design.sheets.forEach((s, i) => {
      const at = ["sheets", i, "name"];
      if (/[[\]:*?/\\]/.test(s.name)) this.problem(at, "A sheet name cannot hold [ ] : * ? / or \\.");
      else if (/^'|'$/.test(s.name)) this.problem(at, "A sheet name cannot start or end with an apostrophe.");
      else if (s.name.toLowerCase() === "history") this.problem(at, '"History" is a name Excel keeps for itself. Use another.');
      const before = used.get(s.name.toLowerCase());
      if (before !== undefined) this.problem(at, `sheets[${before}] has this name already. Give each sheet its own name.`);
      used.set(s.name.toLowerCase(), i);
    });
    this.names = new Set(design.sheets.map((s) => s.name));
    const sheets = design.sheets.map((s, i) => this.sheet(s, i, defaultFont));
    if (design.activeSheet !== undefined && design.activeSheet >= design.sheets.length) {
      this.problem(["activeSheet"], `There are ${design.sheets.length} sheets: use 0 to ${design.sheets.length - 1}.`);
    }
    const namedRanges = (design.definedNames ?? []).map((name, i) => {
      const at = ["definedNames", i];
      if (CELL.test(name.name) || /^R\d*C\d*$/i.test(name.name)) this.problem([...at, "name"], "A name cannot look like a cell. Use a word such as Rates.");
      if (/^_xlnm\./i.test(name.name)) this.problem([...at, "name"], "Set print areas and print titles in the sheet's pageSetup.");
      const split = splitReference(name.ref);
      if (!split || !this.names.has(split.sheet) || rangeText(split.range.toUpperCase()) === undefined) {
        this.problem([...at, "ref"], `Use a sheet and range such as ${quoted(design.sheets[0]!.name)}!$A$2:$B$20, with a sheet of this workbook.`);
      }
      if (name.sheet !== undefined && !this.names.has(name.sheet)) this.problem([...at, "sheet"], `There is no sheet "${name.sheet}".`);
      return { name: name.name, range: name.ref, ...(name.sheet !== undefined ? { scope: name.sheet } : {}) };
    });
    const seen = new Set<string>();
    namedRanges.forEach((n, i) => {
      const key = `${n.scope ?? ""}\n${n.name.toLowerCase()}`;
      if (seen.has(key)) this.problem(["definedNames", i, "name"], "The name is given twice.");
      seen.add(key);
    });
    namedRanges.push(...design.sheets.flatMap(builtInNames));
    return {
      sheets,
      defaultFont: toFont(defaultFont, undefined),
      ...(namedRanges.length > 0 ? { namedRanges } : {}),
      ...(design.activeSheet !== undefined ? { activeSheet: design.activeSheet } : {}),
    };
  }

  sheet(design: SheetDesign, index: number, defaultFont: Font): WriteSheet {
    const path: Path = ["sheets", index];
    const out: WriteSheet = { name: design.name };

    // Columns: hucre takes one entry per column, from A.
    const columns: ColumnDef[] = [];
    const columnStyles = new Map<number, Style>();
    (design.columns ?? []).forEach((c, i) => {
      const [from = "", to = from] = c.ref.toUpperCase().split(":");
      const left = Math.min(columnNumber(from), columnNumber(to));
      const right = Math.max(columnNumber(from), columnNumber(to));
      if (right > MAX_COLUMN) {
        this.problem([...path, "columns", i, "ref"], `Columns go up to ${columnName(MAX_COLUMN)}.`);
        return;
      }
      for (let n = left; n <= right; n++) {
        if (columns[n - 1]) {
          this.problem([...path, "columns", i, "ref"], `Column ${columnName(n)} is in an earlier entry too. Give each column once.`);
          return;
        }
        columns[n - 1] = {
          ...(c.width !== undefined ? { width: c.width } : {}),
          ...(c.hidden ? { hidden: true } : {}),
          ...(c.outlineLevel ? { outlineLevel: c.outlineLevel } : {}),
          ...(c.style ? { style: toStyle(c.style, defaultFont) } : {}),
        };
        if (c.style) columnStyles.set(n, c.style);
      }
    });
    if (columns.length > 0) out.columns = Array.from(columns, (c) => c ?? {});

    if (design.rows) {
      const rowDefs = new Map<number, NonNullable<WriteSheet["rowDefs"]> extends Map<number, infer R> ? R : never>();
      design.rows.forEach((r, i) => {
        if (rowDefs.has(r.row - 1)) this.problem([...path, "rows", i, "row"], `Row ${r.row} is in an earlier entry too. Give each row once.`);
        rowDefs.set(r.row - 1, { ...(r.height !== undefined ? { height: r.height } : {}), ...(r.hidden ? { hidden: true } : {}), ...(r.outlineLevel ? { outlineLevel: r.outlineLevel } : {}) });
      });
      out.rowDefs = rowDefs;
    }

    const cells = new Map<string, Partial<Cell>>();
    const seen = new Map<string, number>();
    (design.cells ?? []).forEach((c, i) => {
      const at: Path = [...path, "cells", i];
      const ref = parseRef(c.ref)!;
      const before = seen.get(c.ref);
      if (before !== undefined) this.problem([...at, "ref"], `${c.ref} is given in cells[${before}] too. Give each cell once.`);
      seen.set(c.ref, i);
      const built = this.cell(c, at, mergeStyle(columnStyles.get(ref.column), c.style), defaultFont);
      if (built) cells.set(`${ref.row - 1},${ref.column - 1}`, built);
    });
    if (cells.size > 0) out.cells = cells;

    const merges = design.merges ?? [];
    const boxes = merges.map((m) => parseRange(m)!);
    merges.forEach((m, i) => {
      const box = boxes[i]!;
      if (box.top === box.bottom && box.left === box.right) this.problem([...path, "merges", i], "A merge needs at least two cells.");
      const overlap = boxes.findIndex((other, j) => j < i && other.left <= box.right && box.left <= other.right && other.top <= box.bottom && box.top <= other.bottom);
      if (overlap !== -1) this.problem([...path, "merges", i], `${m} overlaps merges[${overlap}] (${merges[overlap]}). Merged ranges cannot overlap.`);
    });
    if (merges.length > 0) out.merges = merges;

    if (design.autoFilter) out.autoFilter = { range: design.autoFilter };

    let priority = 0;
    const rules: ConditionalRule[] = [];
    (design.conditionalFormatting ?? []).forEach((cf) => {
      const first = cf.ref.split(/[: ]/)[0]!;
      for (const r of cf.rules) rules.push(this.rule(r, cf.ref, first, ++priority));
    });
    if (rules.length > 0) out.conditionalRules = rules;

    const validations: DataValidation[] = (design.dataValidations ?? []).map((dv) => ({
      type: dv.type,
      range: dv.ref,
      ...(dv.type !== "list" && dv.type !== "custom" ? { operator: dv.operator ?? "between" } : {}),
      formula1: dv.formulae[0]!,
      ...(dv.formulae[1] !== undefined ? { formula2: dv.formulae[1] } : {}),
      ...(dv.allowBlank !== undefined ? { allowBlank: dv.allowBlank } : {}),
      // A prompt or an error message shows unless the design says not.
      ...(dv.showInputMessage !== undefined || dv.prompt !== undefined ? { showInputMessage: dv.showInputMessage ?? true } : {}),
      ...(dv.promptTitle !== undefined ? { inputTitle: dv.promptTitle } : {}),
      ...(dv.prompt !== undefined ? { inputMessage: dv.prompt } : {}),
      ...(dv.showErrorMessage !== undefined || dv.error !== undefined ? { showErrorMessage: dv.showErrorMessage ?? true } : {}),
      ...(dv.errorTitle !== undefined ? { errorTitle: dv.errorTitle } : {}),
      ...(dv.error !== undefined ? { errorMessage: dv.error } : {}),
      ...(dv.errorStyle !== undefined ? { errorStyle: dv.errorStyle } : {}),
    }));
    if (validations.length > 0) out.dataValidations = validations;

    const images = (design.images ?? []).flatMap((img, i): SheetImage[] => {
      const at: Path = [...path, "images", i];
      const asset = this.images(img.asset);
      if (!asset) {
        this.problem([...at, "asset"], `There is no PNG or JPEG asset "${img.asset}". Use one of the uploaded image assets.`);
        return [];
      }
      const data = { data: asset.data, type: asset.type === "jpg" ? ("jpeg" as const) : ("png" as const), altText: img.altText ?? img.asset, title: img.asset };
      if (img.range !== undefined) {
        const box = parseRange(img.range)!;
        // `to` is the corner after the range: the top-left of the cell past its bottom-right.
        return [{ ...data, anchor: { from: { row: box.top - 1, col: box.left - 1 }, to: { row: box.bottom, col: box.right } } }];
      }
      const tl = parseRef(img.tl!)!;
      let width = img.ext?.width;
      let height = img.ext?.height;
      if (width === undefined && height === undefined) {
        width = Math.min(asset.width, MAX_IMAGE_WIDTH);
        height = Math.round((asset.height * width) / asset.width);
      } else if (width === undefined) width = Math.round((asset.width * height!) / asset.height);
      else if (height === undefined) height = Math.round((asset.height * width) / asset.width);
      this.oneCell.push({ sheet: index, index: i });
      return [{ ...data, anchor: { from: { row: tl.row - 1, col: tl.column - 1 } }, width: Math.max(1, width), height: Math.max(1, height!) }];
    });
    if (images.length > 0) out.images = images;

    out.pageSetup = this.pageSetup(design.pageSetup);
    if (design.headerFooter) out.headerFooter = Object.fromEntries(Object.entries(design.headerFooter).filter(([, v]) => v !== undefined));

    const view: NonNullable<WriteSheet["view"]> = {};
    if (design.tabColor) view.tabColor = { rgb: design.tabColor };
    if (design.views?.zoom !== undefined) view.zoomScale = design.views.zoom;
    if (design.views?.showGridLines !== undefined) view.showGridLines = design.views.showGridLines;
    if (design.views?.rightToLeft) view.rightToLeft = true;
    if (Object.keys(view).length > 0) out.view = view;
    const frozen = design.views?.frozen;
    if (frozen && ((frozen.rows ?? 0) > 0 || (frozen.columns ?? 0) > 0)) {
      out.freezePane = { ...(frozen.rows ? { rows: frozen.rows } : {}), ...(frozen.columns ? { columns: frozen.columns } : {}) };
    }
    return out;
  }

  cell(design: z.output<typeof cell>, path: Path, style: Style | undefined, defaultFont: Font): Partial<Cell> | undefined {
    const out: Partial<Cell> = {};
    let cellStyle = style;
    const value = design.value;
    if (typeof value === "string") {
      if (value.length > MAX_TEXT) this.problem([...path, "value"], `Use at most ${MAX_TEXT} characters.`);
      out.value = value;
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) this.problem([...path, "value"], "Use a finite number.");
      out.value = value;
    } else if (typeof value === "boolean") {
      out.value = value;
    } else if (value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value)) {
      const keys = Object.keys(value);
      const at: Path = [...path, "value"];
      if (keys.includes("date")) {
        const parsed = z.strictObject({ date: z.string() }).safeParse(value);
        const serial = parsed.success ? dateSerial(parsed.data.date) : undefined;
        if (serial === undefined) this.problem(at, 'Give a date as { "date": "2026-10-15" }, from 1900-03-01 on.');
        out.value = serial ?? 0;
        if (!cellStyle?.numFmt) cellStyle = { ...cellStyle, numFmt: DEFAULT_DATE_FORMAT };
      } else if (keys.includes("richText")) {
        const parsed = z
          .strictObject({ richText: z.array(z.strictObject({ text: z.string().max(MAX_TEXT), font: font.optional() })).min(1).max(100) })
          .refine((v) => v.richText.reduce((n, run) => n + run.text.length, 0) <= MAX_TEXT, `Use at most ${MAX_TEXT} characters in all`)
          .safeParse(value);
        if (!parsed.success) for (const issue of parsed.error.issues) this.problem([...at, ...(issue.path as Path)], issueMessage(issue));
        else if (parsed.data.richText.some((run) => run.text.includes(":formatN"))) {
          this.problem(at, "Rich text is written as an inline string, so a :formatN tag in it stays text and SUM gives 0. Give the tag as a plain text value.");
        } else out.richText = parsed.data.richText.map((run) => ({ text: run.text, font: toFont(run.font ?? {}, defaultFont) }));
      } else if (keys.includes("formula")) {
        const parsed = z.strictObject({ formula, result: z.union([z.string().max(MAX_TEXT), z.number().finite(), z.boolean()]).optional() }).safeParse(value);
        if (!parsed.success) for (const issue of parsed.error.issues) this.problem([...at, ...(issue.path as Path)], issueMessage(issue));
        else {
          out.formula = parsed.data.formula;
          if (parsed.data.result !== undefined) out.formulaResult = parsed.data.result;
        }
      } else {
        this.problem(at, 'Give text, a number, a boolean, { "date": "2026-10-15" }, { "richText": [...] } or { "formula": "SUM(B2:B9)" }.');
      }
    } else if (value !== undefined) {
      this.problem([...path, "value"], 'Give text, a number, a boolean, { "date": "2026-10-15" }, { "richText": [...] } or { "formula": "SUM(B2:B9)" }.');
    }
    if (cellStyle) out.style = toStyle(cellStyle, defaultFont);
    if (design.hyperlink !== undefined) {
      const link = design.hyperlink;
      if (link.startsWith("#")) {
        const split = splitReference(link.slice(1));
        if (!split || !this.names.has(split.sheet) || rangeText(split.range.replace(/\$/g, "").toUpperCase()) === undefined) {
          this.problem([...path, "hyperlink"], "Use a place in the workbook such as #'Order lines'!A1, with a sheet of this workbook.");
        }
        out.hyperlink = { target: "", location: link.slice(1) };
      } else if (/^(https?:\/\/|mailto:)\S+$/.test(link)) {
        out.hyperlink = { target: link };
      } else {
        this.problem([...path, "hyperlink"], "Use a URL that starts with https://, http:// or mailto:, or a place such as #Lines!A1.");
      }
      // A link with no text shows its address.
      if (out.value === undefined && out.formula === undefined && out.richText === undefined) out.value = link;
    }
    if (design.note !== undefined) out.comment = { text: design.note };
    if (out.value === undefined && out.formula === undefined && out.richText === undefined) out.value = null;
    return out;
  }

  rule(r: z.output<typeof rule>, ref: string, first: string, priority: number): ConditionalRule {
    const out: ConditionalRule = { type: r.type as ConditionalRule["type"], priority, range: ref };
    if (r.style) out.style = toStyle(r.style, undefined);
    if (r.stopIfTrue) out.stopIfTrue = true;
    switch (r.type) {
      case "cellIs":
        out.operator = r.operator!;
        out.formula = r.formulae!;
        break;
      case "expression":
        out.formula = r.formulae![0]!;
        break;
      case "colorScale":
        out.colorScale = { cfvo: r.cfvo!.map((c) => ({ type: c.type, ...(c.value !== undefined ? { value: String(c.value) } : {}) })), colors: r.color as string[] };
        break;
      case "dataBar":
        out.dataBar = { cfvo: r.cfvo!.map((c) => ({ type: c.type, ...(c.value !== undefined ? { value: String(c.value) } : {}) })), color: r.color as string };
        break;
      case "iconSet":
        out.iconSet = {
          iconSet: r.iconSet!,
          cfvo: r.cfvo!.map((c) => ({ type: c.type as "min" | "num" | "percent" | "percentile", ...(c.value !== undefined ? { value: String(c.value) } : {}) })),
          ...(r.reverse ? { reverse: true } : {}),
          ...(r.showValue === false ? { showValue: false } : {}),
        };
        break;
      case "containsText":
      case "beginsWith":
      case "endsWith": {
        // Excel reads the formula, written for the range's first cell, not the text.
        const text = `"${r.text!.replace(/"/g, '""')}"`;
        out.text = r.text!;
        out.operator = r.type as unknown as ConditionalRule["operator"];
        out.formula =
          r.type === "containsText" ? `NOT(ISERROR(SEARCH(${text},${first})))` : r.type === "beginsWith" ? `LEFT(${first},LEN(${text}))=${text}` : `RIGHT(${first},LEN(${text}))=${text}`;
        break;
      }
    }
    return out;
  }

  /**
   * The page setup, with A4 and fit to one page wide, any number of pages tall, unless the
   * design says otherwise: without one, LibreOffice prints US Letter and cuts the columns.
   */
  pageSetup(design: z.output<typeof pageSetup> | undefined): NonNullable<WriteSheet["pageSetup"]> {
    const d = design ?? {};
    const fit = d.scale === undefined;
    return {
      paperSize: typeof d.paperSize === "string" ? PAPER[d.paperSize] : (d.paperSize ?? "a4"),
      orientation: d.orientation ?? "portrait",
      ...(fit ? { fitToPage: true, fitToWidth: d.fitToWidth ?? 1, fitToHeight: d.fitToHeight ?? 0 } : { scale: d.scale }),
      margins: { ...DEFAULT_MARGINS, ...d.margins },
      ...(d.horizontalCentered ? { horizontalCentered: true } : {}),
      ...(d.verticalCentered ? { verticalCentered: true } : {}),
      ...(d.printGridLines ? { showGridLines: true } : {}),
    };
  }
}

/**
 * Puts into the file hucre wrote what hucre cannot write:
 *
 * - The pictures placed by their top-left cell are anchored to that cell alone, with their
 *   size (`oneCellAnchor`). hucre writes every picture between two cells, which stretches
 *   it over the cells when the design gives no end.
 * - A filter's `_xlnm._FilterDatabase` is hidden, as Excel writes it. hucre writes no
 *   hidden names.
 */
function finish(bytes: Uint8Array, pictures: OneCellPicture[], filters: boolean): Uint8Array {
  if (pictures.length === 0 && !filters) return bytes;
  const files = unzipSync(bytes);
  const text = (name: string): string => (files[name] ? strFromU8(files[name]) : "");
  if (filters) {
    const workbook = text("xl/workbook.xml");
    const hidden = workbook.replace(/<definedName name="_xlnm\._FilterDatabase"(?![^>]*\bhidden=)/g, '$& hidden="1"');
    if (hidden === workbook) throw new Error(`hucre wrote no ${FILTER_NAME} name for the filters.`);
    files["xl/workbook.xml"] = strToU8(hidden);
  }
  const sheets = sheetFiles(text("xl/workbook.xml"), text("xl/_rels/workbook.xml.rels"));
  const bySheet = new Map<number, Set<number>>();
  for (const p of pictures) bySheet.set(p.sheet, (bySheet.get(p.sheet) ?? new Set()).add(p.index));
  for (const [index, which] of bySheet) {
    const file = sheets[index]?.file;
    const drawing = file ? relationships(text(relsOf(file)), file).find((r) => r.type === "drawing")?.target : undefined;
    if (!drawing || !files[drawing]) throw new Error(`hucre wrote no drawing for the pictures of sheet ${index + 1}.`);
    let n = -1;
    const xml = text(drawing).replace(/<xdr:twoCellAnchor\b[^>]*>([\s\S]*?)<\/xdr:twoCellAnchor>/g, (whole, inner: string) => {
      n++;
      if (!which.has(n)) return whole;
      const from = /<xdr:from>[\s\S]*?<\/xdr:from>/.exec(inner)?.[0];
      const pic = /<xdr:pic>[\s\S]*?<\/xdr:pic>/.exec(inner)?.[0];
      const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(inner);
      if (!from || !pic || !ext) return whole;
      return `<xdr:oneCellAnchor>${from}<xdr:ext cx="${ext[1]}" cy="${ext[2]}"/>${pic}<xdr:clientData/></xdr:oneCellAnchor>`;
    });
    files[drawing] = strToU8(xml);
  }
  return zipSync(files, { level: 6 });
}

/**
 * Builds an Excel template from a design: a JSON tree in the key names of exceljs and
 * hucre. The workbook has `sheets` (1 to 50), and optionally `defaultFont` (Arial 10
 * when not given; every style's font is written on top of it), `definedNames` and
 * `activeSheet`. A sheet has `name`, and optionally `tabColor`, `views` (`frozen`,
 * `zoom`, `showGridLines`, `rightToLeft`), `columns` (`ref` such as `B` or `B:D`, `width`
 * in characters, `hidden`, `outlineLevel`, `style`), `rows` (`row`, `height` in points,
 * `hidden`, `outlineLevel`), `cells`, `merges`, `autoFilter`, `conditionalFormatting`,
 * `dataValidations`, `images`, `pageSetup` and `headerFooter`.
 *
 * A cell has `ref` such as `B5`, and optionally `value` (text, which may hold tags, a
 * number, a boolean, `{ date: "2026-10-15" }` written as a date serial, `{ richText }` or
 * `{ formula, result }`), `style` (`numFmt`, `font`, `fill`, `border`, `alignment`; a
 * column's style goes under it), `hyperlink` and `note`. Colours are six hex digits.
 * Formulas take no `=`; newer functions such as XLOOKUP get the `_xlfn.` prefix they
 * need. A picture is `{ asset, tl, ext }`, anchored to its top-left cell with its size
 * in pixels, or `{ asset, range }`, filling the range.
 *
 * Every sheet prints on A4, portrait, one page wide and as many pages tall as needed,
 * with the starter's margins, unless its `pageSetup` says otherwise: without a page
 * setup, LibreOffice prints US Letter and cuts the columns. `scale` turns fitting off.
 * Margins are inches, or a length with a unit such as `"15mm"`.
 *
 * A filter gets the hidden `_xlnm._FilterDatabase` name Excel writes with one.
 *
 * Tables, charts, sparklines, protection and macros are not allowed: tables and charts
 * do not grow over the rows Carbone adds.
 *
 * @param design - The tree, as parsed from JSON
 * @param images - The PNG and JPEG assets `images` may place, by name
 * @returns The `.xlsx` file
 * @throws DesignError listing every problem with its path (at most 30), when the tree has keys or values that are not allowed
 */
export async function buildXlsx(design: unknown, images: (name: string) => DesignImage | undefined = () => undefined): Promise<Uint8Array> {
  if (countNodes(design, MAX_NODES) > MAX_NODES) throw new DesignError([`(the document): The design has more than ${MAX_NODES} nodes. Make it smaller.`]);
  const builder = new Builder(images);
  const parsed = workbook.safeParse(design);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) builder.problem(issue.path as Path, issueMessage(issue));
    throw new DesignError(builder.problems);
  }
  const options = builder.workbook(parsed.data);
  if (builder.problems.length > 0) throw new DesignError(builder.problems);
  return finish(await writeXlsx(options), builder.oneCell, parsed.data.sheets.some((sheet) => sheet.autoFilter !== undefined));
}
