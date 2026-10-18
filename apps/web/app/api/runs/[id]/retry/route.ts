import { eq } from 'drizzle-orm';
import { guard } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { runs } from '@/lib/server/db/schema';
import { errorResponse, json } from '@/lib/server/http';
import { getJobRow } from '@/lib/server/jobs';
import { runJob } from '@/lib/server/runner';
import { getRun, uuidOrNull } from '@/lib/server/runs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Run the same spooled file again with the job's active version. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const id = uuidOrNull((await params).id);
  const [old] = id ? await getDb().select().from(runs).where(eq(runs.id, id)) : [];
  if (!old) {
    return errorResponse(404, 'Run not found.');
  }
  const job = await getJobRow(old.jobId);
  if (!job || job.activeVersion === null) {
    return errorResponse(409, 'The job has no active version.');
  }
  const runId = await runJob({ jobId: job.id, version: job.activeVersion, splf: old.splf, trigger: 'manual', userId: auth.user.id });
  return json(await getRun(runId), { status: 201 });
}
