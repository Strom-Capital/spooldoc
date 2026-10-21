import { eq } from 'drizzle-orm';
import { CONFIG_SCHEMAS, updateDestinationSchema } from '@/lib/destination-config';
import { guard } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { destinations } from '@/lib/server/db/schema';
import { destinationView } from '@/lib/server/destinations';
import { openWebhookSecrets, sealWebhookSecrets, type WebhookSecrets } from '@/lib/server/destinations/webhook';
import { errorResponse, invalidResponse, json, readJson } from '@/lib/server/http';
import { destinationJobs, jobsUsingDestination } from '@/lib/server/jobs-using';
import { UUID } from '@/lib/server/servers';
import { newSigningSecret } from '@/lib/server/webhook-payload';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** The destination row, or a 404 or 400 response. The built-in destination cannot be changed. */
async function changeable(id: string): Promise<{ row: typeof destinations.$inferSelect } | { response: Response }> {
  const [row] = UUID.test(id) ? await getDb().select().from(destinations).where(eq(destinations.id, id)) : [];
  if (!row) {
    return { response: errorResponse(404, 'Destination not found.') };
  }
  if (row.builtin) {
    return { response: errorResponse(400, `${row.name} is built in. It cannot be changed or deleted.`) };
  }
  return { row };
}

/**
 * Change a destination's name or settings. A webhook also takes `headers`: each header it
 * keeps, with a new value or null to keep the saved one; a header left out is removed.
 * `rotateSecret` gives it a new signing secret, which the answer holds as
 * `revealedSecret` this once.
 */
export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const found = await changeable((await params).id);
  if ('response' in found) {
    return found.response;
  }
  const body = await readJson(request, updateDestinationSchema);
  if ('response' in body) {
    return body.response;
  }
  const { name, config, headers, rotateSecret } = body.data;
  const values: Partial<typeof destinations.$inferInsert> = {};
  let revealedSecret: string | undefined;
  if (found.row.kind === 'webhook' && (headers !== undefined || rotateSecret)) {
    let saved: WebhookSecrets;
    try {
      saved = openWebhookSecrets(found.row.secretsEnc);
    } catch (error) {
      // Secrets sealed with another key: start again with what the request gives.
      if (!rotateSecret || headers?.some((header) => header.value === null)) {
        return errorResponse(409, `${error instanceof Error ? error.message : String(error)} Rotate the secret and enter every header value again.`);
      }
      saved = { signingSecret: null, headers: [] };
    }
    const next = { ...saved };
    if (headers !== undefined) {
      const known = new Map(saved.headers.map((header) => [header.name.toLowerCase(), header.value]));
      const kept: { name: string; value: string }[] = [];
      for (const [index, header] of headers.entries()) {
        const value = header.value ?? known.get(header.name.toLowerCase());
        if (value === undefined || !value.trim()) return invalidResponse('Enter the header value', ['headers', index, 'value']);
        kept.push({ name: header.name, value });
      }
      next.headers = kept;
    }
    if (rotateSecret) next.signingSecret = revealedSecret = newSigningSecret();
    values.secretsEnc = sealWebhookSecrets(next);
  }
  if (name !== undefined) values.name = name;
  if (config !== undefined) {
    const schema = CONFIG_SCHEMAS[found.row.kind as keyof typeof CONFIG_SCHEMAS];
    const parsed = schema.safeParse(config);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return invalidResponse(issue?.message ?? 'The settings are not valid.', ['config', ...(issue?.path ?? [])]);
    }
    values.config = parsed.data;
  }
  const db = getDb();
  const [row] = Object.keys(values).length === 0 ? [found.row] : await db.update(destinations).set(values).where(eq(destinations.id, found.row.id)).returning();
  const view = destinationView(row!, (await destinationJobs()).get(found.row.id) ?? []);
  return json(revealedSecret ? { ...view, revealedSecret } : view);
}

/** Remove a destination. Refused while a job's draft or any version delivers to it. */
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const found = await changeable((await params).id);
  if ('response' in found) {
    return found.response;
  }
  const using = await jobsUsingDestination(found.row.id);
  if (using.length > 0) {
    return Response.json(
      { error: `Jobs deliver to this destination: ${using.map((job) => job.name).join(', ')}. Change or delete them first.`, jobs: using },
      { status: 409, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  await getDb().delete(destinations).where(eq(destinations.id, found.row.id));
  return new Response(null, { status: 204 });
}
