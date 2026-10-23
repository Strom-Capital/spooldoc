import 'server-only';

import { and, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, max, min, or, sql } from 'drizzle-orm';
import type { AlertsView } from '../types';
import { getConfig } from './config';
import { getDb, getLocks } from './db';
import { alerts, jobs, queueHealth, runs, servers, settings, type AlertResolution, type RunStep } from './db/schema';
import { textToHtml } from './email-message';
import { redact } from './http';
import { log } from './log';
import { fromHeader, mailErrorText, mailSender, mailServer, NO_MAIL_SERVER } from './mail';
import { DEFAULT_SETTINGS } from './settings';

/** How often the alerts check runs. */
export const ALERT_CHECK_MS = 30_000;
/** How long a server, job or queue error lasts before it alerts, so a short blip sends nothing. */
export const HEALTH_WAIT_MS = 5 * 60_000;
/** How long after a failed send the next try is. */
export const RETRY_MS = 5 * 60_000;

type AlertKind = 'run' | 'server' | 'job' | 'queue';
type AlertRow = typeof alerts.$inferSelect;

/** The run statuses that end a run. Skipped runs and running ones never open or close an alert. */
const FINISHED = ['success', 'warning', 'failed'];
const PROBLEM = ['warning', 'failed'];

/** A problem Needs attention lists right now, as an alert would record it. */
interface Problem {
  key: string;
  kind: AlertKind;
  subjectId: string;
  title: string;
  error: string | null;
  path: string;
  /** When it started, as far as the columns tell. */
  openedAt: Date;
  runId?: string;
}

/**
 * Everything Needs attention lists, read from the same columns as Home but ignoring
 * dismissal: the jobs whose latest finished run failed or ended with a warning (after
 * `since`), the servers that cannot be reached, the jobs whose watching reports an error,
 * and the queues that are polled because real-time watching stopped.
 */
async function currentProblems(since: Date, now: Date): Promise<Problem[]> {
  const db = getDb();
  // The newest finished run of each job, read through the (job, started) index.
  const latest = db
    .select({ id: runs.id, status: runs.status, error: runs.error, finishedAt: runs.finishedAt })
    .from(runs)
    .where(and(sql`${runs.jobId} = ${jobs.id}`, inArray(runs.status, FINISHED)))
    .orderBy(desc(runs.startedAt))
    .limit(1)
    .as('latest');
  const [runRows, serverRows, jobRows, queueRows] = await Promise.all([
    db
      .select({ jobId: jobs.id, name: jobs.name, runId: latest.id, status: latest.status, error: latest.error, finishedAt: latest.finishedAt })
      .from(jobs)
      .innerJoinLateral(latest, sql`true`),
    db.select({ id: servers.id, name: servers.name, error: servers.lastError, since: servers.errorSince }).from(servers).where(isNotNull(servers.lastError)),
    db.select({ id: jobs.id, name: jobs.name, error: jobs.lastWatchError }).from(jobs).where(isNotNull(jobs.lastWatchError)),
    db
      .select({
        id: queueHealth.id,
        serverId: queueHealth.serverId,
        serverName: servers.name,
        library: queueHealth.library,
        name: queueHealth.name,
        error: queueHealth.realtimeError,
        since: queueHealth.realtimeErrorSince,
      })
      .from(queueHealth)
      .innerJoin(servers, eq(servers.id, queueHealth.serverId))
      .where(isNotNull(queueHealth.realtimeError)),
  ]);
  return [
    ...runRows
      .filter((r) => PROBLEM.includes(r.status) && r.finishedAt && r.finishedAt >= since)
      .map((r) => ({
        key: `run:${r.jobId}`,
        kind: 'run' as const,
        subjectId: r.jobId,
        title: r.name,
        error: r.error,
        path: `/runs?job=${r.jobId}`,
        openedAt: r.finishedAt!,
        runId: r.runId,
      })),
    ...serverRows.map((s) => ({ key: `server:${s.id}`, kind: 'server' as const, subjectId: s.id, title: s.name, error: s.error, path: '/servers', openedAt: s.since ?? now })),
    ...jobRows.map((j) => ({ key: `job:${j.id}`, kind: 'job' as const, subjectId: j.id, title: j.name, error: j.error, path: `/jobs/${j.id}`, openedAt: now })),
    ...queueRows.map((q) => ({
      key: `queue:${q.id}`,
      kind: 'queue' as const,
      subjectId: q.id,
      title: `${q.library}/${q.name} on ${q.serverName}`,
      error: q.error,
      path: `/queues/${q.serverId}/${encodeURIComponent(q.library)}/${encodeURIComponent(q.name)}`,
      openedAt: q.since ?? now,
    })),
  ];
}

