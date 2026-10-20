import { chatUsage } from '@/lib/server/agent-usage';
import { guard } from '@/lib/server/auth';
import { errorResponse, json } from '@/lib/server/http';
import { getJobRow } from '@/lib/server/jobs';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** The tokens, and the cost when every step's provider reported one, of the job's current agent thread. */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const job = await getJobRow((await params).id);
  if (!job) {
    return errorResponse(404, 'Job not found.');
  }
  return json(await chatUsage(job.id));
}
