import { and, eq, inArray } from 'drizzle-orm';
import { splfKey } from '@/lib/job-spec';
import { guard } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { runs, watchSeen } from '@/lib/server/db/schema';
import { errorResponse, json } from '@/lib/server/http';
import { withConnection } from '@/lib/server/ibmi';
import { UUID } from '@/lib/server/servers';
import type { SpooledFileView } from '@/lib/types';

export const dynamic = 'force-dynamic';

const OBJECT_NAME = /^[A-Za-z0-9$#@_.]{1,10}$/;

/**
 * Spooled files of one output queue, newest first, filtered by `name` and `userData`
 * ("contains") and `status` (comma-separated). With `job`, each file says which run of
 * that job already processed it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; lib: string; name: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const { id, lib, name } = await params;
  if (!OBJECT_NAME.test(lib) || !OBJECT_NAME.test(name)) {
    return errorResponse(400, 'Invalid library or queue name.');
  }
  const search = new URL(request.url).searchParams;
  const limit = Number(search.get('limit') ?? '');
  const jobId = search.get('job');
  const filter = {
    name: search.get('name')?.slice(0, 10) || undefined,
    userData: search.get('userData')?.slice(0, 10) || undefined,
    status: search.get('status')?.split(',').filter(Boolean).slice(0, 10),
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : undefined,
  };
  return withConnection(id, async (conn) => {
    const entries = await conn.listSpooledFiles({ library: lib.toUpperCase(), name: name.toUpperCase() }, filter);
    let files: SpooledFileView[] = entries;
    if (jobId && UUID.test(jobId) && entries.length > 0) {
      const keys = entries.map(splfKey);
      const seen = await getDb()
        .select({ key: watchSeen.splfKey, runId: runs.id, seq: runs.seq })
        .from(watchSeen)
        .leftJoin(runs, eq(runs.id, watchSeen.runId))
        .where(and(eq(watchSeen.jobId, jobId), inArray(watchSeen.splfKey, keys)));
      const byKey = new Map(seen.map((row) => [row.key, row]));
      files = entries.map((entry) => {
        const row = byKey.get(splfKey(entry));
        // A row without a run is a file that was on the queue when watching started: not processed.
        return { ...entry, processedBy: row?.runId ? { runId: row.runId, seq: row.seq } : null };
      });
    }
    return json({ files });
  });
}
