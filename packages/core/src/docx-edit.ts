import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { MAX_DOCX_BYTES, readDocx } from "./docx.js";

/**
 * Editing a Word template's XML with `str_replace` rules: a text that occurs exactly once
 * in one part is replaced. This is how the AI assistant changes a Word file it did not
 * design, such as one the user made in Word. Only the parts Spooldoc reads (the body,
 * headers and footers) can be edited; every other file in the zip comes out byte for
 * byte the same.
 */

/** Most files in a Word template's zip. */
const MAX_ENTRIES = 2000;
/** Most bytes all the files of a Word template may unzip to. */
const MAX_UNZIPPED_BYTES = 64 * 1024 * 1024;

/** True for the parts that can be read and edited: the body, headers and footers. */
export function isEditablePart(name: string): boolean {
  return name === "word/document.xml" || /^word\/(header|footer)\d*\.xml$/.test(name);
}

/** One part that can be edited, with its size as it reads after runs are merged. */
export interface DocxPartInfo {
  name: string;
  /** Characters of its XML. */
  size: number;
}

/** One `str_replace` edit: `find` occurs exactly once in `part`, and becomes `replace`. */
export interface DocxEdit {
  part: string;
  find: string;
  replace: string;
}

/** Why an edit could not be made: which edit, when there are several, and what to do. */
export class DocxEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocxEditError";
  }
}

/** Every file of the zip, in the zip's order, within the limits. */
function unzipAll(bytes: Uint8Array): Record<string, Uint8Array> {
  readDocx(bytes); // Says what is wrong when it is not a Word document.
  let entries = 0;
  let total = 0;
  let tooLarge = false;
  const files = unzipSync(bytes, {
    filter: (file) => {
      entries++;
      total += file.originalSize;
      if (entries > MAX_ENTRIES || total > MAX_UNZIPPED_BYTES) tooLarge = true;
      return !tooLarge;
    },
  });
  if (tooLarge) {
    throw new DocxEditError(`The file is too large to edit: at most ${MAX_ENTRIES} files and ${MAX_UNZIPPED_BYTES / 1024 / 1024} MB unzipped.`);
  }
  return files;
}

/** A run with only formatting and one text: `<w:r ...><w:rPr>...</w:rPr><w:t ...>text</w:t></w:r>`. */
const TEXT_RUN = /<w:r(?:\s[^>]*)?>(?:<w:rPr>((?:(?!<\/w:rPr>)[\s\S])*)<\/w:rPr>)?<w:t(?:\s[^>]*)?>([^<]*)<\/w:t><\/w:r>|<w:r(?:\s[^>]*)?>(?:<w:rPr>((?:(?!<\/w:rPr>)[\s\S])*)<\/w:rPr>)?<w:t\/><\/w:r>/y;

/**
 * A part's XML with adjacent runs of the same formatting merged into one, so text Word
 * split over runs (where it was typed later, or checked for spelling) can be found.
 * Spell-check marks and Word's note of where it last broke the page are dropped; both
 * are only hints, which Word writes again. Nothing else changes.
 */
export function mergeRuns(xml: string): string {
  const clean = xml.replace(/<w:proofErr\b[^>]*\/>/g, "").replace(/<w:lastRenderedPageBreak\/>/g, "");
  let out = "";
  let at = 0;
  while (at < clean.length) {
    const start = clean.indexOf("<w:r", at);
    if (start === -1) break;
    // `<w:r>` or `<w:r ...>`, not `<w:rPr>` or `<w:rFonts>`.
    const next = clean[start + 4];
    if (next !== ">" && next !== " ") {
      out += clean.slice(at, start + 4);
      at = start + 4;
      continue;
    }
    out += clean.slice(at, start);
    // Read a stretch of text runs with the same formatting.
    let format: string | undefined;
    let text = "";
    let firstOpen = "";
    let count = 0;
    let pos = start;
    for (;;) {
      TEXT_RUN.lastIndex = pos;
      const match = TEXT_RUN.exec(clean);
      if (!match) break;
      const runFormat = match[1] ?? match[3] ?? "";
      if (count > 0 && runFormat !== format) break;
      if (count === 0) {
        format = runFormat;
        firstOpen = /^<w:r(?:\s[^>]*)?>/.exec(match[0])![0];
      }
      text += match[2] ?? "";
      count++;
      pos = TEXT_RUN.lastIndex;
    }
    if (count <= 1) {
      // Not a run of text, or a single one: as it is.
      const end = count === 1 ? pos : start + 4;
      out += clean.slice(start, end);
      at = end;
      continue;
    }
    out += `${firstOpen}${format ? `<w:rPr>${format}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
    at = pos;
  }
  return out + clean.slice(at);
}

