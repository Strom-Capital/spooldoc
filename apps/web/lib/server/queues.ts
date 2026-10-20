import 'server-only';

import type { Connection, OutputQueue } from '@spooldoc/ibmi';
import { and, eq } from 'drizzle-orm';
import type { QueueCountView, QueueView } from '@/lib/types';
import { getDb } from './db';
import { queuePrefs } from './db/schema';
import { listJobs } from './jobs';
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
  const [hidden, jobs] = await Promise.all([hiddenQueues(server.id), queueJobs(server.id)]);
  return queues.map((queue) => {
    const key = `${queue.library}/${queue.name}`;
    return { ...queue, hidden: hidden.has(key), jobs: jobs.get(key.toUpperCase()) ?? [] };
  });
}

type QueueJob = QueueView['jobs'][number];

/**
 * Every job that reads from an output queue, with its server and upper-case `LIB/NAME`, in
 * name order. A job reads from the source of its active version, else of its draft.
 */
async function jobSources(): Promise<{ serverId: string; queue: string; job: QueueJob }[]> {
  return (await listJobs()).flatMap((job) =>
    job.source.serverId
      ? [
          {
            serverId: job.source.serverId,
            queue: `${job.source.library}/${job.source.queue}`.toUpperCase(),
            job: { id: job.id, name: job.name, mode: job.mode, paused: job.paused, activeVersion: job.activeVersion },
          },
        ]
      : [],
  );
}

/** Add `value` to the list under `key`. */
function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** The jobs that read from each output queue of a server, by upper-case `LIB/NAME`, in name order. */
async function queueJobs(serverId: string): Promise<Map<string, QueueView['jobs']>> {
  const byQueue = new Map<string, QueueView['jobs']>();
  for (const source of await jobSources()) {
    if (source.serverId === serverId) push(byQueue, source.queue, source.job);
  }
  return byQueue;
}

/** The jobs that read from any output queue of each server, by server id, in name order. */
export async function serverJobs(): Promise<Map<string, QueueView['jobs']>> {
  const byServer = new Map<string, QueueView['jobs']>();
  for (const source of await jobSources()) push(byServer, source.serverId, source.job);
  return byServer;
}

/**
 * Ready and held files of each output queue in the server's libraries. Queues with
 * neither are left out.
 */
export async function countQueueFiles(conn: Connection, server: ServerRow): Promise<QueueCountView[]> {
  const rows = await conn.countSpooledFiles({ status: ['READY', 'HELD'], libraries: server.libraries });
  const counts = new Map<string, QueueCountView>();
  for (const row of rows) {
    const key = `${row.library}/${row.name}`;
    const count = counts.get(key) ?? { library: row.library, name: row.name, ready: 0, held: 0 };
    if (row.status === 'READY') count.ready += row.files;
    else if (row.status === 'HELD') count.held += row.files;
    counts.set(key, count);
  }
  return [...counts.values()];
}

/** `LIB/NAME` of every hidden queue of a server. */
export async function hiddenQueues(serverId: string): Promise<Set<string>> {
  const rows = await getDb()
    .select({ library: queuePrefs.library, name: queuePrefs.name })
    .from(queuePrefs)
    .where(and(eq(queuePrefs.serverId, serverId), eq(queuePrefs.hidden, true)));
  return new Set(rows.map((row) => `${row.library}/${row.name}`));
}
