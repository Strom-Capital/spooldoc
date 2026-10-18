import { eq } from 'drizzle-orm';
import { IBMI_NAME } from '@/lib/job-spec';
import { guard } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { servers } from '@/lib/server/db/schema';
import { errorResponse, json } from '@/lib/server/http';
import { withConnection } from '@/lib/server/ibmi';

export const dynamic = 'force-dynamic';

/** CPF messages that mean the user may not do this. */
const AUTHORITY = new Set(['CPF2189', 'CPF2207', 'CPF2182', 'CPF9802', 'CPF3305', 'CPF2209', 'CPF9820', 'CPF9810']);

/**
 * Watch an output queue by polling again instead of in real time.
 *
 * - When Spooldoc created the data queue, the output queue is detached from it
 *   (`CHGOUTQ DTAQ(*NONE)`); other queues that send to it stay real-time. Without the
 *   authority the answer carries the command for an operator.
 * - When Spooldoc only reads a data queue that was there before, the output queue is
 *   left as it is and Spooldoc stops reading that data queue: every queue of the server
 *   is polled then.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; lib: string; name: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const { id, lib, name } = await params;
  const library = lib.toUpperCase();
  const queue = name.toUpperCase();
  if (!IBMI_NAME.test(library) || !IBMI_NAME.test(queue)) {
    return errorResponse(400, 'Invalid library or queue name.');
  }
  return withConnection(id, async (conn, server) => {
    if (!server.dtaqLibrary || !server.dtaqName) {
      return json({ ok: true, change: 'none' });
    }
    if (!server.dtaqOwned) {
      await getDb().update(servers).set({ dtaqLibrary: null, dtaqName: null, dtaqOwned: false }).where(eq(servers.id, server.id));
      return json({ ok: true, change: 'stopped-reading' });
    }
    const command = `CHGOUTQ OUTQ(${library}/${queue}) DTAQ(*NONE)`;
    const result = await conn.runCommand(command);
    if (!result.ok) {
      const noAuthority = result.messages.some((m) => AUTHORITY.has(m.id));
      const detail = result.messages.map((m) => `${m.id}: ${m.text}`).join(' ') || 'The command failed.';
      return json(
        { ok: false, error: noAuthority ? `${server.user} may not run CHGOUTQ. ${detail}` : detail, commands: [command] },
        { status: noAuthority ? 403 : 422 },
      );
    }
    return json({ ok: true, change: 'detached' });
  });
}
