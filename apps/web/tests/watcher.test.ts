import { encoderFor } from '@spooldoc/core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySpec, splfKey } from '@/lib/job-spec';
import { jobs, jobVersions, runs, servers, settings, watchSeen } from '@/lib/server/db/schema';
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

const sample = loadSample('invoice');
const { library, name: queue } = sample.attributes.queue;
const key = splfKey(sample.splf);

let serverId: string;
let clock: number;
let watcher: InstanceType<typeof Watcher>;

const fake = (): FakeConnection => connections.get('ibmi.example.com|DEMOUSER')!;

/** A job watching the invoice queue, with an active version. */
async function watchingJob(overrides: { paused?: boolean } = {}): Promise<string> {
  const spec = {
    ...emptySpec({ serverId, library, queue, destinationId: await builtinDestination() }),
    trigger: { mode: 'watch' as const },
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
});

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
    await watchingJob();
    await watcher.tick();
    const call = fake().calls.find((c) => c.method === 'listSpooledFiles');
    expect(call?.args[1]).toMatchObject({ status: ['READY'] });
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
