import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';
import { getDb, getLocks } from '../db';
import { runDeliveries, runs } from '../db/schema';
import { StepError } from '../step-error';
import type { DeliverInput, RunDocument } from './index';

/**
 * What the destinations that deliver one document at a time share: which documents an
 * earlier run already delivered, the rows of the run's deliveries, and the deliver step's
 * note when some failed or were delivered before.
 */

type DeliveryRow = typeof runDeliveries.$inferInsert;
/** A delivery row without what `deliveryRecorder` fills in. */
export type DeliveryFields = Omit<DeliveryRow, 'runId' | 'jobId' | 'splfKey' | 'destinationId' | 'kind'>;

/** A delivery of an earlier run of the same job on the same spooled file, not to a test address. */
export interface EarlierDelivery {
  document: string;
  to: string;
  status: string;
  messageId: string | null;
  splfCreated: string | null;
  firstPage: number | null;
  lastPage: number | null;
  /** When the row was written. */
  sentAt: Date;
  /** The run's number in the Job log. */
  seq: number;
}

/** How long a deliver step waits for another run delivering the same spooled file, and how often it asks. */
const LOCK_WAIT = { limitMs: 5 * 60_000, pollMs: 1_000 };
let lockWait = LOCK_WAIT;

/** Change how long the delivery lock is waited for, for tests. Null puts back the defaults. */
export function setDeliveryLockWait(next: { limitMs: number; pollMs: number } | null): void {
  lockWait = next ?? LOCK_WAIT;
}

/**
 * Takes the lock that lets one run at a time deliver a job's spooled file through a kind of
 * destination, so a second run reads what the first delivered before it delivers anything.
 * Take it before `earlierDeliveries`, and keep it until every delivery is recorded. The lock
 * is a Postgres advisory lock on the one connection the locks keep for the process, so
 * waiting holds no connection of the pool. Returns its release function.
 *
 * @param busy - The step's error when the wait runs out, such as "Another run of this job is sending email ..."
 * @throws StepError when another run holds the lock for longer than the wait
 */
export async function deliveryLock(kind: string, job: DeliverInput['job'], busy: string): Promise<() => Promise<void>> {
  const key = `${kind}:${job.id}:${job.splfKey}`;
  const until = Date.now() + lockWait.limitMs;
  for (;;) {
    const release = await getLocks().tryLock(key);
    if (release) return release;
    if (Date.now() >= until) throw new StepError('deliver', busy);
    await new Promise((resolve) => setTimeout(resolve, lockWait.pollMs));
  }
}

/**
 * The deliveries, sent or failed, of earlier runs of this job on this spooled file through a
 * kind of destination, first run first. None while the destination is in test mode: then
 * every document goes to the test address or URL, even one sent for real before, so a
 * template change can be checked on a spooled file that was delivered.
 */
export async function earlierDeliveries(kind: string, job: DeliverInput['job'], test: boolean): Promise<EarlierDelivery[]> {
  if (test) return [];
  return getDb()
    .select({
      document: runDeliveries.document,
      to: runDeliveries.to,
      status: runDeliveries.status,
      messageId: runDeliveries.messageId,
      splfCreated: runDeliveries.splfCreated,
      firstPage: runDeliveries.firstPage,
      lastPage: runDeliveries.lastPage,
      sentAt: runDeliveries.sentAt,
      seq: runs.seq,
    })
    .from(runDeliveries)
    .innerJoin(runs, eq(runs.id, runDeliveries.runId))
    .where(
      and(
        eq(runDeliveries.kind, kind),
        eq(runDeliveries.jobId, job.id),
        eq(runDeliveries.splfKey, job.splfKey),
        inArray(runDeliveries.status, ['sent', 'failed']),
        eq(runDeliveries.test, false),
      ),
    )
    .orderBy(runs.seq);
}

/** The largest UTC offset a time zone has, +14:00. */
const MAX_UTC_OFFSET_MS = 14 * 60 * 60 * 1000;

