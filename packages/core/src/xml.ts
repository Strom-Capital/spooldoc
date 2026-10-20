/** Small helpers for the XML in Office files, shared by the Word and Excel readers. */

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** XML text with its entities written out. A loop, so a stray `&` costs nothing. */
export function decodeXml(text: string): string {
  if (!text.includes("&")) return text;
  let out = "";
  let from = 0;
  for (let at = text.indexOf("&"); at !== -1; at = text.indexOf("&", at + 1)) {
    const end = text.indexOf(";", at);
    if (end === -1 || end - at > 10) continue;
    const name = text.slice(at + 1, end);
    let value = ENTITIES[name];
    if (value === undefined && name.startsWith("#")) {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      if (Number.isInteger(code) && code >= 0 && code <= 0x10ffff) value = String.fromCodePoint(code);
    }
    if (value === undefined) continue;
    out += text.slice(from, at) + value;
    from = end + 1;
    at = end;
  }
  return out + text.slice(from);
}

/** Text written for XML, in an element or an attribute. */
export function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The value of an attribute in an XML tag's text, in double or single quotes, or undefined. Found with `indexOf`: `name` is matched as text. */
export function xmlAttribute(tag: string, name: string): string | undefined {
  for (const quote of ['"', "'"]) {
    const wanted = `${name}=${quote}`;
    for (let at = tag.indexOf(wanted); at !== -1; at = tag.indexOf(wanted, at + 1)) {
      // The name starts after whitespace, so `r` does not match `ref="` or `xr:r="`.
      if (at === 0 || !" \t\r\n".includes(tag[at - 1] as string)) continue;
      const start = at + wanted.length;
      const end = tag.indexOf(quote, start);
      return end === -1 ? undefined : decodeXml(tag.slice(start, end));
    }
  }
  return undefined;
}

/** True when the bytes start like a zip file. */
export const isZip = (bytes: Uint8Array): boolean => bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

/** True when the bytes start like an OLE file: a Word 97-2003 or Excel 97-2003 file. */
export const isOle = (bytes: Uint8Array): boolean => bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
