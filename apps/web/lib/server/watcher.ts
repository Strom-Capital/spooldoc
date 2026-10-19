import 'server-only';

import { parseSpooledFileEntry, type Connection, type OutputQueue, type QueueRef, type SpooledFileEntry } from '@spooldoc/ibmi';
import type { SpooledFileId } from '@spooldoc/core';
import { and, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { ibmiFilter, jobSpecSchema, splfKey, watchedStatuses, type JobSpec } from '@/lib/job-spec';
import { getDb, getLocks } from './db';
import { jobs, jobVersions, queueHealth, watchSeen } from './db/schema';
import { redact } from './http';
import { connectServer, ibmiFields, type ServerConnection } from './ibmi';
import { log } from './log';
import { cleanUp, failStaleRuns } from './retention';
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
  /** The first wait before a failed data queue reader tries again; it doubles up to a minute. */
  retryMs: number;
}

const defaultDeps: WatcherDeps = { connect: connectServer, run: runJob, now: Date.now, readWaitSeconds: 30, retryMs: 5_000 };

/** How often the queue list (which data queue each queue sends to) is read again. */
const QUEUE_INFO_MS = 60_000;
/** How often the watcher looks at the jobs. */
export const TICK_MS = 10_000;
/** Files a job looks at per pass, newest first. */
const LIST_LIMIT = 500;
/**
 * Files listed when a job takes stock without the backlog: every one must be recorded,
 * or an older file that was past the list would count as new once newer ones are gone.
 * This is the most the driver lists.
 */
const STOCK_TAKE_LIMIT = 10_000;
/** How often old runs and samples are deleted (see `cleanUp`). */
export const CLEANUP_MS = 60 * 60_000;
/** How often runs a stopped process cut off are marked failed (see `failStaleRuns`). */
const STALE_CHECK_MS = 60_000;

/** The last cleanup this process did. */
export interface CleanupStatus {
  at: string;
  runs: number;
  samples: number;
  error?: string;
}

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
  /** Why reading failed last, until a read works again. */
  lastError: string | null;
  /** When reading first failed since it last worked. */
  errorSince: number | null;
}

