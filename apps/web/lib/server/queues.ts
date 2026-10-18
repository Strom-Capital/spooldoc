import 'server-only';

import type { Connection, OutputQueue } from '@spooldoc/ibmi';
import { and, eq } from 'drizzle-orm';
import type { QueueView } from '@/lib/types';
import { getDb } from './db';
import { queuePrefs } from './db/schema';
import type { ServerRow } from './servers';

const byName = (a: OutputQueue, b: OutputQueue) => a.library.localeCompare(b.library) || a.name.localeCompare(b.name);

/**
 * Output queues of a server, within its libraries. `q` is `LIB/NAME`, or text that the
 * library or the name contains; empty lists every queue of the server's libraries.
 */
export async function listQueues(conn: Connection, server: ServerRow, q: string): Promise<QueueView[]> {
  const libraries = server.libraries;
  let queues: OutputQueue[];
  if (q.includes('/')) {
    const [library = '', name = ''] = q.split('/');
    queues = await conn.listOutputQueues({ library, name, libraries });
  } else if (q) {
    const [inLibrary, inName] = await Promise.all([
      conn.listOutputQueues({ library: q, libraries }),
      conn.listOutputQueues({ name: q, libraries }),
    ]);
    const seen = new Map<string, OutputQueue>();
    for (const queue of [...inLibrary, ...inName]) {
      seen.set(`${queue.library}/${queue.name}`, queue);
    }
    queues = [...seen.values()].sort(byName);
  } else {
    queues = await conn.listOutputQueues({ libraries });
  }
  const hidden = await hiddenQueues(server.id);
  return queues.map((queue) => ({ ...queue, hidden: hidden.has(`${queue.library}/${queue.name}`) }));
}

/** `LIB/NAME` of every hidden queue of a server. */
export async function hiddenQueues(serverId: string): Promise<Set<string>> {
  const rows = await getDb()
    .select({ library: queuePrefs.library, name: queuePrefs.name })
    .from(queuePrefs)
    .where(and(eq(queuePrefs.serverId, serverId), eq(queuePrefs.hidden, true)));
  return new Set(rows.map((row) => `${row.library}/${row.name}`));
}
