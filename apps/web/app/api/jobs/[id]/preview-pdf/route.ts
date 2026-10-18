import { z } from 'zod';
import { assetResolver } from '@/lib/server/assets';
import { guard } from '@/lib/server/auth';
import { fileNameFor, htmlToPdf, tryDefinition } from '@/lib/server/documents';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { draftAndSample } from '@/lib/server/job-preview';
import { getJobRow } from '@/lib/server/jobs';
import { pdfErrorStatus } from '@/lib/server/pdf';
import { renderSample } from '@/lib/server/render';

export const dynamic = 'force-dynamic';

const MAX_TEXT = 2_000_000;

const pdfSchema = z.object({
  yaml: z.string().max(MAX_TEXT).optional(),
  html: z.string().max(MAX_TEXT).nullable().optional(),
  document: z.number().int().nonnegative().default(0),
});

/**
 * One document of the preview sample as a PDF, from the draft or unsaved editor text.
 * 400 when there is no such document, 422 with `templateErrors` when the definition or
 * template fails, 501 without Chromium.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const job = await getJobRow((await params).id);
  if (!job) {
    return errorResponse(404, 'Job not found.');
  }
  const body = await readJson(request, pdfSchema);
  if ('response' in body) {
    return body.response;
  }
  const { draft, sample } = await draftAndSample(job);
  if (!sample) {
    return errorResponse(404, 'Pick a spooled file to preview first.');
  }
  const yaml = body.data.yaml ?? draft.extract.definition;
  if (!yaml.trim()) {
    return errorResponse(400, 'Write a definition first.');
  }
  const html = body.data.html === undefined ? draft.render.template : body.data.html;
  const { document } = body.data;
  const result = renderSample(sample, { yaml, html, document, asset: await assetResolver() });
  if (result.definition?.error || result.template?.error || !result.extract) {
    return json({ error: 'The definition or the template has errors.', templateErrors: result.errors }, { status: 422 });
  }
  const documents = result.extract.documents;
  if (document >= documents.length) {
    return errorResponse(
      400,
      documents.length === 0
        ? 'The definition finds no documents in this spooled file.'
        : `There is no document ${document + 1}: this spooled file has ${documents.length}.`,
    );
  }
  if (!result.html) {
    return json({ error: 'Nothing to render.', templateErrors: result.errors }, { status: 422 });
  }
  const filename = fileNameFor(tryDefinition(yaml), documents[document] ?? {}, document, sample.splf.name.toLowerCase());
  try {
    const pdf = await htmlToPdf(result.html, sample.attributes.pageWidth);
    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const { status, message } = pdfErrorStatus(error);
    return errorResponse(status, message);
  }
}