const NAME = /^[A-Za-z_][\w.:-]*$/;

/**
 * Why a part's XML is not well-formed, or null when it is: one root element, every
 * element closed in order, quoted attributes, and `&` only in entities.
 */
export function xmlProblem(xml: string): string | null {
  const stack: string[] = [];
  let roots = 0;
  const line = (index: number): number => xml.slice(0, index).split("\n").length;
  const badAmp = (text: string): boolean => /&(?!(?:lt|gt|amp|quot|apos|#\d+|#x[0-9A-Fa-f]+);)/.test(text);
  let at = 0;
  while (at < xml.length) {
    const open = xml.indexOf("<", at);
    const text = xml.slice(at, open === -1 ? xml.length : open);
    if (badAmp(text)) return `A bare & in text on line ${line(at)}. Write it as &amp;.`;
    if (open === -1) break;
    if (xml.startsWith("<?", open)) {
      const end = xml.indexOf("?>", open);
      if (end === -1) return `An unclosed <? on line ${line(open)}.`;
      at = end + 2;
      continue;
    }
    if (xml.startsWith("<!--", open)) {
      const end = xml.indexOf("-->", open);
      if (end === -1) return `An unclosed comment on line ${line(open)}.`;
      at = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", open)) {
      const end = xml.indexOf("]]>", open);
      if (end === -1) return `An unclosed CDATA section on line ${line(open)}.`;
      at = end + 3;
      continue;
    }
    // Find the end of the tag, skipping `>` inside quoted attribute values.
    let end = open + 1;
    let quote: string | null = null;
    for (; end < xml.length; end++) {
      const c = xml[end];
      if (quote) {
        if (c === quote) quote = null;
        else if (c === "<") return `A < inside an attribute value on line ${line(end)}. Write it as &lt;.`;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      else if (c === "<") return `A tag that is never closed with > on line ${line(open)}.`;
    }
    if (end >= xml.length) return `A tag that is never closed with > on line ${line(open)}.`;
    const tag = xml.slice(open + 1, end);
    if (tag.startsWith("/")) {
      const name = tag.slice(1).trim();
      const expected = stack.pop();
      if (name !== expected) {
        return expected ? `</${name}> on line ${line(open)} closes <${expected}>, which is still open.` : `</${name}> on line ${line(open)} closes nothing.`;
      }
    } else {
      const selfClosing = tag.endsWith("/");
      const body = selfClosing ? tag.slice(0, -1) : tag;
      const name = /^\S+/.exec(body)?.[0] ?? "";
      if (!NAME.test(name)) return `A tag without a valid name on line ${line(open)}: <${tag.slice(0, 40)}>.`;
      const attributes = body.slice(name.length);
      const attribute = /\s+([A-Za-z_][\w.:-]*)\s*=\s*("[^"]*"|'[^']*')/y;
      let pos = 0;
      const seen = new Set<string>();
      while (pos < attributes.length) {
        if (/^\s*$/.test(attributes.slice(pos))) break;
        attribute.lastIndex = pos;
        const match = attribute.exec(attributes);
        if (!match) return `An attribute without a quoted value in <${name}> on line ${line(open)}.`;
        if (seen.has(match[1]!)) return `The attribute ${match[1]} twice in <${name}> on line ${line(open)}.`;
        seen.add(match[1]!);
        if (badAmp(match[2]!)) return `A bare & in an attribute of <${name}> on line ${line(open)}. Write it as &amp;.`;
        pos = attribute.lastIndex;
      }
      if (stack.length === 0) roots++;
      if (roots > 1) return `A second root element <${name}> on line ${line(open)}.`;
      if (!selfClosing) stack.push(name);
    }
    at = end + 1;
  }
  if (stack.length > 0) return `<${stack[stack.length - 1]}> is never closed.`;
  if (roots === 0) return "There is no root element.";
  return null;
}

/** The parts of a Word template that can be read and edited, in the zip's order. */
export function docxParts(bytes: Uint8Array): DocxPartInfo[] {
  const files = unzipAll(bytes);
  return Object.keys(files)
    .filter(isEditablePart)
    .map((name) => ({ name, size: mergeRuns(strFromU8(files[name]!)).length }));
}

/** One part's XML, with runs of the same formatting merged (`mergeRuns`), as `editDocx` matches it. */
export function readDocxPart(bytes: Uint8Array, part: string): string {
  const files = unzipAll(bytes);
  const content = files[part];
  if (!isEditablePart(part) || !content) {
    const names = Object.keys(files).filter(isEditablePart);
    throw new DocxEditError(`There is no part "${part}". The parts are ${names.join(", ")}.`);
  }
  return mergeRuns(strFromU8(content));
}

/**
 * Applies edits to a Word template, in order, all or none. Each part an edit touches is
 * read with runs merged, edited and checked: its XML must stay well-formed, and the file
 * must still read as a Word template. Every other file is kept as it was.
 *
 * @returns The new file
 * @throws DocxEditError saying which edit failed and why
 */
export function editDocx(bytes: Uint8Array, edits: readonly DocxEdit[]): Uint8Array {
  if (edits.length === 0) throw new DocxEditError("Give at least one edit.");
  const files = unzipAll(bytes);
  const changed = new Map<string, string>();
  edits.forEach((edit, i) => {
    const n = edits.length > 1 ? `Edit ${i + 1}: ` : "";
    const content = files[edit.part];
    if (!isEditablePart(edit.part) || !content) {
      const names = Object.keys(files).filter(isEditablePart);
      throw new DocxEditError(`${n}There is no part "${edit.part}". The parts are ${names.join(", ")}.`);
    }
    if (!edit.find) throw new DocxEditError(`${n}find is empty. Give text that occurs once in ${edit.part}.`);
    const xml = changed.get(edit.part) ?? mergeRuns(strFromU8(content));
    const first = xml.indexOf(edit.find);
    if (first === -1) {
      throw new DocxEditError(`${n}The text to find is not in ${edit.part}. Read the part again: runs of the same formatting are merged, and & < > are written &amp; &lt; &gt;.`);
    }
    if (xml.indexOf(edit.find, first + 1) !== -1) {
      throw new DocxEditError(`${n}The text to find occurs more than once in ${edit.part}. Give more of the text around it.`);
    }
    changed.set(edit.part, xml.slice(0, first) + edit.replace + xml.slice(first + edit.find.length));
  });
  for (const [part, xml] of changed) {
    const problem = xmlProblem(xml);
    if (problem) throw new DocxEditError(`After the edits, ${part} is not well-formed XML: ${problem} Nothing was saved.`);
  }
  const out: Zippable = {};
  for (const [name, content] of Object.entries(files)) {
    const xml = changed.get(name);
    // Pictures are compressed already.
    out[name] = xml !== undefined ? strToU8(xml) : [content, { level: /\.(png|jpe?g|gif|emf|wmf)$/i.test(name) ? 0 : 6 }];
  }
  const result = zipSync(out);
  if (result.length > MAX_DOCX_BYTES) throw new DocxEditError(`After the edits, the file is larger than ${MAX_DOCX_BYTES / 1024 / 1024} MB.`);
  try {
    readDocx(result);
  } catch (error) {
    throw new DocxEditError(`After the edits, the file does not read as a Word template: ${error instanceof Error ? error.message : String(error)} Nothing was saved.`);
  }
  return result;
}