/** The failed and warning runs of a job since its last success (and since `since`): how many, and when the first finished. */
async function streak(jobId: string, since: Date): Promise<{ first: Date | null; runs: number }> {
  const db = getDb();
  const [success] = await db
    .select({ at: max(runs.finishedAt) })
    .from(runs)
    .where(and(eq(runs.jobId, jobId), eq(runs.status, 'success')));
  const after = success?.at && success.at > since ? success.at : null;
  const [row] = await db
    .select({ first: min(runs.finishedAt), n: count() })
    .from(runs)
    .where(and(eq(runs.jobId, jobId), inArray(runs.status, PROBLEM), after ? gt(runs.finishedAt, after) : gte(runs.finishedAt, since)));
  return { first: row?.first ?? null, runs: row?.n ?? 0 };
}

/** How many runs of a job failed, and how many ended with a warning, since the alert opened. */
async function problemRuns(jobId: string, since: Date): Promise<{ failed: number; warning: number }> {
  const rows = await getDb()
    .select({ status: runs.status, n: count() })
    .from(runs)
    .where(and(eq(runs.jobId, jobId), inArray(runs.status, PROBLEM), gte(runs.finishedAt, since)))
    .groupBy(runs.status);
  return { failed: rows.find((r) => r.status === 'failed')?.n ?? 0, warning: rows.find((r) => r.status === 'warning')?.n ?? 0 };
}

/** Why an alert closed: what it was about was deleted, a run succeeded, or the error cleared. */
async function resolutionOf(row: AlertRow): Promise<AlertResolution> {
  const db = getDb();
  const table = row.kind === 'server' ? servers : row.kind === 'queue' ? queueHealth : jobs;
  const [exists] = await db.select({ id: table.id }).from(table).where(eq(table.id, row.subjectId));
  if (!exists) return { kind: 'deleted' };
  if (row.kind !== 'run') return { kind: 'fixed' };
  const [run] = await db
    .select({ seq: runs.seq, status: runs.status, finishedAt: runs.finishedAt })
    .from(runs)
    .where(and(eq(runs.jobId, row.subjectId), inArray(runs.status, FINISHED)))
    .orderBy(desc(runs.startedAt))
    .limit(1);
  return run?.status === 'success' && run.finishedAt ? { kind: 'success', seq: run.seq, at: run.finishedAt.toISOString() } : { kind: 'fixed' };
}

/**
 * Bring the `alerts` table in line with the problems now: a new problem opens a row, one
 * already open is updated (a later failed run of the same job counts, and sends nothing),
 * and an open row whose problem is gone is closed.
 */
