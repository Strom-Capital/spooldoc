import 'server-only';

import { and, eq, inArray, isNotNull, isNull, lt, notExists, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb, getLocks } from './db';
import { jobs, jobVersions, runs, samples, templateFiles } from './db/schema';
import { log } from './log';

/** Rows deleted per statement, so no single delete holds its locks for long. */
const BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How often a running run touches its `heartbeat_at`. */
export const HEARTBEAT_MS = 30_000;
/**
 * A run still `running` whose heartbeat is this old was cut off (the process stopped
 * while it ran) and is marked failed. Several heartbeats, so a busy moment is not taken
 * for a stop.
 */
export const STALE_RUN_MS = 3 * 60_000;

/** What one cleanup deleted. */
export interface CleanupResult {
  runs: number;
  samples: number;
  /** Word template files no job draft or version uses any more. */
  templateFiles: number;
}

/** True when a job spec (a draft or a version) has a template with this Word file. */
const usesFile = (spec: SQL, fileId: SQL): SQL =>
  sql`${spec} @> jsonb_build_object('render', jsonb_build_object('templates', jsonb_build_array(jsonb_build_object('fileId', ${fileId}::text))))`;

/**
 * Mark runs failed that are still `running` but whose process stopped: their heartbeat
 * is older than `STALE_RUN_MS`. Safe with several instances, as each running run keeps
 * its own heartbeat.
 *
 * @returns How many runs were marked failed
 */
export async function failStaleRuns(now: Date = new Date()): Promise<number> {
  const failed = await getDb()
    .update(runs)
    .set({ status: 'failed', error: 'The run was cut off: the server stopped while it ran. Run the file again.', finishedAt: now })
    .where(and(eq(runs.status, 'running'), lt(runs.heartbeatAt, new Date(now.getTime() - STALE_RUN_MS))))
    .returning({ id: runs.id, jobId: runs.jobId, seq: runs.seq });
  for (const run of failed) log.warn('Marked a cut-off run as failed', { runId: run.id, seq: run.seq, jobId: run.jobId });
  return failed.length;
}

/**
 * Delete what is older than the retention: runs that finished before the cutoff (their
 * files go with them), samples captured by runs that no longer exist, and preview samples
 * captured before the cutoff that no job draft points at, and Word template files made
 * before the cutoff that no job draft or version uses. A file the agent replaced
 * is kept while the file a draft uses names it as its previous one, so the Word panel
 * can offer it back. Runs still running are kept,
 * and so are the `watch_seen` rows, which stop a spooled file from being processed again.
 * Runs a stopped process cut off are marked failed first (`failStaleRuns`), and kept for
 * the retention from then.
 *
 * @param retentionDays - How many days runs are kept
 * @param now - The current time
 * @returns What was deleted, or null when another instance is cleaning up
 */
export async function cleanUp(retentionDays: number, now: Date = new Date()): Promise<CleanupResult | null> {
  const release = await getLocks().tryLock('retention');
  if (!release) return null;
  try {
    const db = getDb();
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
    const result: CleanupResult = { runs: 0, samples: 0, templateFiles: 0 };

    await failStaleRuns(now);

    for (;;) {
      const old = db.select({ id: runs.id }).from(runs).where(lt(runs.finishedAt, cutoff)).limit(BATCH);
      const deleted = await db.delete(runs).where(inArray(runs.id, old)).returning({ id: runs.id });
      result.runs += deleted.length;
      if (deleted.length < BATCH) break;
    }

    const runGone = and(
      isNotNull(samples.runId),
      notExists(db.select({ one: sql`1` }).from(runs).where(sql`${runs.id} = ${samples.runId}`)),
    );
    const unusedPreview = and(
      isNull(samples.runId),
      lt(samples.capturedAt, cutoff),
      notExists(db.select({ one: sql`1` }).from(jobs).where(sql`${jobs.draft} -> 'preview' ->> 'sampleId' = ${samples.id}::text`)),
    );
    for (;;) {
      const unused = db.select({ id: samples.id }).from(samples).where(or(runGone, unusedPreview)).limit(BATCH);
      const deleted = await db.delete(samples).where(inArray(samples.id, unused)).returning({ id: samples.id });
      result.samples += deleted.length;
      if (deleted.length < BATCH) break;
    }

    const next = alias(templateFiles, 'next_file');
    const unusedFile = and(
      lt(templateFiles.createdAt, cutoff),
      notExists(db.select({ one: sql`1` }).from(jobs).where(usesFile(sql`${jobs.draft}`, sql`${templateFiles.id}`))),
      notExists(db.select({ one: sql`1` }).from(jobVersions).where(usesFile(sql`${jobVersions.spec}`, sql`${templateFiles.id}`))),
      notExists(
        db
          .select({ one: sql`1` })
          .from(next)
          .innerJoin(jobs, usesFile(sql`${jobs.draft}`, sql`${next.id}`))
          .where(eq(next.previousId, templateFiles.id)),
      ),
    );
    for (;;) {
      const unused = db.select({ id: templateFiles.id }).from(templateFiles).where(unusedFile).limit(BATCH);
      const deleted = await db.delete(templateFiles).where(inArray(templateFiles.id, unused)).returning({ id: templateFiles.id });
      result.templateFiles += deleted.length;
      if (deleted.length < BATCH) break;
    }
    return result;
  } finally {
    await release();
  }
}