/**
 * The earliest moment a spooled file can have been created, or null when its creation
 * time is "" or not a time. The IBM i gives the time on its own clock, `2026-10-17T21:40:38`,
 * without a time zone, and Spooldoc does not know the system's offset. Read as UTC, the
 * real moment is at most 14 hours earlier, the largest offset there is.
 */
export function earliestCreation(created: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(created);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  const back = new Date(utc);
  // A date such as 2026-02-31 rolls over: it is not a time.
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day || back.getUTCHours() !== hour || back.getUTCMinutes() !== minute) return null;
  return utc - MAX_UTC_OFFSET_MS;
}

/**
 * True when an earlier row is about this document. A document matches when the spooled file
 * has the same creation time, and the page group the same pages and name: the IBM i reuses
 * job numbers, and a newer job version can group the pages another way.
 *
 * Rows written before the creation time was recorded match on the name, so a Retry right
 * after an upgrade does not send a second copy, but only when they were written after the
 * spooled file could have been created: a delivery cannot come before its spooled file, so
 * an older row is about an earlier spooled file with the same job number. With no creation
 * time to compare, they match on the name alone.
 *
 * @param created - The spooled file's creation time, as the run read it
 */
export function sameDocument(row: EarlierDelivery, document: RunDocument, created: string): boolean {
  if (row.document !== document.name) return false;
  if (row.splfCreated === null) {
    const earliest = earliestCreation(created);
    return earliest === null || row.sentAt.getTime() >= earliest;
  }
  return row.splfCreated === created && row.firstPage === (document.pages?.first ?? null) && row.lastPage === (document.pages?.last ?? null);
}

/** The first earlier delivery that sent this document, or undefined when none did. */
export const sentBefore = (earlier: EarlierDelivery[], document: RunDocument, created: string): EarlierDelivery | undefined =>
  earlier.find((row) => row.status === 'sent' && sameDocument(row, document, created));

/** What a delivery row records of its document and spooled file. */
export function documentFields(document: RunDocument, created: string) {
  return {
    pageGroupIndex: document.pageGroupIndex,
    document: document.name,
    splfCreated: created,
    firstPage: document.pages?.first ?? null,
    lastPage: document.pages?.last ?? null,
  };
}

/** Records one delivery of the run, as it goes. */
export function deliveryRecorder(input: Pick<DeliverInput, 'runId' | 'job' | 'destinationId'>, kind: string): (row: DeliveryFields) => Promise<unknown> {
  return (row) => getDb().insert(runDeliveries).values({ runId: input.runId, jobId: input.job.id, splfKey: input.job.splfKey, destinationId: input.destinationId, kind, ...row });
}

/** The error of a document not tried, since an earlier one failed in a way the rest would too. */
export const notSent = (reason: string): string => `Not sent: ${reason}`;

/** `, 2 were sent in run #4`, or "" when none was delivered before. */
export function earlierText(already: number, runsBefore: Iterable<number>, verb: 'sent' | 'uploaded'): string {
  if (already === 0) return '';
  const seqs = [...new Set(runsBefore)];
  return `, ${already} ${already === 1 ? 'was' : 'were'} ${verb} in ${seqs.length === 1 ? `run #${seqs[0]}` : 'earlier runs'}`;
}

/**
 * The deliver step's error when some deliveries failed: what was done, the first failure,
 * and how many more there are.
 *
 * @param done - What was delivered, such as "Sent 2 of 3 documents to hooks.example.com"
 * @param list - The run's list that has each one, such as "Emails"
 */
export function deliveryFailed(done: string, failures: { message: string; detail?: string }[], list: string): StepError {
  const first = failures[0]!;
  const more = failures.length > 1 ? ` ${failures.length - 1} more failed; the ${list} list of the run has each one.` : '';
  return new StepError('deliver', `${done}. ${first.message}${more}`, first.detail);
}
