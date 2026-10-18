import { eq } from 'drizzle-orm';
import { guard } from '@/lib/server/auth';
import { getConfig } from '@/lib/server/config';
import { getDb } from '@/lib/server/db';
import { servers } from '@/lib/server/db/schema';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { closeConnection, connectionErrorResponse, signOn } from '@/lib/server/ibmi';
import { jobsUsingServer } from '@/lib/server/jobs-using';
import { encryptSecret } from '@/lib/server/secrets';
import { updateServerSchema } from '@/lib/server/server-input';
import { getServerRow, serverCredentials, serverView } from '@/lib/server/servers';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** One server. */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const row = await getServerRow((await params).id);
  return row ? json(serverView(row)) : errorResponse(404, 'Server not found.');
}

/**
 * Change a server. A new host, user or password is signed on with first; the password
 * stays as it is unless one is given.
 */
export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const row = await getServerRow((await params).id);
  if (!row) {
    return errorResponse(404, 'Server not found.');
  }
  const body = await readJson(request, updateServerSchema);
  if ('response' in body) {
    return body.response;
  }
  const change = body.data;
  const host = change.host ?? row.host;
  const allowed = getConfig().allowedHosts;
  if (change.host && allowed.length > 0 && !allowed.includes(host.toLowerCase())) {
    return errorResponse(400, `Host ${host} is not in SPOOLDOC_ALLOWED_HOSTS.`);
  }
  const values: Partial<typeof servers.$inferInsert> = {};
  if (change.name !== undefined) values.name = change.name;
  if (change.libraries !== undefined) values.libraries = change.libraries;
  if (change.dataQueue !== undefined) {
    values.dtaqLibrary = change.dataQueue?.library ?? null;
    values.dtaqName = change.dataQueue?.name ?? null;
    values.dtaqOwned = false;
  }
  const signOnChanged = (change.host !== undefined && change.host !== row.host) || (change.user !== undefined && change.user !== row.user) || change.password !== undefined;
  if (signOnChanged) {
    let old;
    try {
      old = serverCredentials(row);
    } catch {
      old = null;
    }
    const creds = { host, user: change.user ?? row.user, password: change.password ?? old?.password ?? '' };
    if (!creds.password) {
      return errorResponse(400, 'password: Enter the password again.');
    }
    try {
      const info = await signOn(creds);
      Object.assign(values, { host: creds.host, user: creds.user, ccsid: info.jobCcsid, vrm: info.vrm, lastCheckedAt: new Date(), lastError: null });
    } catch (error) {
      return connectionErrorResponse(error, [creds.password]);
    }
    values.passwordEnc = encryptSecret(creds.password);
    if (old) {
      await closeConnection(old).catch(() => undefined);
    }
  }
  if (Object.keys(values).length === 0) {
    return json(serverView(row));
  }
  const [updated] = await getDb().update(servers).set(values).where(eq(servers.id, row.id)).returning();
  return json(serverView(updated!));
}

/** Remove a server and its queue settings. Refused while a job reads from it. */
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const row = await getServerRow((await params).id);
  if (!row) {
    return errorResponse(404, 'Server not found.');
  }
  const using = await jobsUsingServer(row.id);
  if (using.length > 0) {
    return Response.json(
      { error: `Jobs read from this server: ${using.map((job) => job.name).join(', ')}. Change or delete them first.`, jobs: using },
      { status: 409, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  try {
    await closeConnection(serverCredentials(row));
  } catch {
    // Nothing cached, or the password cannot be decrypted: nothing to close.
  }
  await getDb().delete(servers).where(eq(servers.id, row.id));
  return new Response(null, { status: 204 });
}
