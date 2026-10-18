import 'server-only';

import { eq, or, sql } from 'drizzle-orm';
import { getDb } from './db';
import { jobs, jobVersions } from './db/schema';

/**
 * Jobs whose draft or any version reads from a server, by name.
 *
 * @param serverId - The server's id
 */
export async function jobsUsingServer(serverId: string): Promise<{ id: string; name: string }[]> {
  const db = getDb();
  return db
    .selectDistinct({ id: jobs.id, name: jobs.name })
    .from(jobs)
    .leftJoin(jobVersions, eq(jobVersions.jobId, jobs.id))
    .where(
      or(
        sql`${jobs.draft} -> 'source' ->> 'serverId' = ${serverId}`,
        sql`${jobVersions.spec} -> 'source' ->> 'serverId' = ${serverId}`,
      ),
    )
    .orderBy(jobs.name);
}
