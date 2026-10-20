import { carboneRender, type CarboneServer } from "./carbone.js";
import { docxConverter, readDocx } from "./docx.js";
import { pdfLandscape, prepareHtml, type AssetResolver, type DocumentData, type TemplateData } from "./template.js";
import { readXlsx, xlsxHardRefresh } from "./xlsx.js";

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

/**
 * One document to render from an Excel template (the `.xlsx` file's bytes): its data, of
 * one page group or of the whole spooled file, and the format to make.
 */
export interface XlsxRender {
  kind: "xlsx";
  template: Uint8Array;
  data: DocumentData;
  format: "xlsx" | "pdf";
}

/** One document to render with Carbone. */
export type DocumentRender = HtmlRender | DocxRender | XlsxRender;

/**
 * Renders one document with Carbone. HTML: as it is, or a PDF with the Chromium
 * converter. Word: a DOCX with `hardRefresh: false`, so Carbone Enterprise and Community
 * return the same file and Word fills in page fields when it opens it, or a PDF with ICE
 * or LibreOffice (`docxConverter`), or a PNG of page 1 with LibreOffice (ICE makes no
 * pictures). Excel: an XLSX, passed through LibreOffice when `xlsxHardRefresh` says so,
 * or a PDF with LibreOffice, which follows each sheet's page setup. Check the template
 * with `checkTemplate`, `checkDocx` or `checkXlsx` first; Carbone prints some mistakes
 * silently.
 *
 * @throws CarboneError, or Error for an asset that is not uploaded or a file that is not a `.docx` or `.xlsx`
 */
export async function renderDocument(server: CarboneServer, input: DocumentRender): Promise<Uint8Array> {
  if (input.kind === "xlsx") {
    if (input.format === "xlsx") {
      return carboneRender(server, { template: input.template, data: input.data, convertTo: "xlsx", hardRefresh: xlsxHardRefresh(readXlsx(input.template)) });
    }
    return carboneRender(server, { template: input.template, data: input.data, convertTo: "pdf", converter: "L" });
  }
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

/** How far from a `/Count` its dictionary's `<<` and `>>` are looked for. A page tree's is far shorter. */
const DICT_REACH = 2000;

/**
 * The number of pages of a PDF, from its page tree: the largest `/Count` in a dictionary
 * with `/Type /Pages`, or the number of `/Type /Page` objects. Null when neither can be
 * read, such as when the page tree is in a compressed object stream. Each `/Count` is
 * checked against its own dictionary only, so the scan stays linear on any input.
 */
export function pdfPageCount(pdf: Uint8Array): number | null {
  const text = Buffer.from(pdf).toString("latin1");
  let count = 0;
  for (let at = text.indexOf("/Count"); at !== -1; at = text.indexOf("/Count", at + 6)) {
    const number = /^\s*(\d{1,9})/.exec(text.slice(at + 6, at + 30));
    if (!number) continue;
    // The dictionary around it: from the nearest `<<` before to the nearest `>>` after,
    // looked for within a page tree's size, so no search runs over the whole file.
    const before = text.slice(Math.max(0, at - DICT_REACH), at);
    const after = text.slice(at, at + DICT_REACH);
    const start = before.lastIndexOf("<<");
    const end = after.indexOf(">>");
    if (start === -1 || end === -1) continue;
    if (/\/Type\s{0,8}\/Pages(?![a-zA-Z])/.test(before.slice(start) + after.slice(0, end))) count = Math.max(count, Number(number[1]));
  }
  if (count > 0) return count;
  const pages = text.match(/\/Type\s{0,8}\/Page(?![a-zA-Z])/g)?.length ?? 0;
  return pages > 0 ? pages : null;
}
