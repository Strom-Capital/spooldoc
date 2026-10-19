/**
 * Small HTML scanning helpers that run in one pass. Templates are user input, so they
 * avoid regular expressions such as `/<body\b[^>]*>/`, which are slow on many tags that
 * never close.
 */

/** The text with ASCII capitals lower-cased, so every index stays the same. */
export const asciiLower = (text: string): string => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** A tag in HTML text: where it starts, where it ends (after `>`), and whether it is a closing tag. */
export interface HtmlTag {
  start: number;
  end: number;
  closing: boolean;
}

/** The opening and closing tags with this name, in order: `<tr ...>` and `</tr>`. */
export function* htmlTags(text: string, name: string): Generator<HtmlTag> {
  const lower = asciiLower(text);
  const wanted = asciiLower(name);
  for (let i = lower.indexOf("<"); i !== -1; ) {
    const closing = lower[i + 1] === "/";
    const at = i + (closing ? 2 : 1);
    const after = lower[at + wanted.length];
    if (lower.startsWith(wanted, at) && after !== undefined && !/[\w-]/.test(after)) {
      const end = text.indexOf(">", at + wanted.length);
      if (end === -1) return;
      yield { start: i, end: end + 1, closing };
      i = lower.indexOf("<", end + 1);
    } else {
      i = lower.indexOf("<", i + 1);
    }
  }
}

/** The first opening (or closing) tag with this name, or undefined. */
export function firstTag(text: string, name: string, closing = false): HtmlTag | undefined {
  for (const tag of htmlTags(text, name)) if (tag.closing === closing) return tag;
  return undefined;
}
