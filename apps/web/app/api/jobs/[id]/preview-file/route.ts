import { isCarboneError, readDocx, starterDocx, templateData } from '@spooldoc/core';
import { z } from 'zod';
import { FORMAT_FILES, KIND_FORMATS, formatList, outputFileName } from '@/lib/job-spec';
import { assetNames, assetResolver } from '@/lib/server/assets';
import { guard } from '@/lib/server/auth';
import { fileNameFor, previewRenderer, tryDefinition } from '@/lib/server/documents';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { draftAndSample, previewTemplate, previewTemplateFields } from '@/lib/server/job-preview';
import { getJobRow } from '@/lib/server/jobs';
import { CARBONE_NOT_CONNECTED, renderSample } from '@/lib/server/render';

export const dynamic = 'force-dynamic';

const MAX_TEXT = 2_000_000;

const fileSchema = z.object({
  yaml: z.string().max(MAX_TEXT).optional(),
  ...previewTemplateFields,
  document: z.number().int().nonnegative().default(0),
  /** A PDF, or the filled-in DOCX of a Word template. HTML is the render's own result. */
  format: z.enum(['pdf', 'docx']).default('pdf'),
});

/**
 * One document of the preview sample as a PDF, or as a DOCX from a Word template, from
 * the draft or unsaved editor text, rendered by Carbone. 400 when there is no such document
 * or the template does not make the format, 422 with `templateErrors` when the definition
 * or template fails, 503 when Carbone is not connected or does not answer.
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
  const body = await readJson(request, fileSchema);
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
  const picked = await previewTemplate(draft, body.data);
  if ('error' in picked) {
    return errorResponse(picked.status, picked.error);
  }
  const { template } = picked;
  const output = picked.output ?? draft.render.outputs[0]!;
  const { document, format } = body.data;
  if (!KIND_FORMATS[template.kind].includes(format)) {
    return errorResponse(400, `${template.kind === 'docx' ? 'A Word' : 'An HTML'} template makes ${formatList(KIND_FORMATS[template.kind])} files.`);
  }
  const renderer = await previewRenderer();
  if (!renderer) {
    return errorResponse(503, CARBONE_NOT_CONNECTED);
  }
  const asset = await assetResolver();
  const assets = (await assetNames()).map((entry) => entry.name);
  // Checks the template and renders it first (HTML, or a PDF of a Word template), so a file is only made from a template that works.
  const result = await renderSample(sample, { yaml, template, document, asset, assets, renderer });
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
  if ((!result.html && !result.pdf) || !result.template) {
    return json({ error: 'Nothing to render.', templateErrors: result.errors }, { status: 422 });
  }
  const filename = outputFileName(
    fileNameFor(tryDefinition(yaml), documents[document] ?? {}, document, sample.splf.name.toLowerCase()),
    draft.render.outputs,
    output,
  );
  const send = (content: Uint8Array) =>
    new Response(Buffer.from(content), {
      headers: {
        'Content-Type': FORMAT_FILES[format].contentType,
        'Content-Disposition': `attachment; filename="${filename}.${FORMAT_FILES[format].extension}"`,
        'Cache-Control': 'no-store',
      },
    });
  const doc = documents[document] ?? {};
  try {
    if (result.template.kind === 'html') {
      const html = result.template.html;
      return send(await renderer({ template: html, data: templateData(html, doc, documents, sample), format: 'pdf', pageWidth: sample.attributes.pageWidth, asset }));
    }
    if (format === 'pdf' && result.pdf) {
      return send(Buffer.from(result.pdf, 'base64'));
    }
    const def = tryDefinition(yaml);
    const bytes = template.kind === 'docx' && template.file ? template.file.content : def ? await starterDocx(def) : null;
    if (!bytes) {
      return json({ error: 'Nothing to render.', templateErrors: result.errors }, { status: 422 });
    }
    return send(await renderer({ kind: 'docx', template: bytes, data: templateData(readDocx(bytes), doc, documents, sample), format: 'docx' }));
  } catch (error) {
    const message = error instanceof Error ? error.message : `Carbone could not render the ${FORMAT_FILES[format].label}.`;
    const detail = isCarboneError(error) ? error.detail : undefined;
    const status = isCarboneError(error) && ['template', 'edition', 'file'].includes(error.kind) ? 422 : 503;
    return json({ error: message, ...(detail ? { detail } : {}) }, { status });
  }
}
