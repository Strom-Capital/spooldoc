import { guard } from '@/lib/server/auth';
import { json } from '@/lib/server/http';
import { withConnection } from '@/lib/server/ibmi';
import { countQueueFiles } from '@/lib/server/queues';

export const dynamic = 'force-dynamic';

/**
 * Ready and held files of each output queue of the server. Counting reads every spooled
 * file, so the Queues page asks for it after the list.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  return withConnection((await params).id, async (conn, server) => json({ counts: await countQueueFiles(conn, server) }));
}
