import { spooledFileIdSchema } from '@spooldoc/core';
import { z } from 'zod';
import { guard } from '@/lib/server/auth';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { getJobRow } from '@/lib/server/jobs';
import { executeRun, startRun } from '@/lib/server/runner';
import { getRun, listRuns } from '@/lib/server/runs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const runSchema = z.object({ splfs: z.array(spooledFileIdSchema).min(1, 'Pick a spooled file').max(50, 'Run at most 50 files at once') });

/** How long the request waits for the runs before it answers with them still running. */
const WAIT_MS = 60_000;

/** The job's runs, newest first. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  return json(await listRuns({ jobId: (await params).id, limit: 50 }));
}

/**
 * Run the active version on the given spooled files, one after another. Waits up to a
 * minute; runs still going then are returned as running and finish on their own.
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
  if (job.activeVersion === null) {
    return errorResponse(409, 'Save a version first: runs use the active version.');
  }
  const body = await readJson(request, runSchema);
  if ('response' in body) {
    return body.response;
  }
  const version = job.activeVersion;
  const started = [];
  for (const splf of body.data.splfs) {
    const req = { jobId: job.id, version, splf, trigger: 'manual' as const, userId: auth.user.id };
    started.push({ ...(await startRun(req)), req });
  }
  const all = (async () => {
    for (const run of started) {
      await executeRun(run.id, run.req);
    }
  })();
  await Promise.race([all, new Promise((resolve) => setTimeout(resolve, WAIT_MS))]);
  const views = await Promise.all(started.map((run) => getRun(run.id)));
  return json({ runs: views.filter(Boolean) }, { status: 201 });
}
