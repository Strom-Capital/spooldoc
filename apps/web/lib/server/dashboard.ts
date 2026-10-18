import 'server-only';

import { and, count, desc, eq, gte, type SQL, sql } from 'drizzle-orm';
import type { DashboardRange, DashboardView, RunBucket } from '@/lib/types';
import { getDb } from './db';
import { jobs, runs, servers } from './db/schema';
import { describeModel } from './models';
import { watchedJobs, watchStatus } from './watcher';

/** The ranges of the runs chart: how many buckets of which unit. */
export const RANGES: Record<DashboardRange, { unit: 'hour' | 'day'; buckets: number }> = {
  '24h': { unit: 'hour', buckets: 24 },
  '7d': { unit: 'day', buckets: 7 },
  '30d': { unit: 'day', buckets: 30 },
  '90d': { unit: 'day', buckets: 90 },
};

const ZONES = new Set(Intl.supportedValuesOf('timeZone'));

/** The viewer's time zone when it is a known zone name, else UTC. */
export function safeZone(tz: string | null | undefined): string {
  return tz && ZONES.has(tz) ? tz : 'UTC';
}

/** The first and last bucket of the range as local times, and the bucket length. */
function bounds(range: DashboardRange, tz: string): { first: SQL; last: SQL; step: SQL } {
  const { unit, buckets } = RANGES[range];
  const step = sql.raw(`interval '1 ${unit}'`);
  const last = sql`date_trunc(${unit}, now() at time zone ${tz})`;
  return { first: sql`(${last} - ${sql.raw(`interval '${buckets - 1} ${unit}'`)})`, last, step };
}

/** The start of the range as an instant. */
function since(range: DashboardRange, tz: string): SQL {
  return sql`(${bounds(range, tz).first} at time zone ${tz})`;
}

/**
 * Runs per bucket and status over the range, in the viewer's time zone so days start at
 * their midnight. Every bucket is there, empty ones as zeros. Running runs are left out.
 */
export async function runSeries(range: DashboardRange, tz: string): Promise<RunBucket[]> {
  const { unit } = RANGES[range];
  const db = getDb();
  const { first, last, step } = bounds(range, tz);
  const label = (value: SQL) => sql<string>`to_char(${value}, 'YYYY-MM-DD"T"HH24:00')`;

  const slots = await db
    .select({ at: label(sql`g`) })
    .from(sql`generate_series(${first}, ${last}, ${step}) as g`);
  const bucket = sql`date_trunc(${unit}, ${runs.startedAt} at time zone ${tz})`;
  const counted = await db
    .select({ at: label(bucket), status: runs.status, n: count() })
    .from(runs)
    .where(gte(runs.startedAt, since(range, tz)))
    // By position: the bucket repeats its parameters, so Postgres would not see the same expression.
    .groupBy(sql`1, 2`);

  const series = new Map<string, RunBucket>(slots.map(({ at }) => [at, { at, success: 0, warning: 0, failed: 0, skipped: 0 }]));
  for (const row of counted) {
    const slot = series.get(row.at);
    if (slot && row.status !== 'running') slot[row.status as Exclude<keyof RunBucket, 'at'>] += row.n;
  }
  return [...series.values()];
}

/** Everything the Home page shows. */
export async function dashboard(range: DashboardRange, tz: string): Promise<DashboardView> {
  const db = getDb();
  const [serverRows, jobRows, [logged], [anyRun], model, watched, series] = await Promise.all([
    db.select({ id: servers.id, name: servers.name, dataQueue: servers.dtaqName, lastCheckedAt: servers.lastCheckedAt, lastError: servers.lastError }).from(servers).orderBy(servers.name),
    db.select({ id: jobs.id, name: jobs.name, paused: jobs.paused, lastWatchError: jobs.lastWatchError }).from(jobs).orderBy(jobs.name),
    db.select({ n: count() }).from(runs),
    db.select({ id: runs.id }).from(runs).limit(1),
    describeModel(),
    watchedJobs(),
    runSeries(range, tz),
  ]);
  const failed = await db
    .select({ id: runs.id, seq: runs.seq, jobId: runs.jobId, jobName: jobs.name, error: runs.error, startedAt: runs.startedAt })
    .from(runs)
    .innerJoin(jobs, eq(jobs.id, runs.jobId))
    .where(and(eq(runs.status, 'failed'), gte(runs.startedAt, since(range, tz))))
    .orderBy(desc(runs.startedAt))
    .limit(5);

  const totals = series.reduce(
    (sum, b) => ({ success: sum.success + b.success, warning: sum.warning + b.warning, failed: sum.failed + b.failed, skipped: sum.skipped + b.skipped }),
    { success: 0, warning: 0, failed: 0, skipped: 0 },
  );
  return {
    setup: {
      server: serverRows.some((s) => s.lastCheckedAt && !s.lastError),
      ai: model !== null,
      job: jobRows.length > 0,
      run: !!anyRun,
    },
    servers: { total: serverRows.length, failing: serverRows.filter((s) => s.lastError).length },
    dataQueues: { total: serverRows.filter((s) => s.dataQueue).length, ...watchStatus() },
    jobs: { total: jobRows.length, watching: watched.length, paused: jobRows.filter((j) => j.paused).length },
    runs: { ...totals, logged: logged?.n ?? 0 },
    series,
    attention: {
      servers: serverRows.filter((s) => s.lastError).map((s) => ({ id: s.id, name: s.name, error: s.lastError! })),
      jobs: jobRows.filter((j) => j.lastWatchError).map((j) => ({ id: j.id, name: j.name, error: j.lastWatchError! })),
      runs: failed.map((r) => ({ ...r, startedAt: r.startedAt.toISOString() })),
    },
  };
}
