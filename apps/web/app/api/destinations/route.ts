import { asc } from 'drizzle-orm';
import { jobSpecSchema } from '@/lib/job-spec';
import { guard } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { destinations, jobs } from '@/lib/server/db/schema';
import { json } from '@/lib/server/http';
import type { DestinationView } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Destinations, each with the jobs whose draft delivers to it. */
export async function GET(request: Request): Promise<Response> {
  const auth = await guard(request);
  if ('response' in auth) {
    return auth.response;
  }
  const db = getDb();
  const rows = await db.select().from(destinations).orderBy(asc(destinations.name));
  const jobRows = await db.select({ id: jobs.id, name: jobs.name, draft: jobs.draft }).from(jobs).orderBy(asc(jobs.name));
  const views: DestinationView[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind as DestinationView['kind'],
    name: row.name,
    builtin: row.builtin,
    jobs: jobRows
      .filter((job) => jobSpecSchema.parse(job.draft).destination.destinationId === row.id)
      .map((job) => ({ id: job.id, name: job.name })),
  }));
  return json({ destinations: views });
}
