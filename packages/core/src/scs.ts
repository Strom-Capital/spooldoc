import type { SamplePage } from "./sample.js";

/** Options for `parseScs`. */
export interface ParseScsOptions {
  /** Page length in lines. A line past it starts a new page. */
  pageLength?: number;
}

/** Result of `parseScs`. `controls` counts every control seen, for diagnostics. */
export interface ParseScsResult {
  pages: SamplePage[];
  controls: Record<string, number>;
}

const hex = (b: number): string => b.toString(16).toUpperCase().padStart(2, "0");

/**
 * Parses an *SCS print stream into pages of positioned text lines.
 * Printable bytes are decoded in runs through `decode`.
 */
export function parseScs(
  bytes: Uint8Array,
  decode: (bytes: Uint8Array) => string,
  options: ParseScsOptions = {},
): ParseScsResult {
  const pages: SamplePage[] = [];
  const controls: Record<string, number> = {};
  let page = new Map<number, string[]>();
  let line = 1;
  let col = 1;
  const note = (key: string): void => {
    controls[key] = (controls[key] ?? 0) + 1;
  };
  const flush = (): void => {
    const lines = [...page.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([no, chars]) => ({ no, text: Array.from(chars, (c) => c ?? " ").join("").replace(/\s+$/, "") }))
      .filter((l) => l.text.length > 0);
    pages.push({ no: pages.length + 1, lines });
    page = new Map();
  };
  const newPage = (): void => {
    // A form feed before anything was printed does not make an empty first page.
    if (pages.length > 0 || page.size > 0) flush();
    line = 1;
    col = 1;
  };
  const checkOverflow = (): void => {
    const len = options.pageLength;
    if (len === undefined || len <= 0) return;
    while (line > len) {
      const keep = line - len;
      flush();
      line = keep;
    }
  };
  const put = (text: string): void => {
    let chars = page.get(line);
    if (!chars) {
      chars = [];
      page.set(line, chars);
    }
    for (const ch of text) {
      while (chars.length < col - 1) chars.push(" ");
      chars[col - 1] = ch;
      col++;
    }
  };

  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i] as number;
    if (b >= 0x40) {
      let j = i + 1;
      while (j < bytes.length && (bytes[j] as number) >= 0x40) j++;
      put(decode(bytes.subarray(i, j)));
      i = j;
      continue;
    }
    switch (b) {
      case 0x0c:
        note("FF");
        newPage();
        i++;
        continue;
      case 0x15:
        note("NL");
        line++;
        col = 1;
        checkOverflow();
        i++;
        continue;
      case 0x25:
        note("LF");
        line++;
        checkOverflow();
        i++;
        continue;
      case 0x0d:
        note("CR");
        col = 1;
        i++;
        continue;
      case 0x05:
        note("HT");
        col += 8 - ((col - 1) % 8);
        i++;
        continue;
      case 0x16:
        note("BS");
        col = Math.max(1, col - 1);
        i++;
        continue;
      case 0x2b: {
        // 2B <class> <length> <params>: length counts itself and the parameters.
        const cls = bytes[i + 1] ?? 0;
        const len = bytes[i + 2] ?? 0;
        note(`2B${hex(cls)}`);
        i += 2 + Math.max(1, len);
        continue;
      }
      case 0x34: {
        // Presentation position: 34 <function> <value>.
        const fn = bytes[i + 1] ?? 0;
        const v = bytes[i + 2] ?? 0;
        note(`PP${hex(fn)}`);
        if (fn === 0xc0) col = Math.max(1, v);
        else if (fn === 0xc8) col += v;
        else if (fn === 0xc4) {
          if (v < line) {
            flush();
          }
          line = Math.max(1, v);
          col = 1;
          checkOverflow();
        } else if (fn === 0x4c) {
          line += v;
          col = 1;
          checkOverflow();
        }
        i += 3;
        continue;
      }
      default:
        note(`x${hex(b)}`);
        i++;
    }
  }
  if (page.size > 0 && [...page.values()].some((chars) => chars.some((c) => c !== undefined && c.trim() !== ""))) {
    flush();
  }
  return { pages, controls };
}
