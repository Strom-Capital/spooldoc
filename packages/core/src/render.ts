import { carboneRender, type CarboneServer } from "./carbone.js";
import { docxConverter, readDocx } from "./docx.js";
import { pdfLandscape, prepareHtml, type AssetResolver, type TemplateData } from "./template.js";

/** One document to render from an HTML template: its data and the format to make. */
export interface HtmlRender {
  kind?: "html";
  template: string;
  data: TemplateData;
  format: "html" | "pdf";
  /** Columns of the spooled file page: wider than 160 prints landscape, unless the template sets `@page` size. */
  pageWidth?: number | null;
  /** Resolves `{asset('name')}`. */
  asset?: AssetResolver;
}

/**
 * One document to render from a Word template (the `.docx` file's bytes): its data and
 * the format to make. `png` is a picture of page 1, made by LibreOffice, for previews.
 */
export interface DocxRender {
  kind: "docx";
  template: Uint8Array;
  data: TemplateData;
  format: "docx" | "pdf" | "png";
  /** The PDF converter; `docxConverter` picks it from the template when not given. */
  converter?: "I" | "L";
}

/** One document to render with Carbone. */
export type DocumentRender = HtmlRender | DocxRender;

/**
 * Renders one document with Carbone. HTML: as it is, or a PDF with the Chromium
 * converter. Word: a DOCX with `hardRefresh: false`, so Carbone Enterprise and Community
 * return the same file and Word fills in page fields when it opens it, or a PDF with ICE
 * or LibreOffice (`docxConverter`), or a PNG of page 1 with LibreOffice (ICE makes no
 * pictures). Check the template with `checkTemplate` or
 * `checkDocx` first; Carbone prints some mistakes silently.
 *
 * @throws CarboneError, or Error for an asset that is not uploaded or a file that is not a `.docx`
 */
export async function renderDocument(server: CarboneServer, input: DocumentRender): Promise<Uint8Array> {
  if (input.kind === "docx") {
    if (input.format === "docx") {
      return carboneRender(server, { template: input.template, data: input.data, convertTo: "docx", hardRefresh: false });
    }
    if (input.format === "png") {
      return carboneRender(server, { template: input.template, data: input.data, convertTo: "png" });
    }
    const converter = input.converter ?? docxConverter(readDocx(input.template));
    return carboneRender(server, { template: input.template, data: input.data, convertTo: "pdf", converter });
  }
  const pdf = input.format === "pdf";
  const template = prepareHtml(input.template, { asset: input.asset, landscape: pdf && pdfLandscape(input.template, input.pageWidth) });
  return carboneRender(server, { template, data: input.data, convertTo: input.format, ...(pdf ? { converter: "C" as const } : {}) });
}

/**
 * The number of pages of a PDF, from its page tree: the largest `/Count`, or the number
 * of `/Type /Page` objects. Null when neither can be read, such as when the page tree is
 * in a compressed object stream.
 */
export function pdfPageCount(pdf: Uint8Array): number | null {
  const text = Buffer.from(pdf).toString("latin1");
  let count = 0;
  for (const match of text.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g)) {
    count = Math.max(count, Number(match[1] ?? match[2]));
  }
  if (count > 0) return count;
  const pages = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
  return pages > 0 ? pages : null;
}
