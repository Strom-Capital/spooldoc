import { asc } from 'drizzle-orm';
import { createDestinationSchema } from '@/lib/destination-config';
import { guard } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { destinations } from '@/lib/server/db/schema';
import { destinationView } from '@/lib/server/destinations';
import { json, readJson } from '@/lib/server/http';
import { destinationJobs } from '@/lib/server/jobs-using';

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

/** Add a destination. Only an IFS folder can be added; nothing is checked on the IBM i yet. */
export async function POST(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const body = await readJson(request, createDestinationSchema);
  if ('response' in body) {
    return body.response;
  }
  const { kind, name, config } = body.data;
  const [row] = await getDb().insert(destinations).values({ kind, name, config }).returning();
  return json(destinationView(row!, []), { status: 201 });
}
