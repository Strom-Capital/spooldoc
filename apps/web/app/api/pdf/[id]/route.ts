import { documentName, pageLayout, parseDefinition } from '@spooldoc/core';
import { checkFetchSite, errorResponse, json, redact, workspaceErrorResponse } from '@/lib/server/http';
import { loadPdf } from '@/lib/server/pdf';
import { renderSample } from '@/lib/server/render';

export const dynamic = 'force-dynamic';

/**
 * Document `?document=n` (0-based) of a sample as a PDF, named after the definition's
 * `output.name`. A4 portrait, landscape for pages wider than 160 columns, unless the
 * template sets `@page { size }`. 400 without a linked definition or for a document
 * that does not exist, 422 with `templateErrors` when the definition or template
 * fails, 501 when Chromium is not available.
 */
export async function GET(request: Request, ctx: RouteContext<'/api/pdf/[id]'>): Promise<Response> {
  const refused = checkFetchSite(request);
  if (refused) {
    return refused;
  }
  const { id } = await ctx.params;
  const param = new URL(request.url).searchParams.get('document');
  const document = param === null || param === '' ? 0 : Number(param);
  if (!Number.isInteger(document) || document < 0) {
    return errorResponse(400, 'document must be a document number from 0.');
  }

  let result;
  try {
    result = await renderSample(id, { document });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
  if (!result.definition) {
    return errorResponse(400, 'This sample has no linked definition yet.');
  }
  if (!result.definition.yaml) {
    return errorResponse(400, result.definition.error ?? 'The linked definition is missing.');
  }
  if (result.definition.error || result.template?.error || !result.extract) {
    return json(
      { error: 'The definition or the template has errors.', templateErrors: result.errors },
      { status: 422 },
    );
  }
  const documents = result.extract.documents;
  if (document >= documents.length) {
    return errorResponse(
      400,
      documents.length === 0
        ? 'The definition finds no documents in this sample.'
        : `There is no document ${document}: this sample has ${documents.length} (0 to ${documents.length - 1}).`,
    );
  }
  const html = result.html;
  if (!html) {
    return json({ error: 'Nothing to render.', templateErrors: result.errors }, { status: 422 });
  }

  let filename = `${id}-${document + 1}`;
  try {
    const def = parseDefinition(result.definition.yaml);
    if (def.output?.name) {
      filename = documentName(def, documents[document] ?? {}, document);
    }
  } catch {
    // keep the fallback name
  }
  const layout = pageLayout(html, result.sample.attributes.pageWidth);

  try {
    const { renderPdf } = await loadPdf();
    const pdf = await renderPdf(html, { format: layout.format, landscape: layout.landscape });
    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'PdfUnavailableError') {
      return errorResponse(501, error.message);
    }
    if (error instanceof Error && error.name === 'PdfTimeoutError') {
      return errorResponse(504, error.message);
    }
    return errorResponse(500, `PDF rendering failed: ${redact(error)}`);
  }
}