async function reconcile(now: Date, since: Date): Promise<void> {
  const db = getDb();
  const problems = await currentProblems(since, now);
  const open = await db.select().from(alerts).where(isNull(alerts.resolvedAt));
  const byKey = new Map(open.map((row) => [row.key, row]));
  for (const problem of problems) {
    const row = byKey.get(problem.key);
    byKey.delete(problem.key);
    if (!row) {
      const counted = problem.kind === 'run' ? await streak(problem.subjectId, since) : null;
      await db.insert(alerts).values({
        key: problem.key,
        kind: problem.kind,
        subjectId: problem.subjectId,
        title: problem.title,
        error: problem.error,
        path: problem.path,
        openedAt: counted?.first ?? problem.openedAt,
        runId: problem.runId ?? null,
        runs: counted ? Math.max(counted.runs, 1) : 0,
      });
      continue;
    }
    const change: Partial<typeof alerts.$inferInsert> = {};
    if (row.title !== problem.title) change.title = problem.title;
    if (row.error !== problem.error) change.error = problem.error;
    if (row.path !== problem.path) change.path = problem.path;
    if (problem.runId && row.runId !== problem.runId) {
      const counted = await problemRuns(problem.subjectId, row.openedAt);
      change.runId = problem.runId;
      change.runs = counted.failed + counted.warning;
    }
    if (Object.keys(change).length > 0) await db.update(alerts).set(change).where(eq(alerts.id, row.id));
  }
  for (const row of byKey.values()) {
    await db
      .update(alerts)
      .set({ resolvedAt: now, resolution: await resolutionOf(row) })
      .where(eq(alerts.id, row.id));
  }
}

/** "09:14 UTC" for a time today, else "2026-10-22 09:14 UTC". */
export function alertTime(at: Date, now: Date): string {
  const iso = at.toISOString();
  const day = iso.slice(0, 10);
  return `${day === now.toISOString().slice(0, 10) ? '' : `${day} `}${iso.slice(11, 16)} UTC`;
}

/** The text with a period at the end, unless it ends a sentence already. */
const sentence = (text: string): string => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

const STEP_NAMES: Record<RunStep['step'], string> = { capture: 'Capture', extract: 'Extract', lookup: 'Lookups', render: 'Render', deliver: 'Deliver', finish: 'Finish' };

/** "3 runs failed since 09:14 UTC", "2 runs failed and 1 ended with a warning since ...". */
function countText(counted: { failed: number; warning: number }, since: string): string {
  const runsWord = (n: number) => `${n} ${n === 1 ? 'run' : 'runs'}`;
  const { failed, warning } = counted;
  if (failed > 0 && warning > 0) return `${runsWord(failed)} failed and ${warning} ended with a warning since ${since}.`;
  if (warning > 0) return `${runsWord(warning)} ended with a warning since ${since}.`;
  return `${runsWord(failed)} failed since ${since}.`;
}

/** One problem or fix in an email: the headline (the subject when it is the only one) and its lines. */
interface Block {
  headline: string;
  lines: string[];
}

/** The email block of an alert that opened. */
async function openingBlock(row: AlertRow, now: Date): Promise<Block> {
  const db = getDb();
  const link = appLink(row.path);
  const since = alertTime(row.openedAt, now);
  const lines: string[] = [];
  let headline: string;
  if (row.kind === 'run') {
    const [run] = row.runId
      ? await db.select({ seq: runs.seq, status: runs.status, error: runs.error, steps: runs.steps, finishedAt: runs.finishedAt }).from(runs).where(eq(runs.id, row.runId))
      : [];
    const warning = run?.status === 'warning';
    headline = `${row.title} ${warning ? 'ended with a warning' : 'failed'}`;
    if (run) {
      const step = run.steps.find((s) => !s.ok)?.step;
      const what = warning ? 'ended with a warning' : `failed${step ? ` in ${STEP_NAMES[step]}` : ''}`;
      const at = run.finishedAt ? ` at ${alertTime(run.finishedAt, now)}` : '';
      lines.push(run.error ? `Run ${run.seq}${at} ${what}: ${sentence(run.error)}` : `Run ${run.seq}${at} ${what}.`);
    } else if (row.error) {
      lines.push(sentence(row.error));
    }
    if (row.runs > 1) lines.push(countText(await problemRuns(row.subjectId, row.openedAt), since));
  } else if (row.kind === 'server') {
    const [server] = await db.select({ errorCode: servers.errorCode }).from(servers).where(eq(servers.id, row.subjectId));
    const auth = server?.errorCode === 'auth';
    headline = auth ? `Sign-on to ${row.title} failed` : `${row.title} cannot be reached`;
    lines.push(`Since ${since}: ${sentence(row.error ?? 'No answer')}`);
    lines.push(
      auth
        ? 'Spooldoc does not sign on again until you edit the password or press Reconnect on the Servers page, so the user profile is not disabled.'
        : 'Spooldoc tries again by itself.',
    );
  } else if (row.kind === 'job') {
    headline = `${row.title} cannot process new spooled files`;
    lines.push(`Since ${since}: ${sentence(row.error ?? 'Watching reports an error')}`);
  } else {
    headline = `${row.title} is polled`;
    lines.push(`Real-time watching stopped at ${since}: ${sentence(row.error ?? 'No reason given')} New spooled files are still found, more slowly.`);
  }
  if (link) lines.push(link);
  return { headline, lines };
}

