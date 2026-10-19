import {
  Document,
  Footer,
  Header,
  ImageRun,
  ImportedXmlComponent,
  Packer,
  Paragraph,
  Tab,
  Table,
  TableCell,
  TableRow,
  TextRun,
  type IParagraphOptions,
  type IRunOptions,
  type ISectionOptions,
  type ITableCellOptions,
  type ITableOptions,
} from "docx";
import { z } from "zod";

/**
 * Word templates designed as data: a JSON tree that mirrors the `docx` library's API
 * (`{ "type": "Paragraph", "children": [{ "type": "TextRun", "text": "..." }] }`), built
 * into a `.docx` with an allow-list of the library's constructors. Nothing in the tree
 * runs: an unknown node, key or value is refused with its path. This is how the AI
 * assistant writes a Word template.
 */

/** An image a design can place by name: an uploaded PNG or JPEG asset. */
export interface DesignImage {
  data: Uint8Array;
  type: "png" | "jpg";
  /** Size in pixels. */
  width: number;
  height: number;
}

/** Why a design could not be built: each problem with the path of the node or key it is about. */
export class DesignError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("\n"));
    this.name = "DesignError";
  }
}

/** Most nodes in one design, so a runaway tree is refused before it is built. */
const MAX_NODES = 20_000;
/** How deep tables may sit in table cells. */
const MAX_TABLE_DEPTH = 3;
/** Widest image, in pixels, when the design gives no size: about the text width of an A4 page. */
const MAX_IMAGE_WIDTH = 680;

const UNIT_TWIPS: Record<string, number> = { mm: 1440 / 25.4, cm: 1440 / 2.54, in: 1440, pt: 20, pc: 240, pi: 240 };
const UNIT = /^(-?\d+(?:\.\d+)?)(mm|cm|in|pt|pc|pi)$/;

/** A length: twips (1/20 pt, 1440 an inch) as a number, or a string with a unit such as `"15mm"` or `"10pt"`. */
const measure = z
  .union([z.number().finite(), z.string().regex(UNIT, 'Use twips as a number, or a length with a unit such as "15mm", "1.5cm", "1in" or "10pt"')])
  .transform((value) => (typeof value === "number" ? Math.round(value) : Math.round(Number(UNIT.exec(value)![1]) * UNIT_TWIPS[UNIT.exec(value)![2]!]!)))
  .refine((twips) => Math.abs(twips) <= 31_680, "Use at most 22 inches (31680 twips)");

/** A font size: half-points as a number (24 is 12 pt), or points with a unit such as `"10.5pt"`. */
const fontSize = z
  .union([z.number().finite(), z.string().regex(/^\d+(?:\.\d+)?pt$/, 'Use half-points as a number (24 is 12 pt), or points such as "10.5pt"')])
  .transform((value) => (typeof value === "number" ? Math.round(value) : Math.round(Number(value.slice(0, -2)) * 2)))
  .refine((half) => half >= 2 && half <= 1638, "Use a size from 1 pt to 819 pt");

