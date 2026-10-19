import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { splfKey } from '@/lib/job-spec';
import { jobs, runOutputs, runs, samples, settings, watchSeen } from '@/lib/server/db/schema';
import { resetTables } from './helpers/db';
import { loadSample } from './helpers/fake-connection';
import { db, insertJob, insertServer, testDb } from './helpers/fixtures';

vi.mock('@spooldoc/ibmi/jt400', async () => (await import('./helpers/mocks')).fakeJt400);

const { cleanUp, failStaleRuns, STALE_RUN_MS } = await import('@/lib/server/retention');
const { Watcher } = await import('@/lib/server/watcher');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-18T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const sample = loadSample('invoice');

let serverId: string;
let jobId: string;

/** A sample row, for a run or (without `runId`) a preview sample. */
async function insertSample(values: { runId?: string | null; capturedAt: Date; number?: number }): Promise<string> {
  const splf = { ...sample.splf, number: values.number ?? sample.splf.number };
  const [row] = await db()
    .insert(samples)
    .values({
      serverId,
      runId: values.runId ?? null,
      system: sample.system,
      splf,
      splfKey: splfKey(splf),
      attributes: sample.attributes,
      codePage: sample.codePage,
      raw: Buffer.from(sample.rawBase64, 'base64'),
      pages: sample.pages,
      capturedAt: values.capturedAt,
    })
    .returning({ id: samples.id });
  return row!.id;
}

/** A run with its captured sample, a delivered PDF and its `watch_seen` row. */
async function insertRun(values: { startedAt: Date; finishedAt: Date | null; number: number; heartbeatAt?: Date }): Promise<{ runId: string; sampleId: string }> {
  const splf = { ...sample.splf, number: values.number };
  const [run] = await db()
    .insert(runs)
    .values({
      jobId,
      version: 1,
      trigger: 'watch',
      splf,
      status: values.finishedAt ? 'success' : 'running',
      startedAt: values.startedAt,
      heartbeatAt: values.heartbeatAt ?? values.startedAt,
      finishedAt: values.finishedAt,
    })
    .returning({ id: runs.id });
  const runId = run!.id;
  const sampleId = await insertSample({ runId, capturedAt: values.startedAt, number: values.number });
  await db().update(runs).set({ sampleId }).where(eq(runs.id, runId));
  await db()
    .insert(runOutputs)
    .values({ runId, documentIndex: 0, name: 'invoice.pdf', contentType: 'application/pdf', size: 4, content: Buffer.from('%PDF') });
  await db().insert(watchSeen).values({ jobId, splfKey: splfKey(splf), runId, seenAt: values.startedAt });
  return { runId, sampleId };
}

async function ids<T extends { id: string }>(rows: Promise<T[]>): Promise<string[]> {
  return (await rows).map((row) => row.id).sort();
}

beforeEach(async () => {
  await resetTables(db());
  serverId = await insertServer();
  jobId = await insertJob(serverId);
});

