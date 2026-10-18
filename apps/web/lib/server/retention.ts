import 'server-only';

import { and, eq, inArray, isNotNull, isNull, lt, notExists, or, sql } from 'drizzle-orm';
import { getDb, getLocks } from './db';
import { jobs, runs, samples } from './db/schema';

/** Rows deleted per statement, so no single delete holds its locks for long. */
const BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * A run still `running` this long after it started was cut off (the server stopped
 * while it ran) and is marked failed. Far longer than any run takes.
 */
export const STALE_RUN_MS = 6 * 60 * 60 * 1000;

/** What one cleanup deleted. */
export interface CleanupResult {
  runs: number;
  samples: number;
}

/**
 * Delete what is older than the retention: runs that finished before the cutoff (their
 * files go with them), samples captured by runs that no longer exist, and preview samples
 * captured before the cutoff that no job draft points at. Runs still running are kept,
 * and so are the `watch_seen` rows, which stop a spooled file from being processed again.
 * A run still running `STALE_RUN_MS` after it started was cut off by a restart: it is
 * marked failed first, and kept for the retention from then.
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
    const result: CleanupResult = { runs: 0, samples: 0 };

    await db
      .update(runs)
      .set({ status: 'failed', error: 'The run was cut off: the server stopped while it ran. Run the file again.', finishedAt: now })
      .where(and(eq(runs.status, 'running'), lt(runs.startedAt, new Date(now.getTime() - STALE_RUN_MS))));

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
    return result;
  } finally {
    await release();
  }
}
