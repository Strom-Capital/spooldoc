import { asc } from 'drizzle-orm';
import { createDestinationSchema } from '@/lib/destination-config';
import { guard } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { destinations } from '@/lib/server/db/schema';
import { destinationView } from '@/lib/server/destinations';
import { resolveSftp, sealSftpSecrets } from '@/lib/server/destinations/sftp';
import { sealWebhookSecrets } from '@/lib/server/destinations/webhook';
import { invalidResponse, json, readJson } from '@/lib/server/http';
import { destinationJobs } from '@/lib/server/jobs-using';
import { newSigningSecret } from '@/lib/server/webhook-payload';

export const dynamic = 'force-dynamic';

/** Destinations, by name, each with the jobs whose draft or any version delivers to it. */
export async function GET(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const [rows, jobs] = await Promise.all([getDb().select().from(destinations).orderBy(asc(destinations.name)), destinationJobs()]);
  return json({ destinations: rows.map((row) => destinationView(row, jobs.get(row.id) ?? [])) });
}

/**
 * Add an IFS folder, an email, a webhook or an SFTP destination. Nothing is checked on the
 * IBM i, at the URL or on the SFTP server yet. A webhook gets a new signing secret, which
 * the answer holds as `revealedSecret` this once; its header values are stored encrypted
 * with it. An SFTP destination stores its key or password encrypted, and trusts a host key
 * only through the token from Check connection.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const body = await readJson(request, createDestinationSchema);
  if ('response' in body) {
    return body.response;
  }
  const input = body.data;
  if (input.kind === 'webhook') {
    const signingSecret = newSigningSecret();
    const [row] = await getDb()
      .insert(destinations)
      .values({ kind: input.kind, name: input.name, config: input.config, secretsEnc: sealWebhookSecrets({ signingSecret, headers: input.headers }) })
      .returning();
    return json({ ...destinationView(row!, []), revealedSecret: signingSecret }, { status: 201 });
  }
  if (input.kind === 'sftp') {
    const resolved = resolveSftp(input);
    if ('error' in resolved) return invalidResponse(resolved.error, resolved.field.split('.'));
    const [row] = await getDb()
      .insert(destinations)
      .values({ kind: 'sftp', name: input.name, config: resolved.config, secretsEnc: sealSftpSecrets(resolved.secrets) })
      .returning();
    return json(destinationView(row!, []), { status: 201 });
  }
  const [row] = await getDb().insert(destinations).values({ kind: input.kind, name: input.name, config: input.config }).returning();
  return json(destinationView(row!, []), { status: 201 });
}
