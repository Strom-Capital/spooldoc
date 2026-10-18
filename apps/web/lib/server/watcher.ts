import 'server-only';

import { parseSpooledFileEntry, type Connection, type OutputQueue, type QueueRef, type SpooledFileEntry } from '@spooldoc/ibmi';
import type { SpooledFileId } from '@spooldoc/core';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { jobSpecSchema, splfKey, type JobSpec } from '@/lib/job-spec';
import { getDb, getLocks } from './db';
import { jobs, jobVersions, watchSeen } from './db/schema';
import { redact } from './http';
import { connectServer, type ServerConnection } from './ibmi';
import { runJob } from './runner';
import { getSettings } from './settings';

/** A job the watcher looks after: active version with mode `watch`, not paused. */
export interface WatchedJob {
  jobId: string;
  version: number;
  spec: JobSpec;
  /** Null until the watcher has taken stock of the queue since watching started. */
  lastWatchAt: Date | null;
}

/** What the watcher needs; tests replace the IBM i, the clock and the runner. */
export interface WatcherDeps {
  connect(serverId: string): Promise<ServerConnection>;
  run: typeof runJob;
  now(): number;
  /** Seconds a data queue read waits for an entry. */
  readWaitSeconds: number;
}

const defaultDeps: WatcherDeps = { connect: connectServer, run: runJob, now: Date.now, readWaitSeconds: 30 };

/** How often the queue list (which data queue each queue sends to) is read again. */
const QUEUE_INFO_MS = 60_000;
/** How often the watcher looks at the jobs. */
export const TICK_MS = 10_000;

const queueKey = (serverId: string, q: QueueRef) => `${serverId}/${q.library}/${q.name}`;
const sameQueue = (a: QueueRef | null | undefined, b: QueueRef | null | undefined) => !!a && !!b && a.library === b.library && a.name === b.name;
const sameFile = (a: SpooledFileId, b: SpooledFileId) =>
  a.name === b.name && a.number === b.number && a.jobName === b.jobName && a.jobUser === b.jobUser && a.jobNumber === b.jobNumber;

interface Reader {
  serverId: string;
  dataQueue: QueueRef;
  healthy: boolean;
  stopped: boolean;
  done: Promise<void>;
}

/**
 * Watches the source queues of jobs set to Watching. A queue that sends entries to the
 * server's data queue is watched in real time by one reader per server, and polled every
 * `safety_check_seconds` as a safety net; any other queue is polled every
 * `poll_seconds`. Every path ends in `dispatch`, which runs each new ready file once.
 */
export class Watcher {
  private readonly deps: WatcherDeps;
  private readonly lastPoll = new Map<string, number>();
  private readonly queueInfo = new Map<string, { at: number; queues: OutputQueue[] }>();
  private readonly readers = new Map<string, Reader>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking: Promise<void> | null = null;
  status = { realtime: 0, polled: 0 };

  constructor(deps: Partial<WatcherDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
  }

  /** Start ticking. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    void this.tick();
  }

  /** Stop ticking and stop the readers. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const reader of this.readers.values()) reader.stopped = true;
    await Promise.all([...this.readers.values()].map((reader) => reader.done));
    this.readers.clear();
    await this.ticking;
  }

  /** One look at every watched job. Ticks never overlap. */
  tick(): Promise<void> {
    this.ticking ??= this.doTick().finally(() => {
      this.ticking = null;
    });
    return this.ticking;
  }

