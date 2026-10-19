import { guard } from '@/lib/server/auth';
import { errorResponse, json } from '@/lib/server/http';
import { getRun } from '@/lib/server/runs';

export const dynamic = 'force-dynamic';

/** One run with its steps and files. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const run = await getRun((await params).id);
  return run ? json(run) : errorResponse(404, 'Run not found.');
}
