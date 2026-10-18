import 'server-only';

import { and, desc, eq, gte, inArray, lt, lte, type SQL } from 'drizzle-orm';
import type { RunStatus, RunView } from '@/lib/types';
import { getDb } from './db';
import { jobs, runOutputs, runs } from './db/schema';
import { UUID } from './servers';

type RunRow = typeof runs.$inferSelect;

/** Runs as the API returns them, with job names and output files (without their bytes). */
export async function runViews(rows: RunRow[]): Promise<RunView[]> {
  if (rows.length === 0) {
    return [];
  }
  const db = getDb();
  const ids = rows.map((row) => row.id);
  const outputs = await db
    .select({ id: runOutputs.id, runId: runOutputs.runId, name: runOutputs.name, size: runOutputs.size, contentType: runOutputs.contentType, documentIndex: runOutputs.documentIndex })
    .from(runOutputs)
    .where(inArray(runOutputs.runId, ids))
    .orderBy(runOutputs.documentIndex);
  const jobRows = await db
    .select({ id: jobs.id, name: jobs.name })
    .from(jobs)
    .where(inArray(jobs.id, [...new Set(rows.map((row) => row.jobId))]));
  const jobName = new Map(jobRows.map((job) => [job.id, job.name]));
  return rows.map((row) => ({
    id: row.id,
    seq: row.seq,
    jobId: row.jobId,
    jobName: jobName.get(row.jobId) ?? '',
    version: row.version,
    trigger: row.trigger as RunView['trigger'],
    splf: row.splf,
    status: row.status as RunStatus,
    documents: row.documents,
    error: row.error,
    steps: row.steps,
    outputs: outputs.filter((o) => o.runId === row.id).map(({ id, name, size, contentType }) => ({ id, name, size, contentType })),
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }));
}

/** Filters of the job log. */
export interface RunFilter {
  jobId?: string;
  status?: RunStatus;
  from?: Date;
  to?: Date;
  /** Only runs with a lower `seq` (the next page). */
  before?: number;
  limit?: number;
}

/** A page of the job log, newest first, and the cursor of the next page. */
export async function listRuns(filter: RunFilter): Promise<{ runs: RunView[]; next: number | null }> {
  const where: SQL[] = [];
  if (filter.jobId && UUID.test(filter.jobId)) where.push(eq(runs.jobId, filter.jobId));
  if (filter.status) where.push(eq(runs.status, filter.status));
  if (filter.from) where.push(gte(runs.startedAt, filter.from));
  if (filter.to) where.push(lte(runs.startedAt, filter.to));
  if (filter.before) where.push(lt(runs.seq, filter.before));
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const rows = await getDb()
    .select()
    .from(runs)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(runs.seq))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return { runs: await runViews(page), next: rows.length > limit ? (page.at(-1)?.seq ?? null) : null };
}

/** One run by id, or null. */
export async function getRun(id: string): Promise<RunView | null> {
  if (!UUID.test(id)) {
    return null;
  }
  const rows = await getDb().select().from(runs).where(eq(runs.id, id));
  return (await runViews(rows))[0] ?? null;
}

/** The id when it is a UUID, else null. */
export function uuidOrNull(id: string): string | null {
  return UUID.test(id) ? id : null;
}
