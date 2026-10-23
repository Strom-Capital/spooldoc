import {
  AlignmentType,
  BorderStyle,
  convertMillimetersToTwip,
  Document,
  Footer,
  Packer,
  Paragraph,
  Tab,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
} from "docx";
import { unzipSync } from "fflate";
import type { Definition } from "./definition.js";
import { pageField } from "./docx-design.js";
import type { Lookup } from "./lookup-spec.js";
import { short, tagProblems, templatePaths } from "./tags.js";
import { decodeXml as decode, isOle, isZip, xmlAttribute as attribute } from "./xml.js";
import { fieldLabel, MAX_TEMPLATE_FILE_BYTES, starterLayout, valueTag, type StarterBlock, type StarterColumn } from "./template.js";

/**
 * Word templates: a `.docx` made in Word with Carbone tags in its text. Spooldoc reads the
 * tags out of the file to check them, and makes a starter template from a definition.
 * The file itself is only ever changed by the user, in Word.
 */

/** The content type of a Word document. */
export const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The most one part of the file (the body, a header) may unzip to. */
const MAX_PART_BYTES = 32 * 1024 * 1024;

/** Where a paragraph is: the body, a header or a footer. */
export type DocxPart = "body" | "header" | "footer";

/** A paragraph of a Word template, with the text of all its runs joined. */
export interface DocxParagraph {
  part: DocxPart;
  text: string;
}

/** What Spooldoc reads from a Word template. */
export interface DocxTemplate {
  /** Every paragraph with text: the body's, then the headers', then the footers'. */
  paragraphs: DocxParagraph[];
  /** The paragraphs' text, one per line. */
  text: string;
  /** The fields the template uses, by code: PAGE, NUMPAGES, PAGEREF, REF and so on. */
  fields: string[];
}

/** A problem in a Word template, and the part it is in. */
export interface DocxProblem {
  part: DocxPart;
  message: string;
}

const PART_NAME: Record<DocxPart, string> = { body: "Body", header: "Header", footer: "Footer" };

/** The part a file of the zip is, or undefined for one Spooldoc does not read. */
function partOf(name: string): DocxPart | undefined {
  if (name === "word/document.xml") return "body";
  const header = /^word\/(header|footer)\d*\.xml$/.exec(name);
  return header ? (header[1] as DocxPart) : undefined;
}

/** The code of a field instruction: ` PAGEREF _Toc1 \h ` gives `PAGEREF`. */
function fieldCode(instruction: string): string | undefined {
  return instruction.trim().split(/\s/, 1)[0]?.toUpperCase() || undefined;
}

/**
 * Reads the paragraphs of one part in one pass over its XML. A paragraph's text is the
 * text of its runs joined, since Word splits a tag over several runs when part of it is
 * styled or was typed later. A tab is `\t` and a line break `\n`. The fallback copy Word
 * keeps of a text box (`mc:Fallback`) and deleted text are skipped.
 */
function readPart(xml: string, part: DocxPart, paragraphs: DocxParagraph[], fields: Set<string>): void {
  const open: string[] = [];
  let runs = 0;
  /** Inside `w:tabs`, a paragraph's tab stops, where `w:tab` is not a tab character. */
  let tabStops = 0;
  let fallback = 0;
  let instruction: string | null = null;
  for (let i = xml.indexOf("<"); i !== -1; ) {
    const end = xml.indexOf(">", i);
    if (end === -1) break;
    const closing = xml[i + 1] === "/";
    const empty = xml[end - 1] === "/";
    let nameEnd = i + (closing ? 2 : 1);
    while (nameEnd < end && !" \t\r\n/".includes(xml[nameEnd] as string)) nameEnd++;
    const name = xml.slice(i + (closing ? 2 : 1), nameEnd);
    const next = xml.indexOf("<", end + 1);
    const content = (): string => decode(xml.slice(end + 1, next === -1 ? xml.length : next));

    if (name === "mc:Fallback") {
      if (!empty) fallback += closing ? -1 : 1;
    } else if (fallback > 0) {
      // Word's copy of what mc:Choice already holds.
    } else if (name === "w:p") {
      if (closing) {
        const text = open.pop() ?? "";
        if (text.trim()) paragraphs.push({ part, text });
      } else if (!empty) {
        open.push("");
      }
    } else if (name === "w:r") {
      if (!empty) runs += closing ? -1 : 1;
    } else if (name === "w:tabs") {
      if (!empty) tabStops += closing ? -1 : 1;
    } else if (!closing && open.length > 0) {
      const add = (text: string): void => {
        open[open.length - 1] += text;
      };
      if (name === "w:t" && !empty) add(content());
      else if (name === "w:tab" && runs > 0 && tabStops === 0) add("\t");
      else if ((name === "w:br" || name === "w:cr") && runs > 0) add("\n");
      else if (name === "w:instrText" && !empty && instruction !== null) instruction += content();
      else if (name === "w:fldChar") {
        const type = attribute(xml.slice(i, end), "w:fldCharType");
        if (type === "begin") instruction = "";
        else if (instruction !== null) {
          const code = fieldCode(instruction);
          if (code) fields.add(code);
          instruction = null;
        }
      } else if (name === "w:fldSimple") {
        const code = fieldCode(attribute(xml.slice(i, end), "w:instr") ?? "");
        if (code) fields.add(code);
      }
    }
    i = next;
  }
}

