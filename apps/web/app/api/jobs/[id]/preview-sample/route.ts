import { spooledFileIdSchema } from '@spooldoc/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { jobSpecSchema } from '@/lib/job-spec';
import { guard } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { jobs } from '@/lib/server/db/schema';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { withConnection } from '@/lib/server/ibmi';
import { getJobRow } from '@/lib/server/jobs';
import { sampleView } from '@/lib/server/render';
import { capture, storeSample } from '@/lib/server/samples';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({ splf: spooledFileIdSchema });

/**
 * Read a spooled file of the job's source queue and make it the draft's preview. This
 * only reads: the file is never held, moved or deleted.
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
  const body = await readJson(request, requestSchema);
  if ('response' in body) {
    return body.response;
  }
  const draft = jobSpecSchema.parse(job.draft);
  const serverId = draft.source.serverId;
  if (!serverId) {
    return errorResponse(400, 'Pick the source server first.');
  }
  return withConnection(serverId, async (conn, server) => {
    let captured;
    try {
      captured = await capture(conn, server.host, body.data.splf);
    } catch (error) {
      if (error instanceof Error && error.name === 'UnsupportedCodePageError') {
        return errorResponse(422, `${error.message}. Set SPOOLDOC_DEFAULT_CCSID to decode it anyway.`);
      }
      throw error;
    }
    const sample = await storeSample(server.id, captured);
    const next = { ...draft, preview: { sampleId: sample.id } };
    await getDb().update(jobs).set({ draft: next }).where(eq(jobs.id, job.id));
    return json({ sample: sampleView(sample), warnings: captured.warnings }, { status: 201 });
  });
}
