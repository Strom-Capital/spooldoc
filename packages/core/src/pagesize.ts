/** Paper setup for a PDF: the paper format and its orientation. */
export interface PageLayout {
  format: "A4";
  landscape: boolean;
  /** True when the template sets `@page { size: ... }`; Chromium then uses that size. */
  fromTemplate: boolean;
}

/** Printed pages wider than this many columns are wide reports and print landscape. */
export const WIDE_PAGE_COLUMNS = 160;

const LENGTH = /^(-?\d*\.?\d+)(mm|cm|in|pt|pc|px|q)$/i;
const TO_MM: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, q: 0.25 };

function toMm(value: string): number | undefined {
  const m = LENGTH.exec(value);
  return m ? Number(m[1]) * (TO_MM[(m[2] as string).toLowerCase()] as number) : undefined;
}

/**
 * The `size` value of the template's `@page` rule, or undefined when there is none.
 * Only page rules without a page selector count (`@page :first` and named pages are skipped).
 */
export function cssPageSize(html: string): string | undefined {
  const text = html.replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = /@page\s*\{([^}]*)\}/gi;
  let size: string | undefined;
  for (let m = rule.exec(text); m; m = rule.exec(text)) {
    const decl = /(?:^|;)\s*size\s*:\s*([^;]+)/i.exec(m[1] as string);
    if (decl) size = (decl[1] as string).replace(/!important/i, "").trim();
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