const NOT_DOCX = "The file is not a Word document. Save it in Word as a Word Document (.docx) and upload it again.";

/**
 * Reads a Word template: the text of every paragraph of its body, headers and footers,
 * and the fields it uses.
 *
 * @throws Error saying what is wrong with the file and what to do, when it is not a `.docx`
 */
export function readDocx(bytes: Uint8Array): DocxTemplate {
  if (isOle(bytes)) {
    throw new Error("The file is a Word 97-2003 document (.doc). Save it in Word as a Word Document (.docx) and upload it again.");
  }
  if (!isZip(bytes)) {
    throw new Error(NOT_DOCX);
  }
  let tooLarge = false;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        if (partOf(file.name) === undefined) return false;
        if (file.originalSize > MAX_PART_BYTES) tooLarge = true;
        return !tooLarge;
      },
    });
  } catch {
    throw new Error("The file is damaged: it could not be unzipped. Save it in Word again and upload it again.");
  }
  if (tooLarge) {
    throw new Error(`The file has a part larger than ${MAX_PART_BYTES / 1024 / 1024} MB unzipped. Spooldoc takes Word templates up to that size.`);
  }
  if (!files["word/document.xml"]) {
    throw new Error(`The file is a zip file, but not a Word document: it has no word/document.xml. ${NOT_DOCX}`);
  }
  const order: Record<DocxPart, number> = { body: 0, header: 1, footer: 2 };
  const names = Object.keys(files).sort((a, b) => order[partOf(a)!] - order[partOf(b)!] || a.localeCompare(b, "en", { numeric: true }));
  const paragraphs: DocxParagraph[] = [];
  const fields = new Set<string>();
  const decoder = new TextDecoder("utf-8");
  for (const name of names) readPart(decoder.decode(files[name]), partOf(name)!, paragraphs, fields);
  return { paragraphs, text: paragraphs.map((p) => p.text).join("\n"), fields: [...fields] };
}

