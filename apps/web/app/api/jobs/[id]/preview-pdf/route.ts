import { isCarboneError, templateData } from '@spooldoc/core';
import { z } from 'zod';
import { findOutput, outputFileName } from '@/lib/job-spec';
import { assetNames, assetResolver } from '@/lib/server/assets';
import { guard } from '@/lib/server/auth';
import { fileNameFor, previewRenderer, tryDefinition } from '@/lib/server/documents';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { draftAndSample } from '@/lib/server/job-preview';
import { getJobRow } from '@/lib/server/jobs';
import { CARBONE_NOT_CONNECTED, renderSample } from '@/lib/server/render';

export const dynamic = 'force-dynamic';

const MAX_TEXT = 2_000_000;

const pdfSchema = z.object({
  yaml: z.string().max(MAX_TEXT).optional(),
  html: z.string().max(MAX_TEXT).nullable().optional(),
  document: z.number().int().nonnegative().default(0),
  /** The output whose template is the draft's; missing means the first. */
  outputId: z.string().max(40).optional(),
});

/**
 * One document of the preview sample as a PDF, from the draft or unsaved editor text,
 * rendered by Carbone. 400 when there is no such document, 422 with `templateErrors` when
 * the definition or template fails, 503 when Carbone is not connected or does not answer.
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
  const output = findOutput(draft.render.outputs, body.data.outputId);
  if (!output) {
    return errorResponse(404, `The job has no output ${body.data.outputId}.`);
  }
  const renderer = await previewRenderer();
  if (!renderer) {
    return errorResponse(503, CARBONE_NOT_CONNECTED);
  }
  const html = body.data.html === undefined ? output.template.source : body.data.html;
  const { document } = body.data;
  const asset = await assetResolver();
  const assets = (await assetNames()).map((entry) => entry.name);
  // Checks the template and renders the HTML first, so a PDF is only made from a template that works.
  const result = await renderSample(sample, { yaml, html, document, asset, assets, renderer });
  if (result.carbone) {
    return json({ error: result.carbone.error, ...(result.carbone.detail ? { detail: result.carbone.detail } : {}) }, { status: 503 });
  }
  if (result.definition?.error || result.template?.error || !result.extract) {
    return json(
      { error: 'The definition or the template has errors.', templateErrors: result.errors, ...(result.template?.detail ? { detail: result.template.detail } : {}) },
      { status: 422 },
    );
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
  if (!result.html || !result.template) {
    return json({ error: 'Nothing to render.', templateErrors: result.errors }, { status: 422 });
  }
  const filename = outputFileName(
    fileNameFor(tryDefinition(yaml), documents[document] ?? {}, document, sample.splf.name.toLowerCase()),
    draft.render.outputs,
    output,
  );
  const template = result.template.html;
  try {
    const pdf = await renderer({
      template,
      data: templateData(template, documents[document] ?? {}, documents, sample),
      format: 'pdf',
      pageWidth: sample.attributes.pageWidth,
      asset,
    });
    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Carbone could not render the PDF.';
    const detail = isCarboneError(error) ? error.detail : undefined;
    const status = isCarboneError(error) && ['template', 'edition', 'file'].includes(error.kind) ? 422 : 503;
    return json({ error: message, ...(detail ? { detail } : {}) }, { status });
  }
}
