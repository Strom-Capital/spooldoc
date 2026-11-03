import 'server-only';

import { eq, or, sql } from 'drizzle-orm';
import type { QueueView } from '@/lib/types';
import { getDb } from './db';
import { jobs, jobVersions } from './db/schema';
import { listJobs } from './jobs';

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

/**
 * Jobs whose draft or any version delivers to a destination, by name.
 *
 * @param destinationId - The destination's id
 */
export async function jobsUsingDestination(destinationId: string): Promise<{ id: string; name: string }[]> {
  const db = getDb();
  return db
    .selectDistinct({ id: jobs.id, name: jobs.name })
    .from(jobs)
    .leftJoin(jobVersions, eq(jobVersions.jobId, jobs.id))
    .where(
      or(
        sql`${jobs.draft} -> 'destination' ->> 'destinationId' = ${destinationId}`,
        sql`${jobVersions.spec} -> 'destination' ->> 'destinationId' = ${destinationId}`,
      ),
    )
    .orderBy(jobs.name);
}

/**
 * The jobs whose draft or any version delivers to each destination, by destination id, in
 * name order, with their state for the jobs popover.
 */
export async function destinationJobs(): Promise<Map<string, QueueView['jobs']>> {
  const [rows, summaries] = await Promise.all([
    getDb()
      .selectDistinct({
        id: jobs.id,
        draft: sql<string | null>`${jobs.draft} -> 'destination' ->> 'destinationId'`,
        version: sql<string | null>`${jobVersions.spec} -> 'destination' ->> 'destinationId'`,
      })
      .from(jobs)
      .leftJoin(jobVersions, eq(jobVersions.jobId, jobs.id)),
    listJobs(),
  ]);
  const destinationsOf = new Map<string, Set<string>>();
  for (const row of rows) {
    const ids = destinationsOf.get(row.id) ?? new Set<string>();
    for (const id of [row.draft, row.version]) if (id) ids.add(id);
    destinationsOf.set(row.id, ids);
  }
  const byDestination = new Map<string, QueueView['jobs']>();
  // listJobs is in name order, so each list is too.
  for (const job of summaries) {
    for (const destinationId of destinationsOf.get(job.id) ?? []) {
      const list = byDestination.get(destinationId) ?? [];
      list.push({ id: job.id, name: job.name, mode: job.mode, paused: job.paused, activeVersion: job.activeVersion });
      byDestination.set(destinationId, list);
    }
  }
  return byDestination;
}


/**
 * The jobs whose draft or any version has a lookup that reads each lookup table, by table
 * id, in name order, with their state for the jobs popover. With a table id, only that
 * table's jobs are read.
 *
 * @param tableId - One lookup table's id; every table without it
 */
export async function lookupTableJobs(tableId?: string): Promise<Map<string, QueueView['jobs']>> {
  const tablesPath = '$.lookups[*] ? (@.source == "table").table';
  const readsTable = '$.lookups[*] ? (@.source == "table" && @.table == $id)';
  const vars = JSON.stringify({ id: tableId ?? '' });
  const [rows, summaries] = await Promise.all([
    getDb()
      .selectDistinct({
        id: jobs.id,
        draft: sql<string[] | null>`jsonb_path_query_array(${jobs.draft}, ${tablesPath}::jsonpath)`,
        version: sql<string[] | null>`jsonb_path_query_array(${jobVersions.spec}, ${tablesPath}::jsonpath)`,
      })
      .from(jobs)
      .leftJoin(jobVersions, eq(jobVersions.jobId, jobs.id))
      .where(
        tableId === undefined
          ? undefined
          : or(
              sql`jsonb_path_exists(${jobs.draft}, ${readsTable}::jsonpath, ${vars}::jsonb)`,
              sql`jsonb_path_exists(${jobVersions.spec}, ${readsTable}::jsonpath, ${vars}::jsonb)`,
            ),
      ),
    listJobs(),
  ]);
  const tablesOf = new Map<string, Set<string>>();
  for (const row of rows) {
    const ids = tablesOf.get(row.id) ?? new Set<string>();
    for (const id of [...(row.draft ?? []), ...(row.version ?? [])]) if (typeof id === 'string' && id) ids.add(id);
    tablesOf.set(row.id, ids);
  }
  const byTable = new Map<string, QueueView['jobs']>();
  // listJobs is in name order, so each list is too.
  for (const job of summaries) {
    for (const id of tablesOf.get(job.id) ?? []) {
      if (tableId !== undefined && id !== tableId) continue;
      const list = byTable.get(id) ?? [];
      list.push({ id: job.id, name: job.name, mode: job.mode, paused: job.paused, activeVersion: job.activeVersion });
      byTable.set(id, list);
    }
  }
  return byTable;
}
