import { encoderFor } from '@spooldoc/core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySpec, splfKey } from '@/lib/job-spec';
import { jobs, jobVersions, queueHealth, runs, servers, settings, watchSeen } from '@/lib/server/db/schema';
import { resetTables } from './helpers/db';
import { FakeConnection, fixtureText, loadSample } from './helpers/fake-connection';
import { builtinDestination, db, insertServer, testDb } from './helpers/fixtures';
import { connections } from './helpers/mocks';

vi.mock('@spooldoc/ibmi/jt400', async () => (await import('./helpers/mocks')).fakeJt400);
vi.mock('@/lib/server/pdf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/pdf')>()),
  loadPdf: async () => ({ renderPdf: async () => new TextEncoder().encode('%PDF') }),
}));

const { Watcher } = await import('@/lib/server/watcher');
const { connectServer } = await import('@/lib/server/ibmi');
const { setLogSink } = await import('@/lib/server/log');
const { HEARTBEAT_MS } = await import('@/lib/server/retention');
const { setPdfRenderer } = await import('@/lib/server/runner');

const sample = loadSample('invoice');
const { library, name: queue } = sample.attributes.queue;
const key = splfKey(sample.splf);

let serverId: string;
let clock: number;
let watcher: InstanceType<typeof Watcher>;

const fake = (): FakeConnection => connections.get('ibmi.example.com|DEMOUSER')!;

/** A job watching the invoice queue, with an active version. */
async function watchingJob(overrides: { paused?: boolean; backlog?: boolean; includeHeld?: boolean } = {}): Promise<string> {
  const spec = {
    ...emptySpec({ serverId, library, queue, destinationId: await builtinDestination() }),
    trigger: { mode: 'watch' as const, backlog: overrides.backlog ?? false, includeHeld: overrides.includeHeld ?? false },
    extract: { definition: fixtureText('invoice', 'definition.yaml') },
  };
  const [job] = await db()
    .insert(jobs)
    .values({ name: 'Invoices', draft: spec, activeVersion: 1, paused: overrides.paused ?? false, watchSince: new Date() })
    .returning();
  await db().insert(jobVersions).values({ jobId: job!.id, number: 1, spec });
  return job!.id;
}

async function runRows() {
  return db().select().from(runs);
}

beforeEach(async () => {
  await resetTables(db());
  connections.clear();
  serverId = await insertServer();
  clock = 1_000_000;
  watcher = new Watcher({ now: () => clock, readWaitSeconds: 0 });
});

afterEach(async () => {
  await watcher.stop();
  setLogSink(null);
  process.env.SPOOLDOC_LOG_LEVEL = 'off';
});

/** Catch the log lines from here on. */
function captureLog(): { level: string; msg: string; [field: string]: unknown }[] {
  const lines: { level: string; msg: string }[] = [];
  process.env.SPOOLDOC_LOG_LEVEL = 'info';
  setLogSink((line) => lines.push(JSON.parse(line)));
  return lines;
}

/** Watch the invoice queue in real time through MYLIB/SPOOLDOC, until the reader is connected. */
async function realtimeJob(): Promise<void> {
  await db().update(servers).set({ dtaqLibrary: library, dtaqName: 'SPOOLDOC' }).where(eq(servers.id, serverId));
  await db().update(settings).set({ pollSeconds: 3600, safetyCheckSeconds: 86400 });
  await watchingJob();
  await watcher.tick();
  fake().dataQueues.set(`${library}/${queue}`, { library, name: 'SPOOLDOC' });
  clock += 61_000;
  await vi.waitFor(async () => {
    await watcher.tick();
    expect(watcher.status.realtime).toBe(1);
  });
}

