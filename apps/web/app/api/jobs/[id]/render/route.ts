import { z } from 'zod';
import { assetNames, assetResolver } from '@/lib/server/assets';
import { guard } from '@/lib/server/auth';
import { previewRenderer } from '@/lib/server/documents';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { draftAndSample, previewTemplate, previewTemplateFields } from '@/lib/server/job-preview';
import { getJobRow } from '@/lib/server/jobs';
import { renderSample } from '@/lib/server/render';

export const dynamic = 'force-dynamic';

const MAX_TEXT = 2_000_000;

const renderSchema = z.object({
  /** Unsaved editor text; missing means the draft's. */
  yaml: z.string().max(MAX_TEXT).optional(),
  ...previewTemplateFields,
  pageGroup: z.number().int().nonnegative().optional(),
  sampleId: z.string().uuid().optional(),
});

/** Render the preview sample with the draft (or unsaved editor text) with Carbone: HTML from an HTML template, a PDF from a Word template. */
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
  const picked = await previewTemplate(draft, body.data);
  if ('error' in picked) {
    return errorResponse(picked.status, picked.error);
  }
  const assets = (await assetNames()).map((asset) => asset.name);
  return json(
    await renderSample(sample, { yaml, template: picked.content, pageGroup: body.data.pageGroup, asset: await assetResolver(), assets, renderer: await previewRenderer() }),
  );
}
