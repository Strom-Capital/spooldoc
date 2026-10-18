import { guard } from '@/lib/server/auth';
import { json } from '@/lib/server/http';
import { withConnection } from '@/lib/server/ibmi';
import { listQueues } from '@/lib/server/queues';

export const dynamic = 'force-dynamic';

/**
 * Output queues of the server, each with its hidden flag. `q` searches (see
 * `listQueues`); `visible=1` leaves hidden queues out.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const search = new URL(request.url).searchParams;
  const q = (search.get('q') ?? '').trim().slice(0, 21);
  const visibleOnly = search.get('visible') === '1';
  return withConnection((await params).id, async (conn, server) => {
    const queues = await listQueues(conn, server, q);
    return json({ queues: visibleOnly ? queues.filter((queue) => !queue.hidden) : queues });
  });
}