describe('watcher', () => {
  it('first takes stock of the files already ready, then runs only new ones, once', async () => {
    const jobId = await watchingJob();
    const conn = new FakeConnection();
    connections.set('ibmi.example.com|DEMOUSER', conn);
    conn.status.set(key, 'READY');

    await watcher.tick();
    expect(await runRows()).toEqual([]);
    clock += 31_000;
    await watcher.tick();
    expect(await runRows()).toEqual([]);
    const [seen] = await db().select().from(watchSeen);
    expect(seen).toMatchObject({ jobId, splfKey: key, runId: null });
    const [job] = await db().select().from(jobs).where(eq(jobs.id, jobId));
    expect(job!.lastWatchAt).toBeInstanceOf(Date);
  });

  it('with the backlog on, runs the ready files already on the queue, once', async () => {
    await watchingJob({ backlog: true });
    const conn = new FakeConnection();
    connections.set('ibmi.example.com|DEMOUSER', conn);
    conn.status.set(key, 'READY');

    await watcher.tick();
    const [run] = await runRows();
    expect(run).toMatchObject({ status: 'success', trigger: 'watch' });
    clock += 31_000;
    await watcher.tick();
    expect(await runRows()).toHaveLength(1);
  });

  it('runs files an earlier stock-taking set aside once the backlog is turned on', async () => {
    const jobId = await watchingJob();
    const conn = new FakeConnection();
    connections.set('ibmi.example.com|DEMOUSER', conn);
    conn.status.set(key, 'READY');
    await watcher.tick();
    expect(await runRows()).toEqual([]);

    // A new active version with the backlog on (what activating it does to the job).
    const [version] = await db().select().from(jobVersions).where(eq(jobVersions.jobId, jobId));
    const spec = { ...version!.spec, trigger: { mode: 'watch' as const, backlog: true, includeHeld: false } };
    await db().insert(jobVersions).values({ jobId, number: 2, spec });
    await db().update(jobs).set({ activeVersion: 2, lastWatchAt: null }).where(eq(jobs.id, jobId));
    await watcher.tick();
    expect(await runRows()).toHaveLength(1);
  });

  it('runs a file that becomes ready after watching started, holds it and does not run it again', async () => {
    await watchingJob();
    await watcher.tick(); // takes stock: nothing ready yet
    fake().status.set(key, 'READY');
    clock += 31_000;
    await watcher.tick();
    const [run] = await runRows();
    expect(run).toMatchObject({ status: 'success', trigger: 'watch', documents: 6 });
    expect(fake().actions()).toEqual(['holdSpooledFile']);

    // Still READY on the fake (it does not change status): the job remembers the file.
    clock += 31_000;
    await watcher.tick();
    expect(await runRows()).toHaveLength(1);
  });

  it('asks the IBM i only for ready files with the job filters', async () => {
    const jobId = await watchingJob();
    const [version] = await db().select().from(jobVersions).where(eq(jobVersions.jobId, jobId));
    const filter = { splf: 'SPD', userData: '', jobName: 'QPRTJOB', jobUser: 'DEMOUSER', formType: '' };
    await db().insert(jobVersions).values({ jobId, number: 2, spec: { ...version!.spec, source: { ...version!.spec.source, filter } } });
    await db().update(jobs).set({ activeVersion: 2 }).where(eq(jobs.id, jobId));
    await watcher.tick();
    const call = fake().calls.find((c) => c.method === 'listSpooledFiles');
    expect(call?.args[1]).toMatchObject({ status: ['READY'], name: 'SPD', jobName: 'QPRTJOB', jobUser: 'DEMOUSER' });
    expect(call?.args[1]).not.toHaveProperty('formType', '');
  });

  it('lists every file when taking stock, and the usual page after that', async () => {
    await watchingJob();
    await watcher.tick();
    clock += 31_000;
    await watcher.tick();
    const limits = fake()
      .calls.filter((c) => c.method === 'listSpooledFiles')
      .map((c) => (c.args[1] as { limit?: number }).limit);
    expect(limits).toEqual([10_000, 500]);
  });

  it('keeps watching other jobs when one active version cannot be read', async () => {
    const good = await watchingJob({ backlog: true });
    const [broken] = await db().insert(jobs).values({ name: 'Broken', draft: emptySpec({}), activeVersion: 1 }).returning();
    // A spec from before a schema change, say: it no longer reads as one.
    await db().insert(jobVersions).values({ jobId: broken!.id, number: 1, spec: { source: 'not a spec' } as never });
    const conn = new FakeConnection();
    connections.set('ibmi.example.com|DEMOUSER', conn);
    conn.status.set(key, 'READY');

    await watcher.tick();
    expect(await runRows()).toEqual([expect.objectContaining({ jobId: good, status: 'success' })]);
    const [row] = await db().select().from(jobs).where(eq(jobs.id, broken!.id));
    expect(row!.lastWatchError).toMatch(/cannot be read/);
  });

  it('takes held files too when the trigger says so', async () => {
    await watchingJob({ backlog: true, includeHeld: true });
    const conn = new FakeConnection();
    connections.set('ibmi.example.com|DEMOUSER', conn);
    // The fake lists fixture files as HELD unless told otherwise.
    await watcher.tick();
    const call = conn.calls.find((c) => c.method === 'listSpooledFiles');
    expect(call?.args[1]).toMatchObject({ status: ['READY', 'HELD'] });
    expect(await runRows()).toHaveLength(1);
  });

  it('leaves paused jobs alone', async () => {
    await watchingJob({ paused: true });
    await watcher.tick();
    expect(connections.size).toBe(0);
  });

  it('polls at the interval from the settings', async () => {
    await db().update(settings).set({ pollSeconds: 300 });
    await watchingJob();
    await watcher.tick();
    fake().status.set(key, 'READY');
    clock += 60_000;
    await watcher.tick();
    expect(await runRows()).toEqual([]);
    clock += 300_000;
    await watcher.tick();
    expect(await runRows()).toHaveLength(1);
    expect(watcher.status).toEqual({ realtime: 0, polled: 1 });
  });

  it('skips a job another instance is running', async () => {
    const jobId = await watchingJob();
    await watcher.tick();
    fake().status.set(key, 'READY');
    const release = await testDb().locks.tryLock(`job:${jobId}`);
    clock += 31_000;
    await watcher.tick();
    expect(await runRows()).toEqual([]);
    await release!();
    clock += 31_000;
    await watcher.tick();
    expect(await runRows()).toHaveLength(1);
  });

  it('runs a file as soon as its data queue entry arrives, without waiting for a poll', async () => {
    await db().update(servers).set({ dtaqLibrary: library, dtaqName: 'SPOOLDOC' }).where(eq(servers.id, serverId));
    await db().update(settings).set({ pollSeconds: 3600, safetyCheckSeconds: 86400 });
    await watchingJob();
    await watcher.tick(); // opens the connection and takes stock
    fake().dataQueues.set(`${library}/${queue}`, { library, name: 'SPOOLDOC' });
    clock += 61_000; // the queue list is read again
    await watcher.tick();
    // The reader reports healthy once it has connected; the next tick counts the queue as real-time.
    await vi.waitFor(async () => {
      await watcher.tick();
      expect(watcher.status.realtime).toBe(1);
    });

    fake().status.set(key, 'READY');
    fake().entries.set(`${library}/SPOOLDOC`, [entry(sample.splf, { library, name: queue })]);
    await vi.waitFor(async () => expect(await runRows()).toHaveLength(1), { timeout: 3000 });
    expect(fake().calls.some((c) => c.method === 'readDataQueue')).toBe(true);
  });

  it('polls a queue that sends to another data queue', async () => {
    await db().update(servers).set({ dtaqLibrary: library, dtaqName: 'SPOOLDOC' }).where(eq(servers.id, serverId));
    await watchingJob();
    await watcher.tick();
    fake().dataQueues.set(`${library}/${queue}`, { library, name: 'OTHERDTAQ' });
    clock += 61_000;
    await watcher.tick();
    expect(watcher.status).toEqual({ realtime: 0, polled: 1 });
    expect(fake().calls.some((c) => c.method === 'readDataQueue')).toBe(false);
  });

  it('records why a real-time queue is polled and since when, and clears it once reading works again', async () => {
    watcher = new Watcher({ now: () => clock, readWaitSeconds: 0, retryMs: 20 });
    const log = captureLog();
    await realtimeJob();
    const failedAt = clock;
    fake().failures.set('readDataQueue', new Error('CPF9801 Object SPOOLDOC in library MYLIB not found.'));
    await vi.waitFor(async () => {
      await watcher.tick();
      const [row] = await db().select().from(queueHealth);
      expect(row).toMatchObject({ serverId, library, name: queue, realtimeError: expect.stringMatching(/CPF9801/), realtimeErrorSince: new Date(failedAt) });
    });
    expect(watcher.status).toEqual({ realtime: 0, polled: 1 });
    expect(log).toContainEqual(expect.objectContaining({ level: 'warn', msg: expect.stringMatching(/Real-time watching failed/), serverId, error: expect.stringMatching(/CPF9801/) }));

    fake().failures.delete('readDataQueue');
    await vi.waitFor(async () => {
      await watcher.tick();
      const [row] = await db().select().from(queueHealth);
      expect(row).toMatchObject({ realtimeError: null, realtimeErrorSince: null });
    });
    expect(watcher.status.realtime).toBe(1);
    expect(log).toContainEqual(expect.objectContaining({ level: 'info', msg: 'Real-time watching works again' }));
  });

  it('clears the real-time error of a queue no job watches any more', async () => {
    await db().insert(queueHealth).values({ serverId, library, name: queue, realtimeError: 'Connection reset', realtimeErrorSince: new Date(), errorDismissed: 'Connection reset' });
    await watcher.tick();
    const [row] = await db().select().from(queueHealth);
    expect(row).toMatchObject({ realtimeError: null, errorDismissed: null });
  });

  it('logs a server it cannot reach once, not on every tick, and when it is back', async () => {
    let down = true;
    watcher = new Watcher({
      now: () => clock,
      readWaitSeconds: 0,
      connect: async (id) => {
        if (down) throw new Error('Connection refused');
        return connectServer(id);
      },
    });
    const log = captureLog();
    const jobId = await watchingJob();
    await watcher.tick();
    await watcher.tick();
    expect(log.filter((line) => line.level === 'warn')).toEqual([
      expect.objectContaining({ msg: 'Could not connect to watch the queues of a server', serverId, error: 'Connection refused' }),
    ]);
    const [job] = await db().select().from(jobs).where(eq(jobs.id, jobId));
    expect(job!.lastWatchError).toBe('Connection refused');

    down = false;
    await watcher.tick();
    expect(log.at(-1)).toMatchObject({ level: 'info', msg: 'Connected to the server again', serverId });
  });

  it('keeps which data queue a queue sends to when the queue list cannot be read', async () => {
    const log = captureLog();
    await realtimeJob();
    fake().failures.set('listOutputQueues', new Error('SQL0204 OUTPUT_QUEUE_INFO not found'));
    clock += 61_000;
    await watcher.tick();
    expect(watcher.status).toEqual({ realtime: 1, polled: 0 });
    expect(log).toContainEqual(expect.objectContaining({ level: 'warn', msg: 'Could not read the output queue list', error: expect.stringMatching(/SQL0204/) }));
  });

  it('keeps the heartbeat of a run while it runs', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    setPdfRenderer(async () => {
      await gate;
      return new TextEncoder().encode('%PDF');
    });
    try {
      await watchingJob({ backlog: true });
      const conn = new FakeConnection();
      connections.set('ibmi.example.com|DEMOUSER', conn);
      conn.status.set(key, 'READY');
      const ticking = watcher.tick();
      await vi.waitFor(async () => expect((await runRows())[0]?.status).toBe('running'));
      const before = (await runRows())[0]!.heartbeatAt.getTime();
      await new Promise((resolve) => setTimeout(resolve, 5));
      vi.advanceTimersByTime(HEARTBEAT_MS);
      await vi.waitFor(async () => expect((await runRows())[0]!.heartbeatAt.getTime()).toBeGreaterThan(before));
      finish();
      await ticking;
      expect((await runRows())[0]!.status).toBe('success');
    } finally {
      finish();
      setPdfRenderer(null);
      vi.useRealTimers();
    }
  });
});

/** A data queue entry for a spooled file, as the system writes it. */
function entry(splf: { name: string; number: number; jobName: string; jobUser: string; jobNumber: string }, outq: { library: string; name: string }): Uint8Array {
  const encode = encoderFor(37);
  const bytes = new Uint8Array(128).fill(0x40);
  const put = (at: number, value: string, length: number) => bytes.set(encode(value.padEnd(length).slice(0, length)), at);
  put(0, '*SPOOL', 10);
  put(10, '01', 2);
  put(12, splf.jobName, 10);
  put(22, splf.jobUser, 10);
  put(32, splf.jobNumber, 6);
  put(38, splf.name, 10);
  new DataView(bytes.buffer).setInt32(48, splf.number, false);
  put(52, outq.name, 10);
  put(62, outq.library, 10);
  return bytes;
}
