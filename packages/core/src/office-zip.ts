import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { MAX_TEMPLATE_FILE_BYTES } from "./template.js";

/**
 * Unzipping and zipping a Word or Excel template for an edit: limits on the zip, a check
 * that each changed part is well-formed XML and that the file still reads, and every
 * entry the edit did not touch kept byte for byte.
 */

/** Most files in a template's zip. */
const MAX_ENTRIES = 2000;
/** Most bytes all the files of a template may unzip to. */
const MAX_UNZIPPED_BYTES = 64 * 1024 * 1024;

/** The kind of file an edit is about. */
export interface OfficeKind {
  /** As in "does not read as a Word template". */
  name: string;
  /** Throws, saying what is wrong, when the bytes are not this kind of file. */
  read(bytes: Uint8Array): unknown;
  /** The error an edit throws. */
  error: new (message: string) => Error;
}

/** Every file of the zip, in the zip's order, within the limits. */
export function unzipAll(bytes: Uint8Array, kind: OfficeKind): Record<string, Uint8Array> {
  kind.read(bytes); // Says what is wrong when it is not this kind of file.
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
    throw new kind.error(`The file is too large to edit: at most ${MAX_ENTRIES} files and ${MAX_UNZIPPED_BYTES / 1024 / 1024} MB unzipped.`);
  }
  return files;
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

/**
 * The zip again with the changed parts, after checking them and the file. A part changed
 * to null is left out.
 *
 * @throws The kind's error when a part is not well-formed, the file is too large or it no longer reads
 */
export function rezip(files: Record<string, Uint8Array>, changed: Map<string, string | null>, kind: OfficeKind): Uint8Array {
  for (const [part, xml] of changed) {
    const problem = xml === null ? null : xmlProblem(xml);
    if (problem) throw new kind.error(`After the edits, ${part} is not well-formed XML: ${problem} Nothing was saved.`);
  }
  const out: Zippable = {};
  for (const [name, content] of Object.entries(files)) {
    const xml = changed.get(name);
    if (xml === null) continue;
    // Pictures are compressed already.
    out[name] = xml !== undefined ? strToU8(xml) : [content, { level: /\.(png|jpe?g|gif|emf|wmf)$/i.test(name) ? 0 : 6 }];
  }
  const result = zipSync(out);
  if (result.length > MAX_TEMPLATE_FILE_BYTES) throw new kind.error(`After the edits, the file is larger than ${MAX_TEMPLATE_FILE_BYTES / 1024 / 1024} MB.`);
  try {
    kind.read(result);
  } catch (error) {
    throw new kind.error(`After the edits, the file does not read as ${kind.name}: ${error instanceof Error ? error.message : String(error)} Nothing was saved.`);
  }
  return result;
}
