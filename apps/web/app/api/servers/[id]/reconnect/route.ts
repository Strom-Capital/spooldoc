import { guard } from '@/lib/server/auth';
import { errorResponse, json, redact } from '@/lib/server/http';
import { connectionErrorResponse, failedOutcome, signOn } from '@/lib/server/ibmi';
import { getServerRow, recordServerState, serverCredentials, serverView } from '@/lib/server/servers';

export const dynamic = 'force-dynamic';

/**
 * Sign on to the server again from scratch and record the result: the OS version and
 * CCSID, or the error. This also ends a pause after a failed sign-on.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const row = await getServerRow((await params).id);
  if (!row) {
    return errorResponse(404, 'Server not found.');
  }
  let creds;
  try {
    creds = serverCredentials(row);
  } catch (error) {
    // The password has to be entered again, as after a failed sign-on.
    const message = redact(error);
    await recordServerState(row, { ok: false, code: 'auth', message });
    return errorResponse(500, message);
  }
  try {
    const info = await signOn(creds);
    await recordServerState(row, { ok: true, info });
  } catch (error) {
    await recordServerState(row, failedOutcome(error, [creds.password]));
    return connectionErrorResponse(error, [creds.password]);
  }
  const updated = await getServerRow(row.id);
  return updated ? json(serverView(updated)) : errorResponse(404, 'Server not found.');
}
