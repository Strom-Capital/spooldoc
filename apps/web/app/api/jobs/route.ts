import { z } from 'zod';
import { guard } from '@/lib/server/auth';
import { json, readJson } from '@/lib/server/http';
import { createJob, listJobs } from '@/lib/server/jobs';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().trim().max(120).optional(),
  serverId: z.string().uuid().optional(),
  library: z.string().trim().max(10).optional(),
  queue: z.string().trim().max(10).optional(),
});

/** Every job with its source, mode, active version and last run. */
export async function GET(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  return json({ jobs: await listJobs() });
}

/** Create a job, optionally reading from a queue. */
export async function POST(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const body = await readJson(request, createSchema);
  if ('response' in body) {
    return body.response;
  }
  const { serverId, library, queue, name } = body.data;
  const id = await createJob({ serverId, library: library?.toUpperCase(), queue: queue?.toUpperCase(), name, userId: auth.user.id });
  return json({ id }, { status: 201 });
}
