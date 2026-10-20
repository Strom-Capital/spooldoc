import { parseDefinition, starterDocx, type Definition } from '@spooldoc/core';
import { z } from 'zod';
import { FORMAT_FILES } from '@/lib/job-spec';
import { guard } from '@/lib/server/auth';
import { errorResponse, readJson } from '@/lib/server/http';
import { draftAndSample } from '@/lib/server/job-preview';
import { getJobRow } from '@/lib/server/jobs';

export const dynamic = 'force-dynamic';

const starterSchema = z.object({
  /** Unsaved editor text; missing means the draft's. */
  yaml: z.string().max(2_000_000).optional(),
});

/**
 * The Word starter template for the job's definition (or unsaved definition text), to
 * open in Word, change and upload. 400 when there is no definition or it does not parse.
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
  const body = await readJson(request, starterSchema);
  if ('response' in body) {
    return body.response;
  }
  const { draft } = await draftAndSample(job);
  const yaml = body.data.yaml ?? draft.extract.definition;
  if (!yaml.trim()) {
    return errorResponse(400, 'Write a definition first: the starter template is made from it.');
  }
  let def: Definition;
  try {
    def = parseDefinition(yaml);
  } catch (error) {
    return errorResponse(400, `Fix the definition first: ${error instanceof Error ? error.message : String(error)}`);
  }
  return new Response(Buffer.from(await starterDocx(def)), {
    headers: {
      'Content-Type': FORMAT_FILES.docx.contentType,
      'Content-Disposition': `attachment; filename="${def.type}-template.docx"`,
      'Cache-Control': 'no-store',
    },
  });
}
