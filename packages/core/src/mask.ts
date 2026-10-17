import type { SamplePage } from "./sample.js";

/** Options for `maskPages`. */
export interface MaskOptions {
  /** Tokens matching any of these are kept as they are. */
  keep?: RegExp[];
}

interface Token {
  start: number;
  text: string;
}

function tokens(line: string): Token[] {
  const out: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push({ start: m.index, text: m[0] });
  return out;
}

/** Masks one value the way `maskPages` masks a token: digits become 9, letters X or x. */
export function maskText(text: string): string {
  return text.replace(/\p{Nd}|\p{L}/gu, (c) => (/\p{Nd}/u.test(c) ? "9" : /\p{Lu}/u.test(c) ? "X" : "x"));
}

const maskToken = maskText;

/**
 * Masks the values on pages so the layout can be shown to a model without real data.
 * Digits become 9 and letters X or x; punctuation, spaces, positions and lengths stay.
 * Kept as they are: tokens at the same column on at least half of the pages and on at
 * least two pages (labels), tokens ending in `:`, and tokens matching `keep`.
 */
export function maskPages(pages: SamplePage[], options: MaskOptions = {}): SamplePage[] {
  const keep = options.keep ?? [];
  const seen = new Map<string, Set<number>>();
  pages.forEach((page, pi) => {
    for (const l of page.lines) {
      for (const t of tokens(l.text)) {
        const key = `${t.start}\u0000${t.text}`;
        let set = seen.get(key);
        if (!set) seen.set(key, (set = new Set()));
        set.add(pi);
      }
    }
  });
  const threshold = Math.max(2, Math.ceil(pages.length / 2));
  const isLabel = (t: Token): boolean =>
    ((seen.get(`${t.start}\u0000${t.text}`)?.size ?? 0) >= threshold) ||
    t.text.endsWith(":") ||
    keep.some((re) => {
      re.lastIndex = 0;
      return re.test(t.text);
    });
  return pages.map((page) => ({
    no: page.no,
    lines: page.lines.map((l) => {
      let text = l.text;
      for (const t of tokens(l.text)) {
        if (isLabel(t)) continue;
        text = text.slice(0, t.start) + maskToken(t.text) + text.slice(t.start + t.text.length);
      }
      return { no: l.no, text };
    }),
  }));
}