/** The email block of an alert that closed: one note. */
async function closingBlock(row: AlertRow, now: Date): Promise<Block> {
  const resolution = row.resolution ?? { kind: 'fixed' };
  if (resolution.kind === 'deleted') {
    const note = row.kind === 'queue' ? `${row.title} is no longer watched` : `${row.title} was deleted`;
    return { headline: note, lines: [`${note}.`] };
  }
  if (row.kind === 'run') {
    if (resolution.kind === 'success') {
      const counted = await problemRuns(row.subjectId, row.openedAt);
      const total = counted.failed + counted.warning;
      const runs = total > 0 ? countText(counted, alertTime(row.openedAt, now)) : '';
      return {
        headline: `${row.title} works again`,
        lines: [`${row.title} works again. Run ${resolution.seq} succeeded at ${alertTime(new Date(resolution.at), now)}.${runs ? ` ${runs}` : ''}`],
      };
    }
    return { headline: `${row.title} no longer needs attention`, lines: [`${row.title} no longer needs attention.`] };
  }
  const note = {
    server: `${row.title} is connected again`,
    job: `${row.title} processes new spooled files again`,
    queue: `${row.title} is watched in real time again`,
  }[row.kind as Exclude<AlertKind, 'run'>];
  return { headline: note, lines: [`${note}.`] };
}

/** The page at the app's address, or null when APP_URL is not set. */
function appLink(path: string): string | null {
  const base = getConfig().appUrl;
  return base ? new URL(path, base).toString() : null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The subject and text of one email holding every opening and closing of this pass. */
export function composeAlert(openings: Block[], closings: Block[]): { subject: string; text: string } {
  let subject: string;
  if (openings.length + closings.length === 1) subject = `Spooldoc: ${(openings[0] ?? closings[0])!.headline}`;
  else if (openings.length === 0) subject = `Spooldoc: ${plural(closings.length, 'problem', 'problems')} fixed`;
  else subject = `Spooldoc: ${plural(openings.length, 'problem', 'problems')}${closings.length > 0 ? `, ${closings.length} fixed` : ''}`;

  const paragraphs = openings.map((block) => [block.headline, ...block.lines].join('\n'));
  if (closings.length > 0) {
    const notes = closings.flatMap((block) => block.lines);
    paragraphs.push(openings.length > 0 ? ['Fixed', ...notes].join('\n') : notes.join('\n'));
  }
  const settingsLink = appLink('/settings#alerts');
  paragraphs.push(`Spooldoc sends these alerts to the addresses in Settings, under Alerts.${settingsLink ? `\n${settingsLink}` : ''}`);
  return { subject, text: `${paragraphs.join('\n\n')}\n` };
}

/**
 * Send one email to the alert addresses with the saved mail server.
 *
 * @throws Error with the reason in plain words, and the mail server's own text as `detail`
 */
async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const server = await mailServer();
  if (!server) throw new Error(NO_MAIL_SERVER);
  const sender = mailSender(server);
  try {
    await sender.sendMail({ from: fromHeader(server), to, subject, text, html: textToHtml(text) });
  } catch (error) {
    const { message, detail } = mailErrorText(error, server);
    throw Object.assign(new Error(message), { detail });
  } finally {
    sender.close?.();
  }
}

