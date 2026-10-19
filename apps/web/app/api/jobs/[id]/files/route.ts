import { guard } from '@/lib/server/auth';
import { errorResponse, json } from '@/lib/server/http';
import { readJobFiles } from '@/lib/server/job-files';

export const dynamic = 'force-dynamic';

/**
 * A job's definition YAML and its outputs with their templates, from its active version when it has one,
 * else from its draft. For starting another job from them; nothing else of the job.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const files = await readJobFiles((await params).id);
  return files ? json(files) : errorResponse(404, 'Job not found.');
}
