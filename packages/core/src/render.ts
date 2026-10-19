import { carboneRender, type CarboneServer } from "./carbone.js";
import { pdfLandscape, prepareHtml, type AssetResolver, type TemplateData } from "./template.js";

/** One document to render: a Carbone HTML template, its data and the format to make. */
export interface DocumentRender {
  template: string;
  data: TemplateData;
  format: "html" | "pdf";
  /** Columns of the spooled file page: wider than 160 prints landscape, unless the template sets `@page` size. */
  pageWidth?: number | null;
  /** Resolves `{asset('name')}`. */
  asset?: AssetResolver;
}

/**
 * Renders one document with Carbone: HTML as it is, PDF with the Chromium converter.
 * Check the template with `checkTemplate` first; Carbone prints some mistakes silently.
 *
 * @throws CarboneError, or Error for an asset that is not uploaded
 */
export async function renderDocument(server: CarboneServer, input: DocumentRender): Promise<Uint8Array> {
  const pdf = input.format === "pdf";
  const template = prepareHtml(input.template, { asset: input.asset, landscape: pdf && pdfLandscape(input.template, input.pageWidth) });
  return carboneRender(server, { template, data: input.data, convertTo: input.format, ...(pdf ? { converter: "C" as const } : {}) });
}
