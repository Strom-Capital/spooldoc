import type { OutputQueue } from '@spooldoc/ibmi';
import { checkFetchSite, json } from '@/lib/server/http';
import { withConnection } from '@/lib/server/ibmi';

export const dynamic = 'force-dynamic';

/**
 * Output queues whose library or name contains `q`; without `q`, the queues of the
 * session's library (or every queue when no library was given at sign-on).
 */
export async function GET(request: Request): Promise<Response> {
  const refused = checkFetchSite(request);
  if (refused) {
    return refused;
  }
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 21);
  return withConnection(async (conn, ibmi) => {
    let queues: OutputQueue[];
    if (q.includes('/')) {
      const [library = '', name = ''] = q.split('/');
      queues = await conn.listOutputQueues({ library, name });
    } else if (q) {
      const [byLibrary, byName] = await Promise.all([
        conn.listOutputQueues({ library: q }),
        conn.listOutputQueues({ name: q }),
      ]);
      const seen = new Map<string, OutputQueue>();
      for (const queue of [...byLibrary, ...byName]) {
        seen.set(`${queue.library}/${queue.name}`, queue);
      }
      queues = [...seen.values()].sort((a, b) => a.library.localeCompare(b.library) || a.name.localeCompare(b.name));
    } else {
      queues = await conn.listOutputQueues(ibmi.library ? { library: ibmi.library } : {});
    }
    return json({ queues });
  });
}
