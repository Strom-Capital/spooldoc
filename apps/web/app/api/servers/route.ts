import { asc } from 'drizzle-orm';
import { guard } from '@/lib/server/auth';
import { getConfig } from '@/lib/server/config';
import { getDb } from '@/lib/server/db';
import { servers } from '@/lib/server/db/schema';
import { errorResponse, json, readJson } from '@/lib/server/http';
import { connectionErrorResponse, signOn } from '@/lib/server/ibmi';
import { serverJobs } from '@/lib/server/queues';
import { encryptSecret } from '@/lib/server/secrets';
import { createServerSchema } from '@/lib/server/server-input';
import { serverView } from '@/lib/server/servers';

export const dynamic = 'force-dynamic';

/** Saved servers, by name, each with the jobs that read from it. */
export async function GET(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const [rows, jobs] = await Promise.all([getDb().select().from(servers).orderBy(asc(servers.name)), serverJobs()]);
  return json({ servers: rows.map((row) => ({ ...serverView(row), jobs: jobs.get(row.id) ?? [] })) });
}

/** Add a server: sign on first, then save it with the password encrypted. */
export async function POST(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const body = await readJson(request, createServerSchema);
  if ('response' in body) {
    return body.response;
  }
  const { name, host, user, password, libraries } = body.data;
  const allowed = getConfig().allowedHosts;
  if (allowed.length > 0 && !allowed.includes(host.toLowerCase())) {
    return errorResponse(400, `Host ${host} is not in SPOOLDOC_ALLOWED_HOSTS.`);
  }
  let info;
  try {
    info = await signOn({ host, user, password });
  } catch (error) {
    return connectionErrorResponse(error, [password]);
  }
  const [row] = await getDb()
    .insert(servers)
    .values({
      name,
      host,
      user,
      passwordEnc: encryptSecret(password),
      libraries,
      ccsid: info.jobCcsid,
      vrm: info.vrm,
      lastCheckedAt: new Date(),
    })
    .returning();
  return json(serverView(row!), { status: 201 });
}
