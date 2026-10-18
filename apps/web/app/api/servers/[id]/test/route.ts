import { eq } from 'drizzle-orm';
import { guard } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { servers } from '@/lib/server/db/schema';
import { errorResponse, json, redact } from '@/lib/server/http';
import { connectionErrorResponse, signOn } from '@/lib/server/ibmi';
import { getServerRow, serverCredentials, serverView } from '@/lib/server/servers';

export const dynamic = 'force-dynamic';

/** Sign on to the server now and record the result (OS version, CCSID or the error). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const row = await getServerRow((await params).id);
  if (!row) {
    return errorResponse(404, 'Server not found.');
  }
  const db = getDb();
  let creds;
  try {
    creds = serverCredentials(row);
  } catch (error) {
    const message = redact(error);
    await db.update(servers).set({ lastCheckedAt: new Date(), lastError: message }).where(eq(servers.id, row.id));
    return errorResponse(500, message);
  }
  try {
    const info = await signOn(creds);
    const [updated] = await db
      .update(servers)
      .set({ ccsid: info.jobCcsid, vrm: info.vrm, lastCheckedAt: new Date(), lastError: null, errorDismissed: null })
      .where(eq(servers.id, row.id))
      .returning();
    return json(serverView(updated!));
  } catch (error) {
    const response = connectionErrorResponse(error, [creds.password]);
    const { error: message } = (await response.clone().json()) as { error: string };
    await db.update(servers).set({ lastCheckedAt: new Date(), lastError: message }).where(eq(servers.id, row.id));
    return response;
  }
}
