import { z } from 'zod';
import { assetResolver } from '@/lib/server/assets';
import { guard } from '@/lib/server/auth';
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
});

/** Render the preview sample with the draft (or unsaved editor text). */
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
  const html = body.data.html === undefined ? draft.render.template : body.data.html;
  return json(renderSample(sample, { yaml, html, document: body.data.document, asset: await assetResolver() }));
}
