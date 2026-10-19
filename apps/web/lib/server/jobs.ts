import 'server-only';

import { parseDefinition } from '@spooldoc/core';
import { and, desc, eq, isNotNull, max, sql } from 'drizzle-orm';
import type { ZodError } from 'zod';
import { deleteNotice, emptySpec, jobSpecSchema, missingParts, startsDeleting, versionSpec, type JobSpec } from '@/lib/job-spec';
import type { JobDetail, JobSummary, RunStatus } from '@/lib/types';
import { getDb, type Db, type Tx } from './db';
import { destinations, jobs, jobVersions, queueHealth, runs, servers } from './db/schema';
import { UUID } from './servers';

export type JobRow = typeof jobs.$inferSelect;

/** A job row by id, or null. */
export async function getJobRow(id: string, db: Db | Tx = getDb()): Promise<JobRow | null> {
  if (!UUID.test(id)) {
    return null;
  }
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row ?? null;
}

/** The built-in Spooldoc destination's id. */
export async function builtinDestinationId(db: Db | Tx = getDb()): Promise<string | null> {
  const [row] = await db.select({ id: destinations.id }).from(destinations).where(eq(destinations.builtin, true)).limit(1);
  return row?.id ?? null;
}

/**
 * Create a job. A source queue may be given; the destination is the built-in one.
 *
 * @returns The new job's id
 */
export async function createJob(input: { serverId?: string; library?: string; queue?: string; name?: string; userId: string }): Promise<string> {
  const db = getDb();
  const destinationId = (await builtinDestinationId(db)) ?? undefined;
  const draft = emptySpec({ serverId: input.serverId, library: input.library, queue: input.queue, destinationId });
  const name = input.name?.trim() || (input.library && input.queue ? `${input.library}/${input.queue}` : 'New job');
  const [row] = await db.insert(jobs).values({ name, draft, createdBy: input.userId }).returning({ id: jobs.id });
  return row!.id;
}

/** A job with its version list. */
export async function jobDetail(row: JobRow): Promise<JobDetail> {
  const draft = jobSpecSchema.parse(row.draft);
  const [versions, realtimeError] = await Promise.all([
    getDb()
      .select({ number: jobVersions.number, note: jobVersions.note, createdAt: jobVersions.createdAt, createdBy: jobVersions.createdBy })
      .from(jobVersions)
      .where(eq(jobVersions.jobId, row.id))
      .orderBy(desc(jobVersions.number)),
    sourceRealtimeError(row, draft),
  ]);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    draft,
    activeVersion: row.activeVersion,
    paused: row.paused,
    lastWatchAt: row.lastWatchAt?.toISOString() ?? null,
    lastWatchError: row.lastWatchError,
    realtimeError,
    versions: versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() })),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Why the queue the job reads from (by its active version, else the draft) is polled
 * although it sends to the server's data queue, as the watcher recorded it.
 */
async function sourceRealtimeError(row: JobRow, draft: JobSpec): Promise<JobDetail['realtimeError']> {
  const active = await activeSpec(row).catch(() => null);
  const { serverId, library, queue } = (active ?? draft).source;
  if (!serverId || !library || !queue) {
    return null;
  }
  const [health] = await getDb()
    .select({ error: queueHealth.realtimeError, since: queueHealth.realtimeErrorSince })
    .from(queueHealth)
    .where(and(eq(queueHealth.serverId, serverId), eq(queueHealth.library, library), eq(queueHealth.name, queue), isNotNull(queueHealth.realtimeError)));
  return health?.error ? { error: health.error, since: (health.since ?? new Date()).toISOString() } : null;
}

/** "trigger.mode: Invalid option", the first problem of a spec that does not parse. */
function specProblem(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'It does not match the job format.';
  return issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
}

/** The spec of a job's active version, or null when no version is active. */
export async function activeSpec(job: JobRow, db: Db | Tx = getDb()): Promise<JobSpec | null> {
  if (job.activeVersion === null) {
    return null;
  }
  const [row] = await db
    .select({ spec: jobVersions.spec })
    .from(jobVersions)
    .where(and(eq(jobVersions.jobId, job.id), eq(jobVersions.number, job.activeVersion)));
  return row ? jobSpecSchema.parse(row.spec) : null;
}