/** What a tick wants `queue_health` to say about a queue: an error, no error, or leave it. */
type Health = { error: string; since: Date } | null | 'keep';

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
  private lastCleanup: number | null = null;
  private lastStaleCheck: number | null = null;
  /** The problem last logged per server or job, so a lasting one is logged once. */
  private readonly reported = new Map<string, string>();
  status = { realtime: 0, polled: 0 };
  cleanup: CleanupStatus | null = null;

  constructor(deps: Partial<WatcherDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
  }

  /** Start ticking. */
  start(): void {
    if (this.timer) return;
    // A tick that fails (the database is down) is tried again on the next one.
    const tick = () => void this.tick().catch((error: unknown) => log.error('Watcher tick failed', { error: redact(error) }));
    this.timer = setInterval(tick, TICK_MS);
    this.timer.unref?.();
    tick();
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
    const health = new Map<string, Health>();
    for (const [serverId, list] of byServer) {
      const queues = uniqueQueues(list);
      let opened: ServerConnection;
      try {
        opened = await this.deps.connect(serverId);
      } catch (error) {
        const message = redact(error);
        this.report(`connect:${serverId}`, 'Could not connect to watch the queues of a server', { serverId, error: message, ...ibmiFields(error) });
        await markError(list.map((j) => j.jobId), message);
        // What real time last said stays until the server can be reached again.
        for (const queue of queues) health.set(queueKey(serverId, queue), 'keep');
        continue;
      }
      this.resolve(`connect:${serverId}`, 'Connected to the server again', { serverId });
      let info: OutputQueue[];
      try {
        info = await this.queues(serverId, opened.conn, queues);
        this.resolve(`queues:${serverId}`, 'Read the output queue list again', { serverId });
      } catch (error) {
        // Which data queue each queue sends to is kept from the last read that worked.
        info = this.queueInfo.get(serverId)?.queues ?? [];
        this.report(`queues:${serverId}`, 'Could not read the output queue list', {
          serverId,
          error: redact(error, [opened.password]),
          ...ibmiFields(error, [opened.password]),
        });
      }
      const dataQueue = opened.server.dtaqLibrary && opened.server.dtaqName ? { library: opened.server.dtaqLibrary, name: opened.server.dtaqName } : null;
      const live = queues.filter((q) => dataQueue && sameQueue(info.find((i) => sameQueue(i, q))?.dataQueue, dataQueue));
      if (dataQueue && live.length > 0) this.ensureReader(serverId, dataQueue, opened.server.ccsid ?? 37);
      else this.stopReader(serverId);
      const reader = this.readers.get(serverId);
      for (const queue of live) {
        // Not yet connected, or another instance reads the data queue: nothing to say.
        const state: Health = reader?.lastError
          ? { error: reader.lastError, since: new Date(reader.errorSince ?? this.deps.now()) }
          : reader?.healthy
            ? null
            : 'keep';
        health.set(queueKey(serverId, queue), state);
      }
      for (const queue of queues) {
        const isLive = !!reader?.healthy && !reader.lastError && live.some((q) => sameQueue(q, queue));
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
    await this.recordHealth(health);
    await this.failStaleRunsWhenDue();
    await this.cleanUpWhenDue(settings.retentionDays);
  }

  /**
   * Bring `queue_health` in line with what this tick found: a queue whose real-time
   * watching fails gets the error, and one that works again, is no longer watched in real
   * time or no longer watched at all loses it. Rows are written only when they change.
   */
  private async recordHealth(health: Map<string, Health>): Promise<void> {
    const db = getDb();
    const rows = await db.select().from(queueHealth).where(isNotNull(queueHealth.realtimeError));
    const current = new Map(rows.map((row) => [queueKey(row.serverId, { library: row.library, name: row.name }), row]));
    for (const [key, state] of health) {
      if (!state || state === 'keep' || current.get(key)?.realtimeError === state.error) continue;
      const [serverId, library, name] = key.split('/') as [string, string, string];
      const error = { realtimeError: state.error, realtimeErrorSince: current.get(key)?.realtimeErrorSince ?? state.since };
      await db
        .insert(queueHealth)
        .values({ serverId, library, name, ...error })
        .onConflictDoUpdate({ target: [queueHealth.serverId, queueHealth.library, queueHealth.name], set: error });
    }
    const cleared = [...current].filter(([key]) => !health.has(key) || health.get(key) === null).map(([, row]) => row.id);
    if (cleared.length > 0) {
      await db.update(queueHealth).set({ realtimeError: null, realtimeErrorSince: null, errorDismissed: null }).where(inArray(queueHealth.id, cleared));
    }
  }

  /** Mark runs failed whose process stopped, at most once every `STALE_CHECK_MS`. */
  private async failStaleRunsWhenDue(): Promise<void> {
    const now = this.deps.now();
    if (this.lastStaleCheck !== null && now - this.lastStaleCheck < STALE_CHECK_MS) return;
    this.lastStaleCheck = now;
    try {
      await failStaleRuns(new Date(now));
    } catch (error) {
      log.error('Could not check for cut-off runs', { error: redact(error) });
    }
  }

  /** Delete old runs and samples, at most once every `CLEANUP_MS`. */
  private async cleanUpWhenDue(retentionDays: number): Promise<void> {
    const now = this.deps.now();
    if (this.lastCleanup !== null && now - this.lastCleanup < CLEANUP_MS) return;
    this.lastCleanup = now;
    try {
      const deleted = await cleanUp(retentionDays, new Date(now));
      if (deleted) this.cleanup = { at: new Date(now).toISOString(), ...deleted };
    } catch (error) {
      this.cleanup = { at: new Date(now).toISOString(), runs: 0, samples: 0, error: redact(error) };
      log.error('Cleanup of old runs failed', { error: this.cleanup.error });
    }
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
   * first records the files already there, without running them, unless its trigger
   * has `backlog`: then those files are run too.
   */
  async dispatch(opened: ServerConnection, queue: QueueRef, list: WatchedJob[], entry: SpooledFileId | null): Promise<void> {
    for (const job of list) {
      const release = await getLocks().tryLock(`job:${job.jobId}`);
      if (!release) continue;
      try {
        const filter = job.spec.source.filter;
        let files: SpooledFileEntry[] = await opened.conn.listSpooledFiles(queue, {
          ...ibmiFilter(filter),
          status: watchedStatuses(job.spec.trigger),
          limit: job.lastWatchAt === null && !job.spec.trigger.backlog ? STOCK_TAKE_LIMIT : LIST_LIMIT,
        });
        const db = getDb();
        if (job.lastWatchAt === null && job.spec.trigger.backlog) {
          // Taking stock with the backlog on: every ready file no run of this job has
          // processed is run below, including files earlier stock-takings set aside.
          await db.delete(watchSeen).where(and(eq(watchSeen.jobId, job.jobId), isNull(watchSeen.runId)));
          job.lastWatchAt = new Date(this.deps.now());
          await db.update(jobs).set({ lastWatchAt: job.lastWatchAt }).where(eq(jobs.id, job.jobId));
        } else if (job.lastWatchAt === null) {
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
        await db.update(jobs).set({ lastWatchAt: new Date(this.deps.now()), lastWatchError: null, watchErrorDismissed: null }).where(eq(jobs.id, job.jobId));
        this.resolve(`job:${job.jobId}`, 'Watching the job works again', { jobId: job.jobId });
      } catch (error) {
        const message = redact(error, [opened.password]);
        this.report(`job:${job.jobId}`, 'Watching a job failed', {
          jobId: job.jobId,
          queue: `${queue.library}/${queue.name}`,
          error: message,
          ...ibmiFields(error, [opened.password]),
        });
        await markError([job.jobId], message);
      } finally {
        await release();
      }
    }
  }

  /** Log a problem as a warning, unless the same one was logged last for `key`. */
  private report(key: string, message: string, fields: { error: string } & Record<string, unknown>): void {
    if (this.reported.get(key) === fields.error) return;
    this.reported.set(key, fields.error);
    log.warn(message, fields);
  }

  /** Log that the problem last reported for `key` is gone. */
  private resolve(key: string, message: string, fields: Record<string, unknown>): void {
    if (this.reported.delete(key)) log.info(message, fields);
  }

  private ensureReader(serverId: string, dataQueue: QueueRef, ccsid: number): void {
    const current = this.readers.get(serverId);
    if (current && !current.stopped && sameQueue(current.dataQueue, dataQueue)) return;
    if (current) current.stopped = true;
    const reader: Reader = { serverId, dataQueue, healthy: false, stopped: false, done: Promise.resolve(), lastError: null, errorSince: null };
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

  /**
   * Read the data queue until stopped; reconnect with backoff after an error. While
   * reading fails, the reader keeps the error and since when, and its queues are polled.
   */
  private async read(reader: Reader, ccsid: number): Promise<void> {
    let backoff = this.deps.retryMs;
    const dataQueue = `${reader.dataQueue.library}/${reader.dataQueue.name}`;
    while (!reader.stopped) {
      // Reading takes entries off the data queue, so only one instance may read it.
      const release = await getLocks().tryLock(`dtaq:${reader.serverId}`);
      if (!release) {
        // Another instance reads it: not an error, this one polls the queues meanwhile.
        reader.healthy = false;
        reader.lastError = null;
        reader.errorSince = null;
        await sleep(30_000, reader);
        continue;
      }
      let password = '';
      try {
        const opened = await this.deps.connect(reader.serverId);
        password = opened.password;
        reader.healthy = true;
        backoff = this.deps.retryMs;
        while (!reader.stopped) {
          const bytes = await opened.conn.readDataQueue(reader.dataQueue, this.deps.readWaitSeconds);
          if (reader.lastError) {
            log.info('Real-time watching works again', { serverId: reader.serverId, dataQueue });
            reader.lastError = null;
            reader.errorSince = null;
          }
          if (!bytes) continue;
          const notice = parseSpooledFileEntry(bytes, ccsid);
          if (!notice) continue;
          const list = (await watchedJobs()).filter(
            (j) => j.spec.source.serverId === reader.serverId && j.spec.source.library === notice.queue.library && j.spec.source.queue === notice.queue.name,
          );
          if (list.length > 0) await this.dispatch(opened, notice.queue, list, notice.splf);
        }
      } catch (error) {
        reader.healthy = false;
        reader.lastError = redact(error, [password]);
        reader.errorSince ??= this.deps.now();
        log.warn('Real-time watching failed; the queues are polled meanwhile', {
          serverId: reader.serverId,
          dataQueue,
          error: reader.lastError,
          ...ibmiFields(error, [password]),
          retryInSeconds: backoff / 1000,
        });
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
  // A version that no longer reads as a spec stops only its own job, with the reason on the job.
  const broken: string[] = [];
  const watched: WatchedJob[] = [];
  for (const row of rows) {
    const spec = jobSpecSchema.safeParse(row.spec);
    if (!spec.success) {
      broken.push(row.jobId);
      continue;
    }
    watched.push({ jobId: row.jobId, version: row.version!, spec: spec.data, lastWatchAt: row.lastWatchAt });
  }
  if (broken.length > 0) {
    const message = 'The active version cannot be read. Save the job as a new version.';
    // Logged when the job first gets the error, not on every tick.
    const marked = await getDb()
      .update(jobs)
      .set({ lastWatchError: message })
      .where(and(inArray(jobs.id, broken), or(isNull(jobs.lastWatchError), ne(jobs.lastWatchError, message))))
      .returning({ id: jobs.id });
    if (marked.length > 0) log.warn('A job is not watched: its active version cannot be read', { jobs: marked.map((j) => j.id) });
  }
  return watched.filter((job) => job.spec.trigger.mode === 'watch' && job.spec.source.serverId && job.spec.source.library && job.spec.source.queue);
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

/** The last cleanup of old runs this process did, if any. */
export function cleanupStatus(): CleanupStatus | null {
  return (globalThis as Holder)[KEY]?.cleanup ?? null;
}

/** How many queues this process watches in real time and by polling. */
export function watchStatus(): { realtime: number; polled: number } {
  return (globalThis as Holder)[KEY]?.status ?? { realtime: 0, polled: 0 };
}
