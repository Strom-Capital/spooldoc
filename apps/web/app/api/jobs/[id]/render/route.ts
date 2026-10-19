import { z } from 'zod';
import { findOutput } from '@/lib/job-spec';
import { assetNames, assetResolver } from '@/lib/server/assets';
import { guard } from '@/lib/server/auth';
import { previewRenderer } from '@/lib/server/documents';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { draftAndSample } from '@/lib/server/job-preview';
import { getJobRow } from '@/lib/server/jobs';
import { renderSample } from '@/lib/server/render';

export const dynamic = 'force-dynamic';

const MAX_TEXT = 2_000_000;

const renderSchema = z.object({
  /** Unsaved editor text; missing means the draft's. `html: null` means the starter template. */
  yaml: z.string().max(MAX_TEXT).optional(),
  html: z.string().max(MAX_TEXT).nullable().optional(),
  document: z.number().int().nonnegative().optional(),
  sampleId: z.string().uuid().optional(),
  /** The output whose draft template is rendered when `html` is missing; missing means the first. */
  outputId: z.string().max(40).optional(),
});

/** Render the preview sample with the draft (or unsaved editor text), to HTML with Carbone. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const job = await getJobRow((await params).id);
  if (!job) {
    return errorResponse(404, 'Job not found.');
  }
  const body = await readJson(request, renderSchema);
  if ('response' in body) {
    return body.response;
  }
  const { draft, sample } = await draftAndSample(job, body.data.sampleId);
  if (!sample) {
    return errorResponse(404, 'Pick a spooled file to preview first.');
  }
  const yaml = body.data.yaml ?? draft.extract.definition;
  // Unsaved editor text wins, so an output added a moment ago renders before its draft is saved.
  let html = body.data.html;
  if (html === undefined) {
    const output = findOutput(draft.render.outputs, body.data.outputId);
    if (!output) {
      return errorResponse(404, `The job has no output ${body.data.outputId}.`);
    }
    html = output.template.source;
  }
  const assets = (await assetNames()).map((asset) => asset.name);
  return json(await renderSample(sample, { yaml, html, document: body.data.document, asset: await assetResolver(), assets, renderer: await previewRenderer() }));
}
