import { strFromU8 } from "fflate";
import { readDocx } from "./docx.js";
import { rezip as rezipOffice, unzipAll as unzipOffice, xmlProblem, type OfficeKind } from "./office-zip.js";

export { xmlProblem };

/**
 * Editing a Word template's XML with `str_replace` rules: a text that occurs exactly once
 * in one part is replaced. This is how the agent changes a Word file it did not
 * design, such as one the user made in Word. Only the parts Spooldoc reads (the body,
 * headers and footers) can be edited; every other file in the zip comes out byte for
 * byte the same.
 */

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

const WORD: OfficeKind = { name: "a Word template", read: readDocx, error: DocxEditError };

/** Every file of the zip, in the zip's order, within the limits. */
const unzipAll = (bytes: Uint8Array): Record<string, Uint8Array> => unzipOffice(bytes, WORD);

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
  return rezip(files, changed);
}

/**
 * Rewrites the text of every part that can be edited with `change`, which gets each
 * part's XML with runs merged. Parts it leaves as they were, and every other file, come
 * out the same. Checked like `editDocx`.
 *
 * @returns The new file, or `bytes` itself when no part changed
 * @throws DocxEditError when a part is no longer well-formed or the file no longer reads
 */
export function rewriteDocx(bytes: Uint8Array, change: (xml: string, part: string) => string): Uint8Array {
  const files = unzipAll(bytes);
  const changed = new Map<string, string>();
  for (const [name, content] of Object.entries(files)) {
    if (!isEditablePart(name)) continue;
    const xml = mergeRuns(strFromU8(content));
    const next = change(xml, name);
    if (next !== xml) changed.set(name, next);
  }
  return changed.size === 0 ? bytes : rezip(files, changed);
}

/** The zip again with the changed parts, after checking them and the file. */
const rezip = (files: Record<string, Uint8Array>, changed: Map<string, string>): Uint8Array => rezipOffice(files, changed, WORD);