/** A colour: six hex digits, with or without `#`, or `auto`. */
const color = z
  .string()
  .regex(/^(#?[0-9A-Fa-f]{6}|auto)$/, 'Use six hex digits such as "1F3A5F", or "auto"')
  .transform((value) => value.replace(/^#/, "").toUpperCase());

const border = z.strictObject({
  style: z.enum(["single", "double", "dotted", "dashed", "thick", "triple", "dotDash", "dotDotDash", "dashSmallGap", "thinThickSmallGap", "thickThinSmallGap", "none", "nil"]),
  /** Eighths of a point. */
  size: z.number().int().min(0).max(96).optional(),
  color: color.optional(),
  /** Points between the border and the text. */
  space: z.number().int().min(0).max(31).optional(),
});

const shading = z
  .strictObject({
    fill: color,
    color: color.optional(),
    type: z.enum(["clear", "solid", "pct5", "pct10", "pct12", "pct15", "pct20", "pct25", "pct30", "pct40", "pct50", "nil"]).optional(),
  })
  // `clear` with a fill is a plain background. `solid` paints the pattern colour, black by default.
  .transform((value) => ({ ...value, type: value.type ?? "clear", color: value.color ?? "auto" }));

const sides = <T extends z.ZodType>(item: T) => ({ top: item.optional(), bottom: item.optional(), left: item.optional(), right: item.optional() });

/** A width as `docx` takes it: twips (`dxa`), a percentage (`pct`, `"100%"` or fiftieths of a percent) or `auto`. */
const width = z.strictObject({
  size: z.union([z.number().finite(), z.string()]),
  type: z.enum(["dxa", "pct", "auto"]).optional(),
});

function widthOption(value: z.infer<typeof width>, ctx: z.RefinementCtx): { size: number | `${number}%`; type: "dxa" | "pct" | "auto" } {
  const type = value.type ?? "dxa";
  if (type === "pct") {
    if (typeof value.size === "string" && /^\d+(\.\d+)?%$/.test(value.size)) return { size: value.size as `${number}%`, type };
    if (typeof value.size === "number" && value.size >= 0 && value.size <= 5000) return { size: Math.round(value.size), type };
    ctx.addIssue({ code: "custom", path: ["size"], message: 'For pct, use a percentage such as "100%", or fiftieths of a percent (5000 is 100%)' });
    return { size: 0, type };
  }
  const twips = measure.safeParse(value.size);
  if (!twips.success) {
    ctx.addIssue({ code: "custom", path: ["size"], message: twips.error.issues[0]?.message ?? "Use a length" });
    return { size: 0, type };
  }
  return { size: twips.data, type };
}
const widthValue = width.transform(widthOption);

/** Formatting of text, for a run, a page number or a style. */
const runFormat = {
  bold: z.boolean().optional(),
  italics: z.boolean().optional(),
  underline: z
    .strictObject({ type: z.enum(["single", "double", "thick", "dotted", "dash", "words", "wave", "none"]).optional(), color: color.optional() })
    .optional(),
  strike: z.boolean().optional(),
  doubleStrike: z.boolean().optional(),
  color: color.optional(),
  size: fontSize.optional(),
  font: z.string().min(1).max(64).optional(),
  highlight: z
    .enum(["black", "blue", "cyan", "darkBlue", "darkCyan", "darkGray", "darkGreen", "darkMagenta", "darkRed", "darkYellow", "green", "lightGray", "magenta", "red", "white", "yellow"])
    .optional(),
  allCaps: z.boolean().optional(),
  smallCaps: z.boolean().optional(),
  /** Twips between letters; negative condenses. */
  characterSpacing: z.number().int().min(-1584).max(1584).optional(),
  superScript: z.boolean().optional(),
  subScript: z.boolean().optional(),
  shading: shading.optional(),
};
const runFormatSchema = z.strictObject(runFormat);

const tabStop = z.strictObject({
  type: z.enum(["left", "right", "center", "decimal", "bar", "clear"]),
  position: measure,
  leader: z.enum(["none", "dot", "hyphen", "underscore"]).optional(),
});

/** Formatting of a paragraph, for a paragraph or a style. */
const paragraphFormat = {
  alignment: z.enum(["left", "center", "right", "both", "start", "end"]).optional(),
  spacing: z
    .strictObject({
      before: measure.optional(),
      after: measure.optional(),
      /** 240 is single spacing with the `auto` rule, else twips. */
      line: z.number().int().min(0).max(31_680).optional(),
      lineRule: z.enum(["auto", "exact", "atLeast"]).optional(),
    })
    .optional(),
  indent: z.strictObject({ left: measure.optional(), right: measure.optional(), firstLine: measure.optional(), hanging: measure.optional() }).optional(),
  border: z.strictObject({ ...sides(border), between: border.optional() }).optional(),
  shading: shading.optional(),
  tabStops: z.array(tabStop).max(20).optional(),
  keepNext: z.boolean().optional(),
  keepLines: z.boolean().optional(),
  pageBreakBefore: z.boolean().optional(),
  widowControl: z.boolean().optional(),
};
const paragraphFormatSchema = z.strictObject(paragraphFormat);

const STYLE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const styleId = z.string().regex(STYLE_ID, "Use letters, digits, dashes and underscores, starting with a letter");

const paragraphStyle = z.strictObject({
  id: styleId,
  name: z.string().min(1).max(60),
  basedOn: styleId.optional(),
  next: styleId.optional(),
  quickFormat: z.boolean().optional(),
  run: runFormatSchema.optional(),
  paragraph: paragraphFormatSchema.optional(),
});
const baseStyle = paragraphStyle.omit({ id: true, name: true }).extend({ name: z.string().min(1).max(60).optional() });

const stylesSchema = z.strictObject({
  default: z
    .strictObject({
      document: z.strictObject({ run: runFormatSchema.optional(), paragraph: paragraphFormatSchema.optional() }).optional(),
      title: baseStyle.optional(),
      heading1: baseStyle.optional(),
      heading2: baseStyle.optional(),
      heading3: baseStyle.optional(),
      heading4: baseStyle.optional(),
    })
    .optional(),
  paragraphStyles: z.array(paragraphStyle).max(40).optional(),
});

const documentOptions = z.strictObject({
  title: z.string().max(200).optional(),
  styles: stylesSchema.optional(),
  /** Use the `even` headers and footers on even pages. */
  evenAndOddHeaderAndFooters: z.boolean().optional(),
  sections: z.array(z.unknown()).min(1, "Give at least one section").max(10),
});

const pageOptions = z.strictObject({
  size: z
    .strictObject({
      width: measure.optional(),
      height: measure.optional(),
      /** `landscape` turns the page; give the width and height of the portrait page. */
      orientation: z.enum(["portrait", "landscape"]).optional(),
    })
    .optional(),
  margin: z
    .strictObject({ ...sides(measure), header: measure.optional(), footer: measure.optional(), gutter: measure.optional() })
    .optional(),
});

const sectionOptions = z.strictObject({
  properties: z
    .strictObject({
      page: pageOptions.optional(),
      /** Use the `first` header and footer on the first page. */
      titlePage: z.boolean().optional(),
    })
    .optional(),
  headers: z.strictObject({ default: z.unknown().optional(), first: z.unknown().optional(), even: z.unknown().optional() }).optional(),
  footers: z.strictObject({ default: z.unknown().optional(), first: z.unknown().optional(), even: z.unknown().optional() }).optional(),
  children: z.array(z.unknown()).max(5000),
});

const headerOptions = z.strictObject({ children: z.array(z.unknown()).max(500) });

const paragraphOptions = z.strictObject({
  type: z.literal("Paragraph"),
  /** Plain text, as one run; or `children`. */
  text: z.string().max(20_000).optional(),
  children: z.array(z.unknown()).max(2000).optional(),
  style: styleId.optional(),
  heading: z.enum(["Title", "Heading1", "Heading2", "Heading3", "Heading4", "Heading5", "Heading6"]).optional(),
  bullet: z.strictObject({ level: z.number().int().min(0).max(8) }).optional(),
  ...paragraphFormat,
});

const textRunOptions = z.strictObject({
  type: z.literal("TextRun"),
  text: z.string().max(20_000).optional(),
  /** Line breaks before the text. */
  break: z.number().int().min(1).max(20).optional(),
  ...runFormat,
});

const tabOptions = z.strictObject({ type: z.literal("Tab"), ...runFormat });

const pageNumberOptions = z.strictObject({
  type: z.literal("PageNumber"),
  /** `PAGE` is the current page, `NUMPAGES` the page count. */
  field: z.enum(["PAGE", "NUMPAGES"]),
  ...runFormat,
});

const imageOptions = z.strictObject({
  type: z.literal("ImageRun"),
  /** The name of an uploaded PNG or JPEG asset. */
  asset: z.string().min(1).max(64),
  /** Pixels; give one and the other keeps the image's proportions. */
  width: z.number().int().min(1).max(4000).optional(),
  height: z.number().int().min(1).max(4000).optional(),
  altText: z.string().max(200).optional(),
});

const tableOptions = z.strictObject({
  type: z.literal("Table"),
  rows: z.array(z.unknown()).min(1, "A table needs at least one row").max(500),
  width: widthValue.optional(),
  /** Each column's width in twips or with a unit; Word needs them for a fixed layout. */
  columnWidths: z.array(measure).max(63).optional(),
  layout: z.enum(["fixed", "autofit"]).optional(),
  alignment: z.enum(["left", "center", "right"]).optional(),
  borders: z.strictObject({ ...sides(border), insideHorizontal: border.optional(), insideVertical: border.optional() }).optional(),
  /** Default cell margins. */
  margins: z.strictObject(sides(measure)).optional(),
});

const rowOptions = z.strictObject({
  type: z.literal("TableRow"),
  children: z.array(z.unknown()).min(1, "A row needs at least one cell").max(63),
  /** Repeat the row at the top of each page. */
  tableHeader: z.boolean().optional(),
  /** Keep the row on one page. */
  cantSplit: z.boolean().optional(),
  height: z
    .strictObject({ value: measure, rule: z.enum(["auto", "atLeast", "exact"]).optional() })
    .transform((height) => ({ value: height.value, rule: height.rule ?? "atLeast" }))
    .optional(),
});

const cellOptions = z.strictObject({
  type: z.literal("TableCell"),
  children: z.array(z.unknown()).max(500).optional(),
  width: widthValue.optional(),
  columnSpan: z.number().int().min(1).max(63).optional(),
  rowSpan: z.number().int().min(1).max(500).optional(),
  shading: shading.optional(),
  borders: z.strictObject(sides(border)).optional(),
  margins: z.strictObject(sides(measure)).optional(),
  verticalAlign: z.enum(["top", "center", "bottom"]).optional(),
});

/** The node types allowed where text goes: in a paragraph. */
export const INLINE_NODES = ["TextRun", "Tab", "PageNumber", "ImageRun"] as const;
/** The node types allowed where paragraphs go: a section, a header, a footer, a cell. */
export const BLOCK_NODES = ["Paragraph", "Table"] as const;

type Path = (string | number)[];

/** The object without some keys, such as a node without its `type`. */
function omit<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const out = { ...value };
  for (const key of keys) delete out[key];
  return out;
}

const pathText = (path: Path): string =>
  path.reduce<string>((text, part) => (typeof part === "number" ? `${text}[${part}]` : text ? `${text}.${part}` : part), "") || "(the document)";

/** Builds the `docx` objects for a tree, collecting every problem with its path. */
class Builder {
  readonly problems: string[] = [];
  private nodes = 0;

  constructor(private readonly images: (name: string) => DesignImage | undefined) {}

  problem(path: Path, message: string): void {
    if (this.problems.length < 30) this.problems.push(`${pathText(path)}: ${message}`);
  }

  /** The value parsed with a schema, or undefined with its problems noted. */
  parse<T extends z.ZodType>(schema: T, value: unknown, path: Path): z.output<T> | undefined {
    if (++this.nodes > MAX_NODES) {
      if (this.nodes === MAX_NODES + 1) this.problem([], `The design has more than ${MAX_NODES} nodes. Make it smaller.`);
      return undefined;
    }
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    for (const issue of result.error.issues) {
      const message =
        issue.code === "unrecognized_keys" ? `Unknown key${issue.keys.length > 1 ? "s" : ""} ${issue.keys.map((k) => `"${k}"`).join(", ")}` : issue.message;
      this.problem([...path, ...(issue.path as Path)], message);
    }
    return undefined;
  }

  /** The node's `type`, checked against the types allowed here. */
  private type(node: unknown, path: Path, allowed: readonly string[]): string | undefined {
    const type = node !== null && typeof node === "object" && !Array.isArray(node) ? (node as { type?: unknown }).type : undefined;
    if (typeof type === "string" && allowed.includes(type)) return type;
    this.problem(path, `${typeof type === "string" ? `"${type}" is not allowed here.` : "Give the node a type."} Use ${allowed.map((t) => `"${t}"`).join(", ")}.`);
    return undefined;
  }

  blocks(nodes: unknown[], path: Path, depth = 0): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = [];
    nodes.forEach((node, i) => {
      const at = [...path, i];
      const type = this.type(node, at, BLOCK_NODES);
      const built = type === "Paragraph" ? this.paragraph(node, at) : type === "Table" ? this.table(node, at, depth) : undefined;
      if (built) out.push(built);
    });
    return out;
  }

  paragraph(node: unknown, path: Path): Paragraph | undefined {
    const options = this.parse(paragraphOptions, node, path);
    if (!options) return undefined;
    const { text, children = [] } = options;
    const rest = omit(options, "type", "text", "children");
    if (text !== undefined && children.length > 0) this.problem(path, 'Give "text" or "children", not both.');
    // Each sets the paragraph's style, and Word takes only one.
    const styled = (["style", "heading", "bullet"] as const).filter((key) => rest[key] !== undefined);
    if (styled.length > 1) this.problem(path, `Give one of ${styled.map((key) => `"${key}"`).join(" and ")}: each sets the paragraph's style. Format a bullet with its own keys.`);
    const runs = text !== undefined ? [new TextRun(text)] : this.inline(children, [...path, "children"]);
    return new Paragraph({ ...(rest as IParagraphOptions), children: runs });
  }

  inline(nodes: unknown[], path: Path): (TextRun | ImageRun)[] {
    const out: (TextRun | ImageRun)[] = [];
    nodes.forEach((node, i) => {
      const at = [...path, i];
      switch (this.type(node, at, INLINE_NODES)) {
        case "TextRun": {
          const options = this.parse(textRunOptions, node, at);
          if (options) out.push(new TextRun(omit(options, "type") as IRunOptions));
          break;
        }
        case "Tab": {
          const options = this.parse(tabOptions, node, at);
          if (options) out.push(new TextRun({ ...(omit(options, "type") as IRunOptions), children: [new Tab()] }));
          break;
        }
        case "PageNumber": {
          const options = this.parse(pageNumberOptions, node, at);
          if (options) out.push(...pageField(options.field, omit(options, "type", "field") as IRunOptions));
          break;
        }
        case "ImageRun": {
          const image = this.image(node, at);
          if (image) out.push(image);
          break;
        }
      }
    });
    return out;
  }

  image(node: unknown, path: Path): ImageRun | undefined {
    const options = this.parse(imageOptions, node, path);
    if (!options) return undefined;
    const image = this.images(options.asset);
    if (!image) {
      this.problem([...path, "asset"], `There is no PNG or JPEG asset "${options.asset}". Use one of the uploaded image assets.`);
      return undefined;
    }
    let { width, height } = options;
    if (width === undefined && height === undefined) {
      width = Math.min(image.width, MAX_IMAGE_WIDTH);
      height = Math.round((image.height * width) / image.width);
    } else if (width === undefined) {
      width = Math.round((image.width * height!) / image.height);
    } else if (height === undefined) {
      height = Math.round((image.height * width) / image.width);
    }
    const alt = options.altText ?? options.asset;
    return new ImageRun({
      type: image.type,
      data: image.data,
      transformation: { width: Math.max(1, width), height: Math.max(1, height!) },
      altText: { name: options.asset, description: alt, title: alt },
    });
  }

  table(node: unknown, path: Path, depth: number): Table | undefined {
    if (depth >= MAX_TABLE_DEPTH) {
      this.problem(path, `Tables can sit at most ${MAX_TABLE_DEPTH} deep in table cells.`);
      return undefined;
    }
    const options = this.parse(tableOptions, node, path);
    if (!options) return undefined;
    const { rows } = options;
    const rest = omit(options, "type", "rows");
    const built: TableRow[] = [];
    rows.forEach((row, r) => {
      const at = [...path, "rows", r];
      if (this.type(row, at, ["TableRow"]) === undefined) return;
      const rowOpts = this.parse(rowOptions, row, at);
      if (!rowOpts) return;
      const cells: TableCell[] = [];
      rowOpts.children.forEach((cell, c) => {
        const cellAt = [...at, "children", c];
        if (this.type(cell, cellAt, ["TableCell"]) === undefined) return;
        const cellOpts = this.parse(cellOptions, cell, cellAt);
        if (!cellOpts) return;
        const content = this.blocks(cellOpts.children ?? [], [...cellAt, "children"], depth + 1);
        const cellRest = omit(cellOpts, "type", "children");
        // Word needs a paragraph in every cell.
        cells.push(new TableCell({ ...(cellRest as Omit<ITableCellOptions, "children">), children: content.length > 0 ? content : [new Paragraph({})] }));
      });
      if (cells.length > 0) built.push(new TableRow({ ...omit(rowOpts, "type", "children"), children: cells }));
    });
    if (built.length === 0) return undefined;
    return new Table({ ...(rest as Omit<ITableOptions, "rows">), rows: built });
  }

  headerFooter(node: unknown, path: Path): (Paragraph | Table)[] | undefined {
    const options = this.parse(headerOptions, node, path);
    return options ? this.blocks(options.children, [...path, "children"]) : undefined;
  }

  section(node: unknown, path: Path): ISectionOptions | undefined {
    const options = this.parse(sectionOptions, node, path);
    if (!options) return undefined;
    const page = options.properties?.page;
    const parts = (which: "headers" | "footers", Make: typeof Header | typeof Footer) => {
      const given = options[which];
      if (!given) return undefined;
      const out: Record<string, Header | Footer> = {};
      for (const kind of ["default", "first", "even"] as const) {
        if (given[kind] === undefined) continue;
        const children = this.headerFooter(given[kind], [...path, which, kind]);
        if (children) out[kind] = new Make({ children });
      }
      return out;
    };
    const size = page?.size;
    return {
      properties: {
        ...(options.properties?.titlePage ? { titlePage: true } : {}),
        page: {
          // A4 unless the design says otherwise: docx defaults to US Letter.
          size: { width: size?.width ?? A4.width, height: size?.height ?? A4.height, ...(size?.orientation ? { orientation: size.orientation } : {}) },
          margin: { top: DEFAULT_MARGIN, right: DEFAULT_MARGIN, bottom: DEFAULT_MARGIN, left: DEFAULT_MARGIN, ...page?.margin },
        },
      },
      headers: parts("headers", Header),
      footers: parts("footers", Footer),
      children: this.blocks(options.children, [...path, "children"]),
    };
  }
}

/** A4 in twips. */
const A4 = { width: 11_906, height: 16_838 };
/** 20 mm in twips. */
const DEFAULT_MARGIN = 1134;

/**
 * A page field such as PAGE or NUMPAGES, with each part in its own run as Word writes it.
 * The `docx` library puts the parts in one run, and Carbone's ICE converter then prints nothing.
 */
export function pageField(code: string, style: IRunOptions): TextRun[] {
  const char = (type: string) => new ImportedXmlComponent("w:fldChar", { "w:fldCharType": type });
  const instruction = new ImportedXmlComponent("w:instrText", { "xml:space": "preserve" });
  instruction.push(` ${code} `);
  return [char("begin"), instruction, char("separate"), char("end")].map((part) => new TextRun({ ...style, children: [part] }));
}

/**
 * Builds a Word template from a design: a JSON tree in the shape of the `docx` library's
 * options, with a `type` on each node. The document has `sections`, and optionally
 * `styles` (the default font and named paragraph styles), `title` and
 * `evenAndOddHeaderAndFooters`. A section has `properties.page` (size and margins; A4
 * and 20 mm when not given), `properties.titlePage`, `headers` and `footers` (`default`,
 * `first`, `even`, each with `children`) and `children`. Paragraphs and tables go where
 * blocks go; text runs, tabs, page numbers and images go in a paragraph's `children`.
 *
 * @param design - The tree, as parsed from JSON
 * @param images - The PNG and JPEG assets `ImageRun` may place, by name
 * @returns The `.docx` file
 * @throws DesignError listing every problem with its path, when the tree has nodes, keys or values that are not allowed
 */
export async function buildDocx(design: unknown, images: (name: string) => DesignImage | undefined = () => undefined): Promise<Uint8Array> {
  const builder = new Builder(images);
  const options = builder.parse(documentOptions, design, []);
  if (!options) throw new DesignError(builder.problems);
  const sections = options.sections.map((section, i) => builder.section(section, ["sections", i]));
  if (builder.problems.length > 0) throw new DesignError(builder.problems);
  const doc = new Document({
    creator: "Spooldoc",
    title: options.title ?? "",
    ...(options.evenAndOddHeaderAndFooters ? { evenAndOddHeaderAndFooters: true } : {}),
    ...(options.styles ? { styles: options.styles as ConstructorParameters<typeof Document>[0]["styles"] } : {}),
    sections: sections as ISectionOptions[],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

/**
 * The size in pixels and type of a PNG or JPEG image, from its bytes, or null for
 * anything else or a file too short to say.
 */
export function imageInfo(bytes: Uint8Array): { type: "png" | "jpg"; width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width > 0 && height > 0 ? { type: "png", width, height } : null;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    // Walk the markers to the first start-of-frame, which holds the size.
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1]!;
      const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = (bytes[at + 5]! << 8) | bytes[at + 6]!;
        const width = (bytes[at + 7]! << 8) | bytes[at + 8]!;
        return width > 0 && height > 0 ? { type: "jpg", width, height } : null;
      }
      at += 2 + length;
    }
  }
  return null;
}