/** Why a file is not a Word template Spooldoc can use, or null when it is one. */
export function docxProblem(bytes: Uint8Array): string | null {
  if (bytes.length > MAX_TEMPLATE_FILE_BYTES) return `The file is too large: Word templates can be at most ${MAX_TEMPLATE_FILE_BYTES / 1024 / 1024} MB.`;
  try {
    readDocx(bytes);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * The converter for a PDF of a Word template: LibreOffice (`L`) when the template has
 * PAGEREF or REF fields, which it computes itself, else Carbone's own ICE (`I`), the
 * fastest, which prints the values Word saved.
 */
export function docxConverter(template: Pick<DocxTemplate, "fields">): "I" | "L" {
  return template.fields.some((code) => code === "PAGEREF" || code === "REF") ? "L" : "I";
}

/** `{asset('name')}`, or a start of one, in a paragraph. */
const ASSET_START = /\{asset\b/;

/**
 * Checks a Word template's tags paragraph by paragraph, with the rules of `checkTemplate`:
 * fields that are not in the definition, curly (Word's default) and double quotes, tags
 * that are never closed. `{asset('name')}` is a problem too: a Word template has its
 * pictures in it. Without a definition, fields are not checked.
 *
 * @returns The problems in the order of the paragraphs; empty when the template is fine
 */
export function checkDocx(template: DocxTemplate, def?: Definition | null, options: { lookups?: readonly Lookup[] } = {}): DocxProblem[] {
  const known = def ? templatePaths(def, options.lookups) : undefined;
  const problems: DocxProblem[] = [];
  const seen = new Set<string>();
  const add = (part: DocxPart, message: string): void => {
    const key = `${part}\n${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    problems.push({ part, message });
  };
  for (const paragraph of template.paragraphs) {
    if (!paragraph.text.includes("{")) continue;
    for (const problem of tagProblems(paragraph.text, known, { word: true })) add(paragraph.part, problem.message);
    const asset = ASSET_START.exec(paragraph.text);
    if (asset) {
      add(
        paragraph.part,
        `${short(paragraph.text.slice(asset.index, asset.index + 40))} is for HTML templates. In Word, insert the picture itself, set to In line with text.`,
      );
    }
  }
  return problems;
}

/** Problems as text, one per line: "Header: ...". */
export function docxProblemText(problems: readonly DocxProblem[]): string {
  return problems.map((p) => `${PART_NAME[p.part]}: ${p.message}`).join("\n");
}

const GREY = "555555";
const FOOTER = { size: 16, color: GREY };
const MARGIN_MM = 15;
/** The width of an A4 page between the margins, in twips. */
const TEXT_WIDTH = convertMillimetersToTwip(210 - 2 * MARGIN_MM);

const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;
const rule = { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC" } as const;
const heavy = { style: BorderStyle.SINGLE, size: 6, color: "333333" } as const;

/** The fields as one paragraph, a line each: every line after the first is hidden when its field is empty. */
function fieldsParagraph(fields: StarterColumn[]): Paragraph {
  const runs: TextRun[] = [];
  for (const [n, field] of fields.entries()) {
    const tag = valueTag(`d.pg.${field.name}`, field.type);
    if (n === 0) {
      runs.push(new TextRun({ text: fieldLabel(field.name), color: GREY }), new TextRun({ children: [new Tab(), tag] }));
      continue;
    }
    // The pattern that works in the Community Edition: hide from before the line break to after the value.
    runs.push(
      new TextRun(`{d.pg.${field.name}:ifEM:hideBegin}`),
      new TextRun({ break: 1, text: fieldLabel(field.name), color: GREY }),
      new TextRun({ children: [new Tab(), `${tag}{d.pg.${field.name}:hideEnd}`] }),
    );
  }
  return new Paragraph({ tabStops: [{ type: TabStopType.LEFT, position: convertMillimetersToTwip(45) }], spacing: { line: 300 }, children: runs });
}

/** A heading and a table with a header row, a row of `[i]` tags and the `[i+1]` end row. */
function blockTable(block: StarterBlock): (Paragraph | Table)[] {
  const width = Math.floor(TEXT_WIDTH / block.columns.length);
  const cell = (column: StarterColumn, text: string, header = false): TableCell =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
      ...(header ? { borders: { bottom: heavy } } : {}),
      children: [
        new Paragraph({
          alignment: column.type === "number" ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: text ? [new TextRun({ text, bold: header })] : [],
        }),
      ],
    });
  const rows = [
    new TableRow({ tableHeader: true, children: block.columns.map((c) => cell(c, fieldLabel(c.name), true)) }),
    new TableRow({ cantSplit: true, children: block.columns.map((c) => cell(c, valueTag(`d.pg.${block.name}[i].${c.name}`, c.type))) }),
    new TableRow({ children: block.columns.map((c, n) => cell(c, n === 0 ? `{d.pg.${block.name}[i+1]}` : "")) }),
  ];
  return [
    new Paragraph({ keepNext: true, spacing: { before: 280, after: 120 }, children: [new TextRun({ text: fieldLabel(block.name), bold: true, size: 22 })] }),
    new Table({
      width: { size: TEXT_WIDTH, type: WidthType.DXA },
      columnWidths: block.columns.map(() => width),
      borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: rule, insideVertical: none },
      rows,
    }),
  ];
}

/**
 * A Word starter template for a definition, the same layout as `starterTemplate`: an A4
 * page with the title, the fields (every line after the first hidden when its field is
 * empty), a table for each table, record or group, and "Page 1 of 2" in the footer with
 * Word's own page fields. The user opens it in Word, adds a logo and styling, and uploads it.
 */
export async function starterDocx(def: Definition): Promise<Uint8Array> {
  const { title, fields, blocks } = starterLayout(def);
  const margin = convertMillimetersToTwip(MARGIN_MM);
  const children: (Paragraph | Table)[] = [new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: title, bold: true, size: 36 })] })];
  if (fields.length > 0) children.push(fieldsParagraph(fields));
  for (const block of blocks) if (block.columns.length > 0) children.push(...blockTable(block));
  const doc = new Document({
    creator: "Spooldoc",
    title,
    styles: { default: { document: { run: { font: "Arial", size: 20, color: "1A1A1A" } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: convertMillimetersToTwip(210), height: convertMillimetersToTwip(297) },
            margin: { top: margin, right: margin, bottom: margin, left: margin, footer: convertMillimetersToTwip(8) },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ ...FOOTER, text: "Page " }),
                  ...pageField("PAGE", FOOTER),
                  new TextRun({ ...FOOTER, text: " of " }),
                  ...pageField("NUMPAGES", FOOTER),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