  private async doTick(): Promise<void> {
    const settings = await getSettings();
    const watched = await watchedJobs();
    const byServer = new Map<string, WatchedJob[]>();
    for (const job of watched) {
      const serverId = job.spec.source.serverId!;
      byServer.set(serverId, [...(byServer.get(serverId) ?? []), job]);
    }
    let realtime = 0;
    let polled = 0;
    for (const [serverId, list] of byServer) {
      let opened: ServerConnection;
      try {
        opened = await this.deps.connect(serverId);
      } catch (error) {
        await markError(list.map((j) => j.jobId), redact(error));
        continue;
      }
      const queues = uniqueQueues(list);
      const info = await this.queues(serverId, opened.conn, queues).catch(() => [] as OutputQueue[]);
      const dataQueue = opened.server.dtaqLibrary && opened.server.dtaqName ? { library: opened.server.dtaqLibrary, name: opened.server.dtaqName } : null;
      const live = queues.filter((q) => dataQueue && sameQueue(info.find((i) => sameQueue(i, q))?.dataQueue, dataQueue));
      if (dataQueue && live.length > 0) this.ensureReader(serverId, dataQueue, opened.server.ccsid ?? 37);
      else this.stopReader(serverId);
      const reader = this.readers.get(serverId);
      for (const queue of queues) {
        const isLive = !!reader?.healthy && live.some((q) => sameQueue(q, queue));
        if (isLive) realtime++;
        else polled++;
        const every = (isLive ? settings.safetyCheckSeconds : settings.pollSeconds) * 1000;
        const key = queueKey(serverId, queue);
        const jobsHere = list.filter((j) => j.spec.source.library === queue.library && j.spec.source.queue === queue.name);
        // A job that has not taken stock yet is looked at on the next tick.
        const due = this.deps.now() - (this.lastPoll.get(key) ?? 0) >= every || jobsHere.some((j) => j.lastWatchAt === null);
        if (due) {
          this.lastPoll.set(key, this.deps.now());
          await this.dispatch(opened, queue, jobsHere, null);
        }
      }
    }
    for (const serverId of this.readers.keys()) {
      if (!byServer.has(serverId)) this.stopReader(serverId);
    }
    this.status = { realtime, polled };
  }

  private async queues(serverId: string, conn: Connection, queues: QueueRef[]): Promise<OutputQueue[]> {
    const cached = this.queueInfo.get(serverId);
    if (cached && this.deps.now() - cached.at < QUEUE_INFO_MS) return cached.queues;
    const libraries = [...new Set(queues.map((q) => q.library))];
    const list = await conn.listOutputQueues({ libraries });
    this.queueInfo.set(serverId, { at: this.deps.now(), queues: list });
    return list;
  }

  /**
   * Run every new ready file of a queue for each job watching it. With `entry`, only that
   * file (it just became ready). A job that has not taken stock since watching started
   * first records the files already there, without running them.
   */
  async dispatch(opened: ServerConnection, queue: QueueRef, list: WatchedJob[], entry: SpooledFileId | null): Promise<void> {
    for (const job of list) {
      const release = await getLocks().tryLock(`job:${job.jobId}`);
      if (!release) continue;
      try {
        const filter = job.spec.source.filter;
        let files: SpooledFileEntry[] = await opened.conn.listSpooledFiles(queue, {
          name: filter.splf || undefined,
          userData: filter.userData || undefined,
          status: ['READY'],
          limit: 500,
        });
        const db = getDb();
        if (job.lastWatchAt === null) {
          const existing = files.filter((f) => !entry || !sameFile(f, entry));
          if (existing.length > 0) {
            await db
              .insert(watchSeen)
              .values(existing.map((f) => ({ jobId: job.jobId, splfKey: splfKey(f) })))
              .onConflictDoNothing();
          }
          files = entry ? files.filter((f) => sameFile(f, entry)) : [];
          job.lastWatchAt = new Date(this.deps.now());
          await db.update(jobs).set({ lastWatchAt: job.lastWatchAt }).where(eq(jobs.id, job.jobId));
        } else if (entry) {
          files = files.filter((f) => sameFile(f, entry));
        }
        if (files.length > 0) {
          const keys = files.map(splfKey);
          const seen = await db
            .select({ key: watchSeen.splfKey })
            .from(watchSeen)
            .where(and(eq(watchSeen.jobId, job.jobId), inArray(watchSeen.splfKey, keys)));
          const done = new Set(seen.map((s) => s.key));
          // Oldest first, as the queue lists newest first.
          for (const file of files.filter((f) => !done.has(splfKey(f))).reverse()) {
            const splf = { name: file.name, number: file.number, jobName: file.jobName, jobUser: file.jobUser, jobNumber: file.jobNumber };
            await this.deps.run(
              { jobId: job.jobId, version: job.version, splf, trigger: 'watch' },
              { conn: opened.conn, host: opened.server.host, serverId: opened.server.id, password: opened.password },
            );
          }
        }
        await db.update(jobs).set({ lastWatchAt: new Date(this.deps.now()), lastWatchError: null }).where(eq(jobs.id, job.jobId));
      } catch (error) {
        await markError([job.jobId], redact(error, [opened.password]));
      } finally {
        await release();
      }
    }
  }