const settingsColumns = {
  alertTo: settings.alertTo,
  alertsSince: settings.alertsSince,
  alertSentAt: settings.alertSentAt,
  alertError: settings.alertError,
  alertErrorDetail: settings.alertErrorDetail,
  alertErrorAt: settings.alertErrorAt,
};

async function readSettings() {
  const [row] = await getDb().select(settingsColumns).from(settings).where(eq(settings.id, 1));
  return row ?? { alertTo: null, alertsSince: null, alertSentAt: null, alertError: null, alertErrorDetail: null, alertErrorAt: null };
}

async function saveSettings(values: Partial<typeof settings.$inferInsert>): Promise<void> {
  await getDb()
    .insert(settings)
    .values({ id: 1, ...DEFAULT_SETTINGS, ...values })
    .onConflictDoUpdate({ target: settings.id, set: values });
}

/** What one alerts check did. Null: another instance holds the lock. */
export type AlertPass = 'off' | 'idle' | 'waiting' | 'sent' | 'failed' | null;

/**
 * One alerts check: with alert addresses saved, bring the alerts in line with Needs
 * attention, then send one email with every alert that is due to open (a run at once, a
 * server, job or queue error after 5 minutes) and every closing of an alert whose opening
 * was sent. A failed send marks nothing sent, records why on the settings row, and the
 * next try is 5 minutes later. One instance checks at a time.
 */
export async function checkAlerts(now: Date = new Date()): Promise<AlertPass> {
  const release = await getLocks().tryLock('alerts');
  if (!release) return null;
  try {
    const row = await readSettings();
    if (!row.alertTo) return 'off';
    await reconcile(now, row.alertsSince ?? new Date(0));

    const db = getDb();
    const healthDue = new Date(now.getTime() - HEALTH_WAIT_MS);
    const [opening, closing] = await Promise.all([
      db
        .select()
        .from(alerts)
        .where(and(isNull(alerts.resolvedAt), isNull(alerts.openSentAt), or(eq(alerts.kind, 'run'), lte(alerts.openedAt, healthDue))))
        .orderBy(desc(alerts.openedAt)),
      db
        .select()
        .from(alerts)
        .where(and(isNotNull(alerts.resolvedAt), isNotNull(alerts.openSentAt), isNull(alerts.resolveSentAt)))
        .orderBy(alerts.resolvedAt),
    ]);
    if (opening.length === 0 && closing.length === 0) return 'idle';
    if (row.alertErrorAt && now.getTime() - row.alertErrorAt.getTime() < RETRY_MS) return 'waiting';

    const email = composeAlert(
      await Promise.all(opening.map((alert) => openingBlock(alert, now))),
      await Promise.all(closing.map((alert) => closingBlock(alert, now))),
    );
    try {
      await sendEmail(row.alertTo, email.subject, email.text);
    } catch (error) {
      const message = redact(error);
      const detail = error instanceof Error && 'detail' in error && typeof error.detail === 'string' ? error.detail : null;
      await saveSettings({ alertError: message, alertErrorDetail: detail, alertErrorAt: now });
      // Logged when the error first shows or changes, not on every try.
      if (message !== row.alertError) log.warn('Could not send alerts', { error: message, ...(detail ? { detail } : {}) });
      return 'failed';
    }
    if (opening.length > 0) await db.update(alerts).set({ openSentAt: now }).where(inArray(alerts.id, opening.map((alert) => alert.id)));
    if (closing.length > 0) await db.update(alerts).set({ resolveSentAt: now }).where(inArray(alerts.id, closing.map((alert) => alert.id)));
    await saveSettings({ alertSentAt: now, alertError: null, alertErrorDetail: null, alertErrorAt: null });
    if (row.alertError) log.info('Alerts send again');
    log.info('Sent an alert', { subject: email.subject, opened: opening.length, fixed: closing.length });
    return 'sent';
  } finally {
    await release();
  }
}

