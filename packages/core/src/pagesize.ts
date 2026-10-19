/** Paper setup for a PDF: the paper format and its orientation. */
export interface PageLayout {
  format: "A4";
  landscape: boolean;
  /** True when the template sets `@page { size: ... }`; Chromium then uses that size. */
  fromTemplate: boolean;
}

/** Printed pages wider than this many columns are wide reports and print landscape. */
export const WIDE_PAGE_COLUMNS = 160;

// One way to match each number, so a long run of digits can't make it backtrack.
const LENGTH = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(mm|cm|in|pt|pc|px|q)$/i;
const TO_MM: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, q: 0.25 };

function toMm(value: string): number | undefined {
  const m = LENGTH.exec(value);
  return m ? Number(m[1]) * (TO_MM[(m[2] as string).toLowerCase()] as number) : undefined;
}

/**
 * CSS text without its `/* ... *\/` comments. A loop, not a lazy regular expression,
 * which is slow on a template with many unclosed comments.
 */
function withoutComments(css: string): string {
  let out = "";
  let from = 0;
  for (let start = css.indexOf("/*"); start !== -1; start = css.indexOf("/*", from)) {
    const end = css.indexOf("*/", start + 2);
    if (end === -1) break;
    out += css.slice(from, start);
    from = end + 2;
  }
  return out + css.slice(from);
}

/**
 * The `size` value of the template's `@page` rule, or undefined when there is none.
 * Only page rules without a page selector count (`@page :first` and named pages are skipped).
 */
export function cssPageSize(html: string): string | undefined {
  // Read with indexOf, not a regular expression: templates are user input, and a pattern
  // such as /@page\s*\{([^}]*)\}/ is slow on many rules that never close.
  const text = withoutComments(html);
  // ASCII only, so every index in `lower` is the same in `text`.
  const lower = text.replace(/[A-Z]/g, (c) => c.toLowerCase());
  let size: string | undefined;
  let from = 0;
  for (let at = lower.indexOf("@page", from); at !== -1; at = lower.indexOf("@page", from)) {
    let open = at + "@page".length;
    while (open < text.length && /\s/.test(text[open] as string)) open++;
    from = open;
    if (text[open] !== "{") continue;
    const close = text.indexOf("}", open + 1);
    if (close === -1) break;
    from = close + 1;
    // The first `size` declaration of the rule.
    for (const declaration of text.slice(open + 1, close).split(";")) {
      const colon = declaration.indexOf(":");
      if (colon === -1 || declaration.slice(0, colon).trim().toLowerCase() !== "size") continue;
      const value = declaration.slice(colon + 1).replace(/!important/i, "").trim();
      if (value) {
        size = value;
        break;
      }
    }
  }
  return size;
}

/**
 * Paper for a document: A4 portrait by default, landscape when the printed page is
 * wider than 160 columns. A `size` in the template's `@page` rule wins: landscape when
 * it says `landscape` or gives a width larger than the height.
 *
 * @param html - The rendered HTML (or the template)
 * @param pageWidth - Columns of the spooled file page, when known
 */
export function pageLayout(html: string, pageWidth?: number | null): PageLayout {
  const size = cssPageSize(html);
  if (size) {
    const words = size.toLowerCase().split(/\s+/);
    if (words.includes("landscape")) return { format: "A4", landscape: true, fromTemplate: true };
    const lengths = words.map(toMm).filter((v): v is number => v !== undefined);
    const landscape = lengths.length === 2 && (lengths[0] as number) > (lengths[1] as number);
    return { format: "A4", landscape, fromTemplate: true };
  }
  return { format: "A4", landscape: (pageWidth ?? 0) > WIDE_PAGE_COLUMNS, fromTemplate: false };
}
