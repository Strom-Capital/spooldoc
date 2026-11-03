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

/** The jsonpath of the lookups that read a lookup table, and with `$column`, key on that column. */
const TABLE_LOOKUP = '$.lookups[*] ? (@.source == "table" && @.table == $id)';
const TABLE_KEY = '$.lookups[*] ? (@.source == "table" && @.table == $id && exists(@.key[*] ? (@.column == $column)))';

/**
 * Jobs whose draft or any version has a lookup that reads a lookup table, by name. With
 * a column, only those whose lookup keys on that column: the jobs a rename or delete of
 * the column breaks.
 *
 * @param tableId - The lookup table's id
 * @param column - A column of the table
 */
export async function jobsUsingLookupTable(tableId: string, column?: string): Promise<{ id: string; name: string }[]> {
  const path = column === undefined ? TABLE_LOOKUP : TABLE_KEY;
  const vars = JSON.stringify(column === undefined ? { id: tableId } : { id: tableId, column });
  return getDb()
    .selectDistinct({ id: jobs.id, name: jobs.name })
    .from(jobs)
    .leftJoin(jobVersions, eq(jobVersions.jobId, jobs.id))
    .where(
      or(
        sql`jsonb_path_exists(${jobs.draft}, ${path}::jsonpath, ${vars}::jsonb)`,
        sql`jsonb_path_exists(${jobVersions.spec}, ${path}::jsonpath, ${vars}::jsonb)`,
      ),
    )
    .orderBy(jobs.name);
}

/**
 * The jobs whose draft or any version has a lookup that keys on each column of a lookup
 * table, by column, in name order.
 *
 * @param tableId - The lookup table's id
 */
export async function lookupTableKeyJobs(tableId: string): Promise<Record<string, { id: string; name: string }[]>> {
  const path = '$.lookups[*] ? (@.source == "table" && @.table == $id).key[*].column';
  const vars = JSON.stringify({ id: tableId });
  const rows = await getDb()
    .selectDistinct({
      id: jobs.id,
      name: jobs.name,
      draft: sql<string[] | null>`jsonb_path_query_array(${jobs.draft}, ${path}::jsonpath, ${vars}::jsonb)`,
      version: sql<string[] | null>`jsonb_path_query_array(${jobVersions.spec}, ${path}::jsonpath, ${vars}::jsonb)`,
    })
    .from(jobs)
    .leftJoin(jobVersions, eq(jobVersions.jobId, jobs.id))
    .orderBy(jobs.name);
  const out: Record<string, { id: string; name: string }[]> = {};
  for (const row of rows) {
    for (const column of new Set([...(row.draft ?? []), ...(row.version ?? [])])) {
      if (typeof column !== 'string') continue;
      const list = (out[column] ??= []);
      if (!list.some((job) => job.id === row.id)) list.push({ id: row.id, name: row.name });
    }
  }
  return out;
}

/**
 * The jobs whose draft or any version has a lookup that reads each lookup table, by table
 * id, in name order, with their state for the jobs popover.
 */
export async function lookupTableJobs(): Promise<Map<string, QueueView['jobs']>> {
  const tablesPath = '$.lookups[*] ? (@.source == "table").table';
  const [rows, summaries] = await Promise.all([
    getDb()
      .selectDistinct({
        id: jobs.id,
        draft: sql<string[] | null>`jsonb_path_query_array(${jobs.draft}, ${tablesPath}::jsonpath)`,
        version: sql<string[] | null>`jsonb_path_query_array(${jobVersions.spec}, ${tablesPath}::jsonpath)`,
      })
      .from(jobs)
      .leftJoin(jobVersions, eq(jobVersions.jobId, jobs.id)),
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
    for (const tableId of tablesOf.get(job.id) ?? []) {
      const list = byTable.get(tableId) ?? [];
      list.push({ id: job.id, name: job.name, mode: job.mode, paused: job.paused, activeVersion: job.activeVersion });
      byTable.set(tableId, list);
    }
  }
  return byTable;
}
