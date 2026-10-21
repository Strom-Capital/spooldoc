import 'server-only';

import { and, desc, eq, gte, inArray, lt, lte, sql, type SQL } from 'drizzle-orm';
import type { DeliveryKind, DeliveryView, RunStatus, RunView } from '@/lib/types';
import { getDb } from './db';
import { destinations, jobs, jobVersions, runDeliveries, runFiles, runs } from './db/schema';
import { UUID } from './servers';

type RunRow = typeof runs.$inferSelect;

/** The destination kinds that record a delivery per document in `run_deliveries`. */
const DELIVERY_KINDS: readonly DeliveryKind[] = ['email'];

/** Runs as the API returns them, with job names and delivered files (without their bytes). */
export async function runViews(rows: RunRow[]): Promise<RunView[]> {
  if (rows.length === 0) {
    return [];
  }
  const db = getDb();
  const ids = rows.map((row) => row.id);
  const files = await db
    .select({ id: runFiles.id, runId: runFiles.runId, name: runFiles.name, size: runFiles.size, contentType: runFiles.contentType, template: runFiles.template })
    .from(runFiles)
    .where(inArray(runFiles.runId, ids))
    .orderBy(runFiles.templateIndex, runFiles.pageGroupIndex);
  const deliveries = await db
    .select({
      id: runDeliveries.id,
      runId: runDeliveries.runId,
      kind: runDeliveries.kind,
      document: runDeliveries.document,
      to: runDeliveries.to,
      test: runDeliveries.test,
      status: runDeliveries.status,
      sentInRun: runDeliveries.sentInRun,
      error: runDeliveries.error,
      detail: runDeliveries.detail,
      sentAt: runDeliveries.sentAt,
    })
    .from(runDeliveries)
    .where(inArray(runDeliveries.runId, ids))
    .orderBy(sql`${runDeliveries.pageGroupIndex} asc nulls last`, runDeliveries.sentAt);
  const jobRows = await db
    .select({ id: jobs.id, name: jobs.name })
    .from(jobs)
    .where(inArray(jobs.id, [...new Set(rows.map((row) => row.jobId))]));
  const jobName = new Map(jobRows.map((job) => [job.id, job.name]));
  // The job versions of these runs whose destination records deliveries, with its kind.
  const deliveryVersions = await db
    .select({ jobId: jobVersions.jobId, number: jobVersions.number, kind: destinations.kind })
    .from(jobVersions)
    .innerJoin(destinations, sql`${destinations.id}::text = ${jobVersions.spec} -> 'destination' ->> 'destinationId'`)
    .where(and(inArray(jobVersions.jobId, [...new Set(rows.map((row) => row.jobId))]), inArray(destinations.kind, [...DELIVERY_KINDS])));
  const deliveryKind = new Map(deliveryVersions.map((version) => [`${version.jobId}/${version.number}`, version.kind as DeliveryKind]));
  return rows.map((row) => ({
    deliveryKind: deliveryKind.get(`${row.jobId}/${row.version}`) ?? null,
    id: row.id,
    seq: row.seq,
    jobId: row.jobId,
    jobName: jobName.get(row.jobId) ?? '',
    version: row.version,
    trigger: row.trigger as RunView['trigger'],
    splf: row.splf,
    status: row.status as RunStatus,
    pageGroups: row.pageGroups,
    error: row.error,
    steps: row.steps,
    files: files.filter((f) => f.runId === row.id).map(({ id, name, size, contentType, template }) => ({ id, name, size, contentType, template })),
    deliveries: deliveries
      .filter((d) => d.runId === row.id)
      .map((d) => ({ id: d.id, kind: d.kind as DeliveryKind, document: d.document, to: d.to, test: d.test, status: d.status as DeliveryView['status'], sentInRun: d.sentInRun, error: d.error, detail: d.detail, sentAt: d.sentAt.toISOString() })),
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
  if (filter.jobId) {
    // An id that is not a UUID is no job: no runs, rather than every job's.
    if (!UUID.test(filter.jobId)) return { runs: [], next: null };
    where.push(eq(runs.jobId, filter.jobId));
  }
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