/**
 * Every job, by name, with its source server name and last run. A job whose active
 * version or draft no longer reads as a spec (after an upgrade, for example) is listed
 * with `broken` saying why, instead of failing the list.
 */
export async function listJobs(): Promise<JobSummary[]> {
  const db = getDb();
  const [rows, serverRows, versionRows, activeRows, lastRuns] = await Promise.all([
    db.select().from(jobs).orderBy(jobs.name),
    db.select({ id: servers.id, name: servers.name }).from(servers),
    db
      .select({ jobId: jobVersions.jobId, n: max(jobVersions.number) })
      .from(jobVersions)
      .groupBy(jobVersions.jobId),
    db
      .select({ jobId: jobVersions.jobId, spec: jobVersions.spec })
      .from(jobVersions)
      .innerJoin(jobs, and(eq(jobs.id, jobVersions.jobId), eq(jobs.activeVersion, jobVersions.number))),
    db
      .selectDistinctOn([runs.jobId], { jobId: runs.jobId, id: runs.id, seq: runs.seq, status: runs.status, startedAt: runs.startedAt })
      .from(runs)
      .orderBy(runs.jobId, desc(runs.startedAt)),
  ]);
  const serverName = new Map(serverRows.map((s) => [s.id, s.name]));
  const versionCount = new Map(versionRows.map((v) => [v.jobId, v.n ?? 0]));
  const activeBy = new Map(activeRows.map((a) => [a.jobId, jobSpecSchema.safeParse(a.spec)]));
  const lastRun = new Map(lastRuns.map((r) => [r.jobId, r]));

  return rows.map((row) => {
    const active = activeBy.get(row.id);
    const draft = jobSpecSchema.safeParse(row.draft);
    const broken =
      active && !active.success
        ? `The active version cannot be read (${specProblem(active.error)}). Save the job as a new version.`
        : !draft.success
          ? `The draft cannot be read (${specProblem(draft.error)}).`
          : null;
    // What is shown comes from the active version, else the draft, else an empty job.
    const spec = (active?.success ? active.data : null) ?? (draft.success ? draft.data : emptySpec());
    const run = lastRun.get(row.id);
    return {
      id: row.id,
      name: row.name,
      source: {
        serverId: spec.source.serverId,
        serverName: spec.source.serverId ? (serverName.get(spec.source.serverId) ?? null) : null,
        library: spec.source.library,
        queue: spec.source.queue,
      },
      mode: active?.success ? active.data.trigger.mode : 'manual',
      finish: spec.finish.action,
      paused: row.paused,
      activeVersion: row.activeVersion,
      versions: versionCount.get(row.id) ?? 0,
      lastWatchAt: row.lastWatchAt?.toISOString() ?? null,
      lastWatchError: row.lastWatchError,
      broken,
      lastRun: run ? { id: run.id, seq: run.seq, status: run.status as RunStatus, startedAt: run.startedAt.toISOString() } : null,
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

/** Thrown when a draft cannot be saved as a version, with one line per problem. */
export class IncompleteJobError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('\n'));
    this.name = 'IncompleteJobError';
  }
}

/**
 * Making a version active that deletes spooled files, when the active version did not,
 * needs the user's confirmation: it is the one thing Spooldoc does that cannot be undone
 * on the IBM i.
 */
export class ConfirmDeleteError extends Error {
  readonly queue: string;
  constructor(spec: JobSpec) {
    super(deleteNotice(spec));
    this.name = 'ConfirmDeleteError';
    this.queue = `${spec.source.library}/${spec.source.queue}`;
  }
}

/**
 * Problems that keep a spec from being saved as a version: missing parts and a
 * definition that does not parse.
 */
export function versionProblems(spec: JobSpec): string[] {
  const problems = missingParts(spec);
  if (spec.extract.definition.trim()) {
    try {
      parseDefinition(spec.extract.definition);
    } catch (error) {
      problems.push(`Extract: the definition has errors. ${error instanceof Error ? error.message.split('\n')[0] : ''}`.trim());
    }
  }
  return problems;
}

/**
 * Save a job's draft as the next version.
 *
 * @param activate - Make the new version the one runs use
 * @throws IncompleteJobError when the draft is not complete
 * @returns The new version number
 */
export async function saveVersion(
  job: JobRow,
  input: { note: string; activate: boolean; userId: string; confirmDelete?: boolean },
): Promise<number> {
  const spec = versionSpec(jobSpecSchema.parse(job.draft));
  const problems = versionProblems(spec);
  if (problems.length > 0) {
    throw new IncompleteJobError(problems);
  }
  return getDb().transaction(async (tx) => {
    // Lock the job row so two saves cannot take the same number.
    await tx.execute(sql`select id from jobs where id = ${job.id} for update`);
    const [last] = await tx.select({ n: max(jobVersions.number) }).from(jobVersions).where(eq(jobVersions.jobId, job.id));
    const number = (last?.n ?? 0) + 1;
    await tx.insert(jobVersions).values({ jobId: job.id, number, spec, note: input.note, createdBy: input.userId });
    if (input.activate) {
      await activate(tx, job, number, spec, input.confirmDelete ?? false);
    }
    return number;
  });
}

/**
 * Make a version the active one. Turning watching on (from a manual or no version)
 * starts it from now: the watcher first records the files already on the queue and
 * leaves them for Run now, unless the version's trigger has `backlog`, which runs them.
 * A version that starts deleting spooled files throws `ConfirmDeleteError` unless
 * `confirmDelete` is set.
 */
async function activate(tx: Tx, job: JobRow, number: number, spec: JobSpec, confirmDelete: boolean): Promise<void> {
  const before = await activeSpec(job, tx);
  if (startsDeleting(spec, before) && !confirmDelete) {
    throw new ConfirmDeleteError(spec);
  }
  const startsWatching = spec.trigger.mode === 'watch' && before?.trigger.mode !== 'watch';
  // Turning the backlog or held files on while watching takes stock again: the waiting
  // files are run (backlog) or set aside (no backlog) with the new statuses.
  const retakes =
    spec.trigger.mode === 'watch' &&
    ((spec.trigger.backlog && !before?.trigger.backlog) || (spec.trigger.includeHeld && !before?.trigger.includeHeld));
  await tx
    .update(jobs)
    // lastWatchAt null makes the watcher take stock of the queue before it runs anything.
    .set({
      activeVersion: number,
      ...(startsWatching ? { watchSince: new Date(), lastWatchAt: null, lastWatchError: null, watchErrorDismissed: null } : {}),
      ...(retakes && !startsWatching ? { lastWatchAt: null } : {}),
    })
    .where(eq(jobs.id, job.id));
}

/** Make an existing version active. Returns false when there is no such version. */
export async function activateVersion(job: JobRow, number: number, options: { confirmDelete?: boolean } = {}): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [version] = await tx
      .select({ spec: jobVersions.spec })
      .from(jobVersions)
      .where(and(eq(jobVersions.jobId, job.id), eq(jobVersions.number, number)));
    if (!version) {
      return false;
    }
    await activate(tx, job, number, jobSpecSchema.parse(version.spec), options.confirmDelete ?? false);
    return true;
  });
}

/** Copy a version into the draft, keeping the draft's preview file. Returns the new draft or null. */
export async function restoreVersion(job: JobRow, number: number): Promise<JobSpec | null> {
  const db = getDb();
  const [version] = await db
    .select({ spec: jobVersions.spec })
    .from(jobVersions)
    .where(and(eq(jobVersions.jobId, job.id), eq(jobVersions.number, number)));
  if (!version) {
    return null;
  }
  const current = jobSpecSchema.parse(job.draft);
  const draft = { ...jobSpecSchema.parse(version.spec), preview: current.preview };
  await db.update(jobs).set({ draft }).where(eq(jobs.id, job.id));
  return draft;
}