/** Where alerts go and how the last send went, for Settings. */
export async function getAlertsView(): Promise<AlertsView> {
  const row = await readSettings();
  return {
    to: row.alertTo ?? '',
    sentAt: row.alertSentAt?.toISOString() ?? null,
    error:
      row.alertError && row.alertErrorAt
        ? {
            message: row.alertError,
            detail: row.alertErrorDetail,
            at: row.alertErrorAt.toISOString(),
            nextTryAt: new Date(row.alertErrorAt.getTime() + RETRY_MS).toISOString(),
          }
        : null,
  };
}

/**
 * Save the alert addresses; empty turns alerts off. Turning them on starts from now: only
 * runs that finish after it alert, and alerts left open from before are dropped, so a
 * server or queue that has a problem right now alerts again. New addresses clear the last
 * send error, so the next check tries at once.
 */
export async function updateAlerts(to: string, now: Date = new Date()): Promise<void> {
  const before = await readSettings();
  const values: Partial<typeof settings.$inferInsert> = { alertTo: to || null };
  const turnsOn = !before.alertTo && !!to;
  if (turnsOn) values.alertsSince = now;
  if ((before.alertTo ?? '') !== to) Object.assign(values, { alertError: null, alertErrorDetail: null, alertErrorAt: null });
  if (turnsOn) await getDb().delete(alerts).where(isNull(alerts.resolvedAt));
  await saveSettings(values);
}

/** Why no test alert can be sent: no addresses are saved. */
export const NO_ALERT_ADDRESSES = 'Could not send a test alert: no addresses are saved. Enter them under Alerts and save first.';

/** What alerts are sent for, for the test alert and nowhere else. */
const TEST_TEXT = [
  'This test alert shows that Spooldoc can send alerts to these addresses.',
  [
    'Spooldoc sends an alert when:',
    '- a run fails or ends with a warning',
    '- a server cannot be reached for 5 minutes',
    '- a job cannot process new spooled files for 5 minutes',
    '- an output queue is polled for 5 minutes because real-time watching stopped',
  ].join('\n'),
  'It sends one email when a problem starts and one when it is fixed.',
];

/**
 * Send a test alert to the saved alert addresses.
 *
 * @returns The addresses it went to
 * @throws Error with the reason in plain words when it cannot be sent, and the mail server's text as `detail`
 */
export async function sendTestAlert(): Promise<{ to: string }> {
  const { alertTo } = await readSettings();
  if (!alertTo) throw new Error(NO_ALERT_ADDRESSES);
  const settingsLink = appLink('/settings#alerts');
  const text = `${[...TEST_TEXT, `Spooldoc sends alerts to the addresses in Settings, under Alerts.${settingsLink ? `\n${settingsLink}` : ''}`].join('\n\n')}\n`;
  await sendEmail(alertTo, 'Spooldoc: test alert', text);
  return { to: alertTo };
}

const KEY = Symbol.for('spooldoc.alerts.checks');
type Holder = typeof globalThis & { [KEY]?: ReturnType<typeof setInterval> };

/** Check for alerts every 30 seconds, once per process. Every instance runs it; the lock lets one check at a time. */
export function startAlerts(): void {
  const holder = globalThis as Holder;
  if (holder[KEY]) return;
  const run = () => {
    checkAlerts().catch((error: unknown) => log.warn('Could not check for alerts', { error: redact(error) }));
  };
  holder[KEY] = setInterval(run, ALERT_CHECK_MS);
  holder[KEY].unref?.();
}
