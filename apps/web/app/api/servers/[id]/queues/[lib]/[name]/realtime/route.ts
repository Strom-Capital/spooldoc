import { SPOOLED_FILE_DTAQ_MAXLEN, type CommandResult } from '@spooldoc/ibmi';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { IBMI_NAME } from '@/lib/job-spec';
import { guard } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { servers } from '@/lib/server/db/schema';
import { errorResponse, json } from '@/lib/server/http';
import { withConnection } from '@/lib/server/ibmi';

export const dynamic = 'force-dynamic';

/** CPF messages that mean the user may not do this. */
const AUTHORITY = new Set(['CPF2189', 'CPF2207', 'CPF2182', 'CPF9802', 'CPF3305', 'CPF2209', 'CPF9820', 'CPF9810']);
/** CRTDTAQ: the data queue exists already. */
const EXISTS = new Set(['CPF9870']);

const bodySchema = z.object({ adopt: z.boolean().optional() });

const failure = (result: CommandResult): string => result.messages.map((m) => `${m.id}: ${m.text}`).join(' ') || 'The command failed.';

/**
 * Make an output queue real-time for Spooldoc: create the server's data queue (by
 * default SPOOLDOC in the queue's library) unless it exists, and attach it to the queue
 * with CHGOUTQ. A queue that already sends to another data queue is left alone, unless
 * `adopt` makes that data queue the server's. Without authority the answer carries the
 * commands for an operator.
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
  let adopt = false;
  try {
    adopt = bodySchema.parse(await request.json().catch(() => ({}))).adopt === true;
  } catch {
    return errorResponse(400, 'Invalid request.');
  }

  return withConnection(id, async (conn, server) => {
    const [info] = (await conn.listOutputQueues({ library, name: queue, libraries: [library] })).filter((q) => q.name === queue);
    if (!info) {
      return errorResponse(404, `Output queue ${library}/${queue} not found.`);
    }
    const save = (dtaq: { library: string; name: string }) =>
      getDb().update(servers).set({ dtaqLibrary: dtaq.library, dtaqName: dtaq.name }).where(eq(servers.id, server.id));

    if (info.dataQueue) {
      const same = server.dtaqLibrary === info.dataQueue.library && server.dtaqName === info.dataQueue.name;
      if (same) {
        return json({ ok: true });
      }
      if (adopt) {
        await save(info.dataQueue);
        return json({ ok: true });
      }
      return json(
        {
          ok: false,
          error: `${library}/${queue} already sends entries to ${info.dataQueue.library}/${info.dataQueue.name}. Spooldoc leaves it alone; use that data queue only if no other program reads it.`,
          dataQueue: info.dataQueue,
        },
        { status: 409 },
      );
    }

    const dtaq = server.dtaqLibrary && server.dtaqName ? { library: server.dtaqLibrary, name: server.dtaqName } : { library, name: 'SPOOLDOC' };
    const commands = [
      `CRTDTAQ DTAQ(${dtaq.library}/${dtaq.name}) MAXLEN(${SPOOLED_FILE_DTAQ_MAXLEN}) TEXT('Spooldoc: spooled files ready')`,
      `CHGOUTQ OUTQ(${library}/${queue}) DTAQ(${dtaq.library}/${dtaq.name})`,
    ];
    for (const [index, command] of commands.entries()) {
      const result = await conn.runCommand(command);
      if (result.ok || (index === 0 && result.messages.some((m) => EXISTS.has(m.id)))) {
        continue;
      }
      const noAuthority = result.messages.some((m) => AUTHORITY.has(m.id));
      return json(
        {
          ok: false,
          error: noAuthority ? `${server.user} may not run ${command.split(' ')[0]}. ${failure(result)}` : failure(result),
          commands,
        },
        { status: noAuthority ? 403 : 422 },
      );
    }
    await save(dtaq);
    return json({ ok: true, dataQueue: dtaq });
  });
}
