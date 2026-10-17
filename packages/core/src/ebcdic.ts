import type { SpooledFileAttributes } from "./sample.js";
import { EBCDIC_TABLES } from "./tables.generated.js";

/** Code pages with a built-in decode table. */
export const supportedCodePages: readonly number[] = Object.freeze(
  Object.keys(EBCDIC_TABLES)
    .map(Number)
    .sort((a, b) => a - b),
);

/** Thrown when no decode table exists for a code page. */
export class UnsupportedCodePageError extends Error {
  readonly codePage: number;
  constructor(codePage: number) {
    super(`Unsupported code page ${codePage}. Supported: ${supportedCodePages.join(", ")}`);
    this.name = "UnsupportedCodePageError";
    this.codePage = codePage;
  }
}

/** Decodes a run of single-byte EBCDIC bytes. */
export type Decoder = (bytes: Uint8Array) => string;

/** Returns a decoder for an EBCDIC code page, or throws `UnsupportedCodePageError`. */
export function decoderFor(codePage: number): Decoder {
  const table = EBCDIC_TABLES[codePage];
  if (table === undefined) throw new UnsupportedCodePageError(codePage);
  return (bytes: Uint8Array): string => {
    let out = "";
    for (const b of bytes) out += table[b];
    return out;
  };
}

/** Returns an encoder (the inverse of the decode table). Characters with no byte throw. */
export function encoderFor(codePage: number): (text: string) => Uint8Array {
  const table = EBCDIC_TABLES[codePage];
  if (table === undefined) throw new UnsupportedCodePageError(codePage);
  const map = new Map<string, number>();
  for (let b = 0; b < 256; b++) {
    const ch = table[b];
    if (ch !== undefined && ch !== "�" && !map.has(ch)) map.set(ch, b);
  }
  return (text: string): Uint8Array => {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      const ch = text[i] ?? "";
      const b = map.get(ch);
      if (b === undefined) throw new Error(`Character ${JSON.stringify(ch)} has no byte in code page ${codePage}`);
      out[i] = b;
    }
    return out;
  };
}

/** Where a resolved code page came from. */
export type CodePageSource = "chrid" | "job" | "fallback";

/**
 * Picks the code page to decode a spooled file with: the CHRID code page when present
 * (and not 0 or 65535), else the job CCSID when supported, else `fallback`, else throws.
 */
export function resolveCodePage(
  attrs: SpooledFileAttributes,
  fallback?: number,
): { codePage: number; source: CodePageSource } {
  const chrid = attrs.chrid?.codePage;
  if (chrid !== undefined && chrid !== 0 && chrid !== 65535) {
    if (!supportedCodePages.includes(chrid)) throw new UnsupportedCodePageError(chrid);
    return { codePage: chrid, source: "chrid" };
  }
  if (attrs.jobCcsid !== null && supportedCodePages.includes(attrs.jobCcsid)) {
    return { codePage: attrs.jobCcsid, source: "job" };
  }
  if (fallback !== undefined) {
    if (!supportedCodePages.includes(fallback)) throw new UnsupportedCodePageError(fallback);
    return { codePage: fallback, source: "fallback" };
  }
  throw new UnsupportedCodePageError(chrid ?? attrs.jobCcsid ?? 0);
}
