import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { ibmiName } from '@/lib/job-spec';
import { guard } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { queuePrefs } from '@/lib/server/db/schema';
import { errorResponse, readJson } from '@/lib/server/http';
import { getServerRow } from '@/lib/server/servers';

export const dynamic = 'force-dynamic';

const prefsSchema = z.object({
  queues: z.array(z.object({ library: ibmiName, name: ibmiName, hidden: z.boolean() })).min(1).max(1000),
});

/** Hide or show output queues of a server. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const server = await getServerRow((await params).id);
  if (!server) {
    return errorResponse(404, 'Server not found.');
  }
  const body = await readJson(request, prefsSchema);
  if ('response' in body) {
    return body.response;
  }
  await getDb()
    .insert(queuePrefs)
    .values(body.data.queues.map((queue) => ({ serverId: server.id, ...queue })))
    .onConflictDoUpdate({
      target: [queuePrefs.serverId, queuePrefs.library, queuePrefs.name],
      set: { hidden: sql`excluded.hidden` },
    });
  return new Response(null, { status: 204 });
}
