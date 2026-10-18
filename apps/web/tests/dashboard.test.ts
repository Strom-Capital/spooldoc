import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aiProviders, jobs, jobVersions, runs, servers, settings } from '@/lib/server/db/schema';
import type { DashboardView, RunStatus } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { resetTables } from './helpers/db';
import { builtinDestination, db, insertJob, insertServer } from './helpers/fixtures';
import { emptySpec } from '@/lib/job-spec';
import { appRequest } from './helpers/mocks';

vi.mock('@spooldoc/ibmi/jt400', async () => (await import('./helpers/mocks')).fakeJt400);

const route = await import('@/app/api/dashboard/route');
const attention = await import('@/app/api/attention/route');
const { encryptSecret } = await import('@/lib/server/secrets');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let auth: Record<string, string>;

async function load(query = ''): Promise<DashboardView> {
  const response = await route.GET(appRequest(`/api/dashboard${query}`, { headers: auth }));
  expect(response.status).toBe(200);
  return response.json();
}

async function insertRun(jobId: string, status: RunStatus, startedAt: Date): Promise<string> {
  const splf = { name: 'QPRINT', number: 1, jobName: 'J', jobUser: 'U', jobNumber: '000001' };
  const [row] = await db()
    .insert(runs)
    .values({ jobId, version: 1, trigger: 'watch', splf, status, startedAt, finishedAt: status === 'running' ? null : startedAt })
    .returning({ id: runs.id });
  return row!.id;
}

async function dismiss(items: { kind: string; id: string }[], dismissed = true): Promise<Response> {
  return attention.POST(appRequest('/api/attention', { method: 'POST', body: { items, dismissed }, headers: auth }));
}

/** The local day of an instant in a time zone, `YYYY-MM-DD`. */
function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

beforeEach(async () => {
  await resetTables(db());
  auth = await signedIn();
});