  private ensureReader(serverId: string, dataQueue: QueueRef, ccsid: number): void {
    const current = this.readers.get(serverId);
    if (current && !current.stopped && sameQueue(current.dataQueue, dataQueue)) return;
    if (current) current.stopped = true;
    const reader: Reader = { serverId, dataQueue, healthy: false, stopped: false, done: Promise.resolve() };
    reader.done = this.read(reader, ccsid);
    this.readers.set(serverId, reader);
  }

  private stopReader(serverId: string): void {
    const reader = this.readers.get(serverId);
    if (reader) {
      reader.stopped = true;
      this.readers.delete(serverId);
    }
  }

  /** Read the data queue until stopped; reconnect with backoff after an error. */
  private async read(reader: Reader, ccsid: number): Promise<void> {
    let backoff = 5_000;
    while (!reader.stopped) {
      // Reading takes entries off the data queue, so only one instance may read it.
      const release = await getLocks().tryLock(`dtaq:${reader.serverId}`);
      if (!release) {
        reader.healthy = false;
        await sleep(30_000, reader);
        continue;
      }
      try {
        const opened = await this.deps.connect(reader.serverId);
        reader.healthy = true;
        backoff = 5_000;
        while (!reader.stopped) {
          const bytes = await opened.conn.readDataQueue(reader.dataQueue, this.deps.readWaitSeconds);
          if (!bytes) continue;
          const notice = parseSpooledFileEntry(bytes, ccsid);
          if (!notice) continue;
          const list = (await watchedJobs()).filter(
            (j) => j.spec.source.serverId === reader.serverId && j.spec.source.library === notice.queue.library && j.spec.source.queue === notice.queue.name,
          );
          if (list.length > 0) await this.dispatch(opened, notice.queue, list, notice.splf);
        }
      } catch {
        reader.healthy = false;
        await sleep(backoff, reader);
        backoff = Math.min(backoff * 2, 60_000);
      } finally {
        await release();
      }
    }
    reader.healthy = false;
  }
}

/** Wait, or stop early when the reader is stopped. */
async function sleep(ms: number, reader: Reader): Promise<void> {
  const step = 250;
  for (let waited = 0; waited < ms && !reader.stopped; waited += step) {
    await new Promise((resolve) => setTimeout(resolve, step));
  }
}

function uniqueQueues(list: WatchedJob[]): QueueRef[] {
  const map = new Map<string, QueueRef>();
  for (const job of list) {
    map.set(`${job.spec.source.library}/${job.spec.source.queue}`, { library: job.spec.source.library, name: job.spec.source.queue });
  }
  return [...map.values()];
}

async function markError(jobIds: string[], message: string): Promise<void> {
  if (jobIds.length === 0) return;
  await getDb().update(jobs).set({ lastWatchError: message }).where(inArray(jobs.id, jobIds));
}

/** Jobs whose active version watches a queue and that are not paused. */
export async function watchedJobs(): Promise<WatchedJob[]> {
  const rows = await getDb()
    .select({ jobId: jobs.id, version: jobs.activeVersion, spec: jobVersions.spec, lastWatchAt: jobs.lastWatchAt })
    .from(jobs)
    .innerJoin(jobVersions, and(eq(jobVersions.jobId, jobs.id), eq(jobVersions.number, jobs.activeVersion)))
    .where(and(eq(jobs.paused, false), isNotNull(jobs.activeVersion)));
  return rows
    .map((row) => ({ jobId: row.jobId, version: row.version!, spec: jobSpecSchema.parse(row.spec), lastWatchAt: row.lastWatchAt }))
    .filter((job) => job.spec.trigger.mode === 'watch' && job.spec.source.serverId && job.spec.source.library && job.spec.source.queue);
}

const KEY = Symbol.for('spooldoc.watcher');
type Holder = typeof globalThis & { [KEY]?: Watcher };

/** Start the watcher of this process (once, also across hot reloads). */
export function startWatcher(): Watcher {
  const holder = globalThis as Holder;
  holder[KEY] ??= new Watcher();
  holder[KEY].start();
  return holder[KEY];
}

/** How many queues this process watches in real time and by polling. */
export function watchStatus(): { realtime: number; polled: number } {
  return (globalThis as Holder)[KEY]?.status ?? { realtime: 0, polled: 0 };
}
