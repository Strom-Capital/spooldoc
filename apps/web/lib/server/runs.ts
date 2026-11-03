import 'server-only';

import { and, desc, eq, gte, inArray, lt, lte, sql, type SQL } from 'drizzle-orm';
import type { JobSpec } from '@/lib/job-spec';
import type { DeliveryKind, DeliveryView, RunStatus, RunView } from '@/lib/types';
import { getDb } from './db';
import { destinations, jobs, jobVersions, runDeliveries, runFiles, runs } from './db/schema';
import { UUID } from './servers';

type RunRow = typeof runs.$inferSelect;

/** The destination kinds that record a delivery per document in `run_deliveries`. */
const DELIVERY_KINDS: readonly DeliveryKind[] = ['email', 'webhook', 'sftp'];

/** The most of a receiver's answer the Job log shows. One more character is stored, to tell it was cut. */
export const RESPONSE_LIMIT = 2048;

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
      destinationId: runDeliveries.destinationId,
      kind: runDeliveries.kind,
      document: runDeliveries.document,
      to: runDeliveries.to,
      test: runDeliveries.test,
      status: runDeliveries.status,
      sentInRun: runDeliveries.sentInRun,
      error: runDeliveries.error,
      detail: runDeliveries.detail,
      httpStatus: runDeliveries.httpStatus,
      attempts: runDeliveries.attempts,
      ms: runDeliveries.ms,
      response: runDeliveries.response,
      size: runDeliveries.size,
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
  const deliveryTargets = await versionDeliveryTargets(rows);
  return rows.map((row) => ({
    deliveryTargets: deliveryTargets.get(`${row.jobId}/${row.version}`) ?? [],
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
      .map((d) => ({
        id: d.id,
        destinationId: d.destinationId,
        kind: d.kind as DeliveryKind,
        document: d.document,
        to: d.to,
        test: d.test,
        status: d.status as DeliveryView['status'],
        sentInRun: d.sentInRun,
        error: d.error,
        detail: d.detail,
        httpStatus: d.httpStatus,
        attempts: d.attempts,
        ms: d.ms,
        response: d.response === null ? null : d.response.slice(0, RESPONSE_LIMIT),
        responseTruncated: d.response !== null && d.response.length > RESPONSE_LIMIT,
        size: d.size,
        sentAt: d.sentAt.toISOString(),
      })),
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }));
}

/** The destinations a job version delivers to, in its order: for now, the one destination of the job. */
const specDestinationIds = (destination: JobSpec['destination'] | null): string[] => (destination?.destinationId ? [destination.destinationId] : []);

/**
 * The destinations that record deliveries of the job versions of these runs, by `jobId/number`:
 * every destination of the version whose kind records them, in order, each once.
 */
async function versionDeliveryTargets(rows: RunRow[]): Promise<Map<string, RunView['deliveryTargets']>> {
  const db = getDb();
  const versions = await db
    .select({ jobId: jobVersions.jobId, number: jobVersions.number, destination: sql<JobSpec['destination'] | null>`${jobVersions.spec} -> 'destination'` })
    .from(jobVersions)
    .where(inArray(jobVersions.jobId, [...new Set(rows.map((row) => row.jobId))]));
  const ids = new Map(versions.map((version) => [`${version.jobId}/${version.number}`, [...new Set(specDestinationIds(version.destination))]]));
  const all = [...new Set([...ids.values()].flat())];
  const found =
    all.length === 0
      ? []
      : await db
          .select({ id: destinations.id, name: destinations.name, kind: destinations.kind })
          .from(destinations)
          .where(and(inArray(destinations.id, all), inArray(destinations.kind, [...DELIVERY_KINDS])));
  const byId = new Map(found.map((destination) => [destination.id, destination]));
  return new Map(
    [...ids].map(([key, list]) => [
      key,
      list.flatMap((id) => {
        const destination = byId.get(id);
        return destination ? [{ destinationId: id, name: destination.name, kind: destination.kind as DeliveryKind }] : [];
      }),
    ]),
  );
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
