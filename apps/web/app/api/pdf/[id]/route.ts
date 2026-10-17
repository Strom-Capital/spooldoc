import { checkFetchSite, errorResponse, redact, workspaceErrorResponse } from '@/lib/server/http';
import { loadPdf } from '@/lib/server/pdf';
import { renderSample } from '@/lib/server/render';

export const dynamic = 'force-dynamic';

/** The rendered document `?document=n` of a sample as a PDF, or 501 when Chromium is not available. */
export async function GET(request: Request, ctx: RouteContext<'/api/pdf/[id]'>): Promise<Response> {
  const refused = checkFetchSite(request);
  if (refused) {
    return refused;
  }
  const { id } = await ctx.params;
  const value = Number(new URL(request.url).searchParams.get('document') ?? '0');
  const document = Number.isInteger(value) && value >= 0 ? value : 0;
  let html: string | undefined;
  try {
    const result = await renderSample(id, { document });
    html = result.html;
    if (!html) {
      return errorResponse(422, result.errors[0] ?? 'Nothing to render: link a definition and a template first.');
    }
  } catch (error) {
    return workspaceErrorResponse(error);
  }
  try {
    const { renderPdf } = await loadPdf();
    const pdf = await renderPdf(html);
    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${id}-${document + 1}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'PdfUnavailableError') {
      return errorResponse(501, error.message);
    }
    return errorResponse(500, `PDF rendering failed: ${redact(error)}`);
  }
}