describe('cleanUp', () => {
  it('deletes runs that finished before the retention, with their PDFs and samples', async () => {
    await insertRun({ startedAt: daysAgo(31), finishedAt: daysAgo(31), number: 1 });
    const recent = await insertRun({ startedAt: daysAgo(29), finishedAt: daysAgo(29), number: 2 });

    expect(await cleanUp(30, NOW)).toEqual({ runs: 1, samples: 1, templateFiles: 0 });

    expect(await ids(db().select({ id: runs.id }).from(runs))).toEqual([recent.runId]);
    expect((await db().select({ runId: runOutputs.runId }).from(runOutputs)).map((r) => r.runId)).toEqual([recent.runId]);
    expect(await ids(db().select({ id: samples.id }).from(samples))).toEqual([recent.sampleId]);
  });

  it('keeps every watch_seen row, so no spooled file is processed again', async () => {
    await insertRun({ startedAt: daysAgo(100), finishedAt: daysAgo(100), number: 1 });
    await insertRun({ startedAt: daysAgo(1), finishedAt: daysAgo(1), number: 2 });

    await cleanUp(30, NOW);

    const seen = await db().select().from(watchSeen);
    expect(seen).toHaveLength(2);
    expect(seen.find((s) => s.splfKey === splfKey({ ...sample.splf, number: 1 }))).toMatchObject({ jobId, runId: null });
  });

  it('keeps runs that are still running, and fails the ones a restart cut off', async () => {
    const cutOff = await insertRun({ startedAt: daysAgo(400), finishedAt: null, number: 1 });
    const running = await insertRun({ startedAt: new Date(NOW.getTime() - 60_000), finishedAt: null, number: 2 });

    expect(await cleanUp(30, NOW)).toEqual({ runs: 0, samples: 0, templateFiles: 0 });
    const rows = await db().select().from(runs);
    expect(rows.find((r) => r.id === cutOff.runId)).toMatchObject({ status: 'failed', finishedAt: NOW, error: expect.stringMatching(/cut off/) });
    expect(rows.find((r) => r.id === running.runId)).toMatchObject({ status: 'running', finishedAt: null });
  });

  it('fails a running run as soon as its heartbeat is stale, however long it has run', async () => {
    const minutes = (n: number) => new Date(NOW.getTime() - n * 60_000);
    const long = await insertRun({ startedAt: daysAgo(1), heartbeatAt: minutes(1), finishedAt: null, number: 1 });
    const stopped = await insertRun({ startedAt: minutes(5), heartbeatAt: new Date(NOW.getTime() - STALE_RUN_MS - 1000), finishedAt: null, number: 2 });
    const done = await insertRun({ startedAt: daysAgo(1), finishedAt: daysAgo(1), number: 3 });

    expect(await failStaleRuns(NOW)).toBe(1);
    const rows = await db().select().from(runs);
    expect(rows.find((r) => r.id === stopped.runId)).toMatchObject({ status: 'failed', finishedAt: NOW, error: expect.stringMatching(/cut off/) });
    expect(rows.find((r) => r.id === long.runId)).toMatchObject({ status: 'running', finishedAt: null });
    expect(rows.find((r) => r.id === done.runId)).toMatchObject({ status: 'success' });
  });

  it('deletes samples of runs that are gone, such as those of a deleted job', async () => {
    const { sampleId } = await insertRun({ startedAt: daysAgo(1), finishedAt: daysAgo(1), number: 1 });
    await db().delete(jobs).where(eq(jobs.id, jobId));

    expect(await cleanUp(30, NOW)).toEqual({ runs: 0, samples: 1, templateFiles: 0 });
    expect(await db().select().from(samples).where(eq(samples.id, sampleId))).toEqual([]);
  });

  it('deletes old preview samples no job draft points at', async () => {
    const used = await insertSample({ capturedAt: daysAgo(200), number: 1 });
    await insertSample({ capturedAt: daysAgo(200), number: 2 });
    const fresh = await insertSample({ capturedAt: daysAgo(2), number: 3 });
    const [job] = await db().select().from(jobs).where(eq(jobs.id, jobId));
    await db()
      .update(jobs)
      .set({ draft: { ...job!.draft, preview: { sampleId: used } } })
      .where(eq(jobs.id, jobId));

    expect(await cleanUp(30, NOW)).toEqual({ runs: 0, samples: 1, templateFiles: 0 });
    expect(await ids(db().select({ id: samples.id }).from(samples))).toEqual([used, fresh].sort());
  });

  it('deletes in batches when there is a lot to delete', async () => {
    const values = Array.from({ length: 1201 }, (_, i) => ({
      jobId,
      version: 1,
      trigger: 'watch',
      splf: { ...sample.splf, number: i + 1 },
      status: 'success',
      startedAt: daysAgo(100),
      finishedAt: daysAgo(100),
    }));
    await db().insert(runs).values(values);

    expect(await cleanUp(30, NOW)).toEqual({ runs: 1201, samples: 0, templateFiles: 0 });
    expect(await db().select().from(runs)).toEqual([]);
  });

  it('does nothing while another instance is cleaning up', async () => {
    await insertRun({ startedAt: daysAgo(100), finishedAt: daysAgo(100), number: 1 });
    const release = await testDb().locks.tryLock('retention');

    expect(await cleanUp(30, NOW)).toBeNull();
    expect(await db().select().from(runs)).toHaveLength(1);

    await release!();
    expect(await cleanUp(30, NOW)).toEqual({ runs: 1, samples: 1, templateFiles: 0 });
  });
});

describe('watcher cleanup', () => {
  let clock: number;
  let watcher: InstanceType<typeof Watcher>;

  beforeEach(() => {
    clock = NOW.getTime();
    watcher = new Watcher({ now: () => clock, readWaitSeconds: 0 });
  });

  afterEach(async () => {
    await watcher.stop();
  });

  it('cleans up with the retention from the settings, at most once an hour', async () => {
    await db().update(settings).set({ retentionDays: 10 });
    await insertRun({ startedAt: daysAgo(11), finishedAt: daysAgo(11), number: 1 });
    const kept = await insertRun({ startedAt: daysAgo(9), finishedAt: daysAgo(9), number: 2 });

    await watcher.tick();
    expect(await ids(db().select({ id: runs.id }).from(runs))).toEqual([kept.runId]);
    expect(watcher.cleanup).toEqual({ at: NOW.toISOString(), runs: 1, samples: 1, templateFiles: 0 });

    await insertRun({ startedAt: daysAgo(20), finishedAt: daysAgo(20), number: 3 });
    clock += 30 * 60_000;
    await watcher.tick();
    expect(await db().select().from(runs)).toHaveLength(2);

    clock += 31 * 60_000;
    await watcher.tick();
    expect(await ids(db().select({ id: runs.id }).from(runs))).toEqual([kept.runId]);
  });

  it('fails runs a stopped process cut off within minutes, not at the hourly cleanup', async () => {
    await watcher.tick(); // the hourly cleanup is done
    const cutOff = await insertRun({ startedAt: new Date(clock - 60_000), finishedAt: null, number: 1 });
    clock += STALE_RUN_MS + 61_000;
    await watcher.tick();
    const [run] = await db().select().from(runs).where(eq(runs.id, cutOff.runId));
    expect(run).toMatchObject({ status: 'failed', error: expect.stringMatching(/cut off/) });
  });
});