describe('GET /api/dashboard', () => {
  it('shows nothing done and empty days on a new install', async () => {
    const view = await load('?tz=UTC');
    expect(view.setup).toEqual({ server: false, ai: false, job: false, run: false });
    expect(view.servers).toEqual({ total: 0, failing: 0 });
    expect(view.outputQueues).toEqual({ total: 0, realtime: 0, polled: 0, unwatched: 0 });
    expect(view.jobs).toEqual({ total: 0, watching: 0, paused: 0 });
    expect(view.runs).toEqual({ success: 0, warning: 0, failed: 0, skipped: 0, logged: 0 });
    expect(view.series).toHaveLength(7);
    expect(view.series.every((b) => b.success + b.warning + b.failed + b.skipped === 0)).toBe(true);
    expect(view.series.at(-1)!.at).toBe(`${localDay(new Date(), 'UTC')}T00:00`);
  });

  it('counts what is configured and the runs of the range by status', async () => {
    const serverId = await insertServer({ lastCheckedAt: new Date() });
    await insertServer({ name: 'Broken', lastCheckedAt: new Date(), lastError: 'Connection refused' });
    const jobId = await insertJob(serverId);
    const paused = await insertJob(serverId);
    await db().update(jobs).set({ paused: true, lastWatchError: 'Queue not found' }).where(eq(jobs.id, paused));
    // A third job watches another queue through its active version.
    const watcher = await insertJob(serverId);
    const base = emptySpec({ serverId, library: 'MYLIB', queue: 'FORMS', destinationId: await builtinDestination() });
    await db().insert(jobVersions).values({ jobId: watcher, number: 1, spec: { ...base, trigger: { ...base.trigger, mode: 'watch' } } });
    await db().update(jobs).set({ activeVersion: 1 }).where(eq(jobs.id, watcher));
    await db().update(settings).set({ aiProvider: 'anthropic' });
    await db().insert(aiProviders).values({ provider: 'anthropic', apiKeyEnc: encryptSecret('sk-test') });

    const now = Date.now();
    for (const status of ['success', 'success', 'warning', 'failed', 'skipped', 'running'] as const) {
      await insertRun(jobId, status, new Date(now - HOUR));
    }
    await insertRun(jobId, 'failed', new Date(now - 3 * DAY));
    await insertRun(jobId, 'success', new Date(now - 40 * DAY));

    const view = await load('?range=7d&tz=UTC');
    expect(view.setup).toEqual({ server: true, ai: true, job: true, run: true });
    expect(view.servers).toEqual({ total: 2, failing: 1 });
    expect(view.outputQueues).toEqual({ total: 2, realtime: 0, polled: 0, unwatched: 1 });
    expect(view.jobs).toEqual({ total: 3, watching: 1, paused: 1 });
    expect(view.runs).toEqual({ success: 2, warning: 1, failed: 2, skipped: 1, logged: 8 });
    expect(view.series.find((b) => b.at === `${localDay(new Date(now - HOUR), 'UTC')}T00:00`)).toMatchObject({ success: 2, warning: 1, skipped: 1 });
    expect(view.attention.servers.map((s) => s.name)).toEqual(['Broken']);
    expect(view.attention.jobs.map((j) => j.error)).toEqual(['Queue not found']);
    expect(view.attention.runs).toHaveLength(2);
    expect(view.attention.runs[0]!.jobName).toBe('Invoices');

    expect((await load('?range=90d&tz=UTC')).runs.success).toBe(3);
  });

  it('gives 24 hourly buckets for the last day', async () => {
    const jobId = await insertJob(await insertServer());
    await insertRun(jobId, 'success', new Date(Date.now() - 2 * HOUR));
    await insertRun(jobId, 'success', new Date(Date.now() - 30 * HOUR));
    const view = await load('?range=24h&tz=UTC');
    expect(view.series).toHaveLength(24);
    expect(view.series.at(-1)!.at).toMatch(/T\d\d:00$/);
    expect(view.runs.success).toBe(1);
  });

  it('puts a run on the day it was in the viewer’s time zone', async () => {
    const jobId = await insertJob(await insertServer());
    // The latest 00:30 in Helsinki: still the day before in UTC.
    let at = new Date(Math.floor(Date.now() / HOUR) * HOUR + 30 * 60 * 1000);
    while (at.getTime() > Date.now() || new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Helsinki', hour: '2-digit', hourCycle: 'h23' }).format(at) !== '00') {
      at = new Date(at.getTime() - HOUR);
    }
    await insertRun(jobId, 'success', at);
    const helsinki = await load('?range=7d&tz=Europe/Helsinki');
    expect(helsinki.series.find((b) => b.success === 1)!.at).toBe(`${localDay(at, 'Europe/Helsinki')}T00:00`);
    const utc = await load('?range=7d&tz=UTC');
    expect(utc.series.find((b) => b.success === 1)!.at).toBe(`${localDay(at, 'UTC')}T00:00`);
    expect(localDay(at, 'UTC')).not.toBe(localDay(at, 'Europe/Helsinki'));
  });

  it('falls back to UTC for an unknown zone and refuses an unknown range', async () => {
    const view = await load('?tz=Mars/Olympus');
    expect(view.series.at(-1)!.at).toBe(`${localDay(new Date(), 'UTC')}T00:00`);
    const response = await route.GET(appRequest('/api/dashboard?range=1y', { headers: auth }));
    expect(response.status).toBe(400);
  });

  it('dismisses items until the error changes, and brings them back', async () => {
    const serverId = await insertServer({ name: 'Broken', lastCheckedAt: new Date(), lastError: 'Connection refused' });
    const jobId = await insertJob(serverId);
    await db().update(jobs).set({ lastWatchError: 'Queue not found' }).where(eq(jobs.id, jobId));
    const runId = await insertRun(jobId, 'failed', new Date(Date.now() - HOUR));
    const items = [
      { kind: 'server', id: serverId },
      { kind: 'job', id: jobId },
      { kind: 'run', id: runId },
    ];
    expect((await dismiss(items)).status).toBe(204);
    let view = await load('?tz=UTC');
    expect(view.attention).toEqual({ servers: [], jobs: [], runs: [] });
    expect(view.servers.failing).toBe(1);

    await db().update(servers).set({ lastError: 'Password expired' }).where(eq(servers.id, serverId));
    view = await load('?tz=UTC');
    expect(view.attention.servers.map((s) => s.error)).toEqual(['Password expired']);

    expect((await dismiss([{ kind: 'run', id: runId }, { kind: 'job', id: jobId }], false)).status).toBe(204);
    view = await load('?tz=UTC');
    expect(view.attention.runs.map((r) => r.id)).toEqual([runId]);
    expect(view.attention.jobs.map((j) => j.error)).toEqual(['Queue not found']);

    expect((await dismiss([{ kind: 'queue', id: runId }])).status).toBe(400);
  });

  it('needs a session', async () => {
    const response = await route.GET(appRequest('/api/dashboard'));
    expect(response.status).toBe(401);
  });
});

