import { eq } from 'drizzle-orm';
import type { SendMailOptions } from 'nodemailer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { alerts, jobs, queueHealth, runs, servers, settings, type RunStep } from '@/lib/server/db/schema';
import { setLogSink } from '@/lib/server/log';
import { NO_MAIL_SERVER, setMailSender } from '@/lib/server/mail';
import type { RunStatus, SettingsView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { resetTables } from './helpers/db';
import { db, insertJob, insertServer, testDb } from './helpers/fixtures';
import { appRequest } from './helpers/mocks';

const { checkAlerts, composeAlert, updateAlerts, HEALTH_WAIT_MS, RETRY_MS } = await import('@/lib/server/alerts');
const settingsRoute = await import('@/app/api/settings/route');
const testRoute = await import('@/app/api/settings/alerts/route');

const MINUTE = 60_000;
const T0 = new Date('2026-10-23T09:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * MINUTE);

let serverId: string;
let jobId: string;
let sent: SendMailOptions[];

/** A finished run of the job (or a running one), finished at `finishedAt`. */
async function insertRun(status: RunStatus, finishedAt: Date, values: { error?: string; steps?: RunStep[]; job?: string } = {}): Promise<{ id: string; seq: number }> {
  const splf = { name: 'QPRINT', number: 1, jobName: 'MYJOB', jobUser: 'MYUSER', jobNumber: '000001' };
  const [row] = await db()
    .insert(runs)
    .values({
      jobId: values.job ?? jobId,
      version: 1,
      trigger: 'watch',
      splf,
      status,
      error: values.error ?? null,
      steps: values.steps ?? [],
      startedAt: new Date(finishedAt.getTime() - 1000),
      finishedAt: status === 'running' ? null : finishedAt,
    })
    .returning({ id: runs.id, seq: runs.seq });
  return row!;
}

const deliverFailed: RunStep[] = [
  { step: 'capture', ok: true, ms: 5 },
  { step: 'deliver', ok: false, ms: 5, error: 'Could not write to /invoices.' },
];

/** Catch the log lines from here on. */
function captureLog(): { level: string; msg: string; [field: string]: unknown }[] {
  const lines: { level: string; msg: string }[] = [];
  process.env.SPOOLDOC_LOG_LEVEL = 'info';
  setLogSink((line) => lines.push(JSON.parse(line)));
  return lines;
}

/** Send through a stand-in that keeps each message. */
function catchMail(): void {
  setMailSender(() => ({ sendMail: async (message) => (sent.push(message), { messageId: `<${sent.length}@example.com>` }) }));
}

beforeEach(async () => {
  await resetTables(db());
  sent = [];
  catchMail();
  await db().update(settings).set({ smtpHost: 'smtp.example.com', smtpPort: 587, mailFrom: 'spooldoc@example.com' });
  serverId = await insertServer({ name: 'MYSERVER' });
  jobId = await insertJob(serverId);
  await db().update(jobs).set({ name: 'MYJOB' }).where(eq(jobs.id, jobId));
  await updateAlerts('ops@example.com', T0);
});

afterEach(() => {
  setMailSender(null);
  setLogSink(null);
  process.env.SPOOLDOC_LOG_LEVEL = 'off';
});

describe('run alerts', () => {
  it('send one email when a run fails, and nothing for more failed runs of the same job', async () => {
    const run = await insertRun('failed', at(14), { error: 'Could not write to /invoices.', steps: deliverFailed });

    expect(await checkAlerts(at(14))).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'ops@example.com', subject: 'Spooldoc: MYJOB failed', from: 'spooldoc@example.com' });
    expect(sent[0]!.text).toBe(
      [
        'MYJOB failed',
        `Run ${run.seq} at 09:14 UTC failed in Deliver: Could not write to /invoices.`,
        `http://localhost:3000/runs?job=${jobId}`,
        '',
        'Spooldoc sends these alerts to the addresses in Settings, under Alerts.',
        'http://localhost:3000/settings#alerts',
        '',
      ].join('\n'),
    );
    expect(sent[0]!.html).toContain('<p style="margin:0 0 1em">MYJOB failed<br>');

    for (const minute of [15, 16, 17]) {
      await insertRun('failed', at(minute), { error: 'Could not write to /invoices.' });
      expect(await checkAlerts(at(minute))).toBe('idle');
    }
    expect(sent).toHaveLength(1);
    const [row] = await db().select().from(alerts);
    expect(row).toMatchObject({ key: `run:${jobId}`, kind: 'run', runs: 4, openedAt: at(14), resolvedAt: null, openSentAt: at(14) });
  });

  it('send for a run that ends with a warning, and never for skipped or running runs', async () => {
    await insertRun('skipped', at(1));
    await insertRun('running', at(2));
    expect(await checkAlerts(at(3))).toBe('idle');
    expect(sent).toHaveLength(0);

    const run = await insertRun('warning', at(4), { error: 'Page group 3 has no customer number' });
    expect(await checkAlerts(at(5))).toBe('sent');
    expect(sent[0]!.subject).toBe('Spooldoc: MYJOB ended with a warning');
    expect(sent[0]!.text).toContain(`Run ${run.seq} at 09:04 UTC ended with a warning: Page group 3 has no customer number.`);
  });

  it('send one recovery note when a later run succeeds, with how many runs failed', async () => {
    await insertRun('failed', at(14), { error: 'Could not write to /invoices.' });
    await checkAlerts(at(14));
    await insertRun('failed', at(20), { error: 'Could not write to /invoices.' });
    await insertRun('warning', at(25), { error: 'A warning' });
    await checkAlerts(at(25));
    const ok = await insertRun('success', at(65));

    expect(await checkAlerts(at(65))).toBe('sent');
    expect(sent).toHaveLength(2);
    expect(sent[1]!.subject).toBe('Spooldoc: MYJOB works again');
    expect(sent[1]!.text).toContain(`MYJOB works again. Run ${ok.seq} succeeded at 10:05 UTC. 2 runs failed and 1 ended with a warning since 09:14 UTC.`);

    expect(await checkAlerts(at(66))).toBe('idle');
    expect(sent).toHaveLength(2);
    // The next failure opens a new alert.
    await insertRun('failed', at(70), { error: 'Could not write to /invoices.' });
    expect(await checkAlerts(at(70))).toBe('sent');
    expect(sent[2]!.subject).toBe('Spooldoc: MYJOB failed');
  });

  it('count the failed runs since the last success when the alert opens', async () => {
    await insertRun('failed', at(1));
    await insertRun('failed', at(2));
    expect(await checkAlerts(at(3))).toBe('sent');
    expect(sent[0]!.text).toContain('2 runs failed since 09:01 UTC.');
  });

  it('leave out runs that finished before alerts were turned on', async () => {
    await insertRun('failed', at(-10), { error: 'Could not write to /invoices.' });
    expect(await checkAlerts(at(1))).toBe('idle');
    expect(sent).toHaveLength(0);
    expect(await db().select().from(alerts)).toEqual([]);
  });

  it('close with a note when the job is deleted', async () => {
    await insertRun('failed', at(1));
    await checkAlerts(at(1));
    await db().delete(jobs).where(eq(jobs.id, jobId));

    expect(await checkAlerts(at(2))).toBe('sent');
    expect(sent[1]).toMatchObject({ subject: 'Spooldoc: MYJOB was deleted' });
    expect(sent[1]!.text).toMatch(/^MYJOB was deleted\.\n/);
  });

  it('close a job deleted before its opening was sent without an email', async () => {
    await insertRun('failed', at(1));
    sent = [];
    setMailSender(() => ({
      sendMail: async () => {
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNECTION' });
      },
    }));
    expect(await checkAlerts(at(1))).toBe('failed');
    await db().delete(jobs).where(eq(jobs.id, jobId));
    catchMail();
    expect(await checkAlerts(at(10))).toBe('idle');
    expect(sent).toHaveLength(0);
  });
});

describe('server, job and queue alerts', () => {
  it('wait 5 minutes before a server that cannot be reached alerts, and send a note when it is back', async () => {
    await db()
      .update(servers)
      .set({ lastError: 'Could not connect to ibmi.example.com on port 8471', errorCode: 'host', errorSince: at(0) })
      .where(eq(servers.id, serverId));

    expect(await checkAlerts(at(1))).toBe('idle');
    expect(await checkAlerts(at(4))).toBe('idle');
    expect(sent).toHaveLength(0);
    expect(await checkAlerts(new Date(at(0).getTime() + HEALTH_WAIT_MS))).toBe('sent');
    expect(sent[0]!.subject).toBe('Spooldoc: MYSERVER cannot be reached');
    expect(sent[0]!.text).toContain('Since 09:00 UTC: Could not connect to ibmi.example.com on port 8471.\nSpooldoc tries again by itself.');
    expect(sent[0]!.text).toContain('http://localhost:3000/servers');

    await db().update(servers).set({ lastError: null, errorCode: null, errorSince: null }).where(eq(servers.id, serverId));
    expect(await checkAlerts(at(20))).toBe('sent');
    expect(sent[1]!.subject).toBe('Spooldoc: MYSERVER is connected again');
  });

  it('word a failed sign-on as one', async () => {
    await db()
      .update(servers)
      .set({ lastError: 'The password of MYUSER is not correct', errorCode: 'auth', errorSince: at(-30) })
      .where(eq(servers.id, serverId));
    expect(await checkAlerts(at(0))).toBe('sent');
    expect(sent[0]!.subject).toBe('Spooldoc: Sign-on to MYSERVER failed');
  });

  it('wait 5 minutes from when a job watch error is first seen', async () => {
    await db().update(jobs).set({ lastWatchError: 'New spooled files wait until Carbone works again.' }).where(eq(jobs.id, jobId));
    expect(await checkAlerts(at(10))).toBe('idle');
    expect(await checkAlerts(at(14))).toBe('idle');
    expect(await checkAlerts(at(15))).toBe('sent');
    expect(sent[0]!.subject).toBe('Spooldoc: MYJOB cannot process new spooled files');
    expect(sent[0]!.text).toContain(`Since 09:10 UTC: New spooled files wait until Carbone works again.\nhttp://localhost:3000/jobs/${jobId}`);

    await db().update(jobs).set({ lastWatchError: null }).where(eq(jobs.id, jobId));
    expect(await checkAlerts(at(16))).toBe('sent');
    expect(sent[1]!.subject).toBe('Spooldoc: MYJOB processes new spooled files again');
  });

  it('send nothing for a queue that heals within 5 minutes', async () => {
    const [queue] = await db()
      .insert(queueHealth)
      .values({ serverId, library: 'MYLIB', name: 'MYOUTQ', realtimeError: 'Connection reset', realtimeErrorSince: at(0) })
      .returning({ id: queueHealth.id });
    expect(await checkAlerts(at(1))).toBe('idle');
    await db().update(queueHealth).set({ realtimeError: null, realtimeErrorSince: null }).where(eq(queueHealth.id, queue!.id));
    expect(await checkAlerts(at(6))).toBe('idle');
    expect(sent).toHaveLength(0);
    expect(await db().select().from(alerts)).toMatchObject([{ key: `queue:${queue!.id}`, resolvedAt: at(6), openSentAt: null }]);
    expect(await checkAlerts(at(30))).toBe('idle');
    expect(sent).toHaveLength(0);
  });

  it('send for a queue polled for 5 minutes, with its page', async () => {
    await db().insert(queueHealth).values({ serverId, library: 'MYLIB', name: 'MYOUTQ', realtimeError: 'Connection reset', realtimeErrorSince: at(0) });
    expect(await checkAlerts(at(5))).toBe('sent');
    expect(sent[0]!.subject).toBe('Spooldoc: MYLIB/MYOUTQ on MYSERVER is polled');
    expect(sent[0]!.text).toContain(
      `Real-time watching stopped at 09:00 UTC: Connection reset. New spooled files are still found, more slowly.\nhttp://localhost:3000/queues/${serverId}/MYLIB/MYOUTQ`,
    );
  });

  it('alert while dismissed in Needs attention', async () => {
    await db()
      .update(servers)
      .set({ lastError: 'Could not connect', errorCode: 'host', errorSince: at(-10), errorDismissed: 'Could not connect' })
      .where(eq(servers.id, serverId));
    expect(await checkAlerts(at(0))).toBe('sent');
  });
});

describe('the alert email', () => {
  it('holds every problem and fix of one check, problems newest first', async () => {
    await db().update(servers).set({ lastError: 'Could not connect', errorCode: 'host', errorSince: at(-30) }).where(eq(servers.id, serverId));
    await insertRun('failed', at(1), { error: 'Could not write to /invoices.' });

    expect(await checkAlerts(at(1))).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe('Spooldoc: 2 problems');
    const text = String(sent[0]!.text);
    expect(text.indexOf('MYJOB failed')).toBeLessThan(text.indexOf('MYSERVER cannot be reached'));

    await insertRun('success', at(2));
    await db().update(servers).set({ lastError: null, errorCode: null, errorSince: null }).where(eq(servers.id, serverId));
    const other = await insertJob(serverId);
    await db().update(jobs).set({ name: 'MYOTHERJOB' }).where(eq(jobs.id, other));
    await insertRun('failed', at(3), { job: other });

    expect(await checkAlerts(at(3))).toBe('sent');
    expect(sent[1]!.subject).toBe('Spooldoc: 1 problem, 2 fixed');
    expect(sent[1]!.text).toMatch(/^MYOTHERJOB failed\n[\s\S]*\n\nFixed\n(MYJOB works again\.[^\n]*\nMYSERVER is connected again\.|MYSERVER is connected again\.\nMYJOB works again\.[^\n]*)\n\n/);
  });

  it('names the count of problems and fixes in the subject', () => {
    const block = (headline: string) => ({ headline, lines: [`${headline}.`] });
    expect(composeAlert([block('A failed'), block('B failed'), block('C failed')], [block('D works again')]).subject).toBe('Spooldoc: 3 problems, 1 fixed');
    expect(composeAlert([block('A failed')], [block('D works again')]).subject).toBe('Spooldoc: 1 problem, 1 fixed');
    expect(composeAlert([], [block('D works again'), block('E works again')]).subject).toBe('Spooldoc: 2 problems fixed');
    expect(composeAlert([block('A failed'), block('B failed')], []).subject).toBe('Spooldoc: 2 problems');
    expect(composeAlert([], [block('D works again')]).subject).toBe('Spooldoc: D works again');
  });

  it('gives the date of a time that is not today', async () => {
    await insertRun('failed', at(1));
    expect(await checkAlerts(at(24 * 60))).toBe('sent');
    expect(sent[0]!.text).toContain('at 2026-10-23 09:01 UTC failed');
  });
});

describe('sending', () => {
  it('keeps everything unsent when the mail server fails, tries again after 5 minutes, and logs each error once', async () => {
    const log = captureLog();
    let tries = 0;
    setMailSender(() => ({
      sendMail: async () => {
        tries += 1;
        throw Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535, response: '535 5.7.8 Bad credentials' });
      },
    }));
    await insertRun('failed', at(1));

    expect(await checkAlerts(at(1))).toBe('failed');
    expect(await db().select({ openSentAt: alerts.openSentAt }).from(alerts)).toEqual([{ openSentAt: null }]);
    const [row] = await db().select().from(settings);
    expect(row).toMatchObject({ alertErrorAt: at(1), alertErrorDetail: '535 5.7.8 Bad credentials', alertSentAt: null });
    expect(row!.alertError).toMatch(/^The mail server refused the sign-in/);

    expect(await checkAlerts(at(4))).toBe('waiting');
    expect(tries).toBe(1);
    expect(await checkAlerts(new Date(at(1).getTime() + RETRY_MS))).toBe('failed');
    expect(tries).toBe(2);
    expect(log.filter((line) => line.level === 'warn')).toMatchObject([{ msg: 'Could not send alerts', detail: '535 5.7.8 Bad credentials' }]);

    catchMail();
    expect(await checkAlerts(at(20))).toBe('sent');
    expect(sent[0]!.subject).toBe('Spooldoc: MYJOB failed');
    expect(await db().select({ alertError: settings.alertError, alertErrorAt: settings.alertErrorAt, alertSentAt: settings.alertSentAt }).from(settings)).toEqual([
      { alertError: null, alertErrorAt: null, alertSentAt: at(20) },
    ]);
    expect(log.map((line) => line.msg)).toContain('Alerts send again');
  });

  it('sends nothing without alert addresses', async () => {
    await updateAlerts('', at(0));
    await insertRun('failed', at(1));
    expect(await checkAlerts(at(1))).toBe('off');
    expect(sent).toHaveLength(0);
  });

  it('records that no mail server is set', async () => {
    await db().update(settings).set({ smtpHost: null });
    await insertRun('failed', at(1));
    expect(await checkAlerts(at(1))).toBe('failed');
    expect(await db().select({ alertError: settings.alertError }).from(settings)).toEqual([{ alertError: NO_MAIL_SERVER }]);
  });

  it('does nothing while another instance checks', async () => {
    await insertRun('failed', at(1));
    const release = await testDb().locks.tryLock('alerts');
    expect(await checkAlerts(at(1))).toBeNull();
    expect(await db().select().from(alerts)).toEqual([]);
    await release!();
    expect(await checkAlerts(at(1))).toBe('sent');
  });
});

describe('the Alerts settings', () => {
  let auth: Record<string, string>;
  const put = (body: unknown) => settingsRoute.PUT(appRequest('/api/settings', { method: 'PUT', body, headers: auth }));
  const test = () => testRoute.POST(appRequest('/api/settings/alerts', { method: 'POST', headers: auth }));

  beforeEach(async () => {
    await updateAlerts('', at(0));
    auth = await signedIn();
  });

  it('saves the addresses as one list and starts alerts from now', async () => {
    const before = Date.now();
    const response = await put({ alerts: { to: ' ops@example.com; "Smith, Jo" <jo@example.com> ' } });
    expect(response.status).toBe(200);
    const view = (await response.json()) as SettingsView;
    expect(view.alerts).toEqual({ to: 'ops@example.com, "Smith, Jo" <jo@example.com>', sentAt: null, error: null });
    const [row] = await db().select({ alertsSince: settings.alertsSince }).from(settings);
    expect(row!.alertsSince!.getTime()).toBeGreaterThanOrEqual(before - 1000);

    // Saving the same addresses again keeps the start.
    await put({ alerts: { to: 'ops@example.com, "Smith, Jo" <jo@example.com>' } });
    expect(await db().select({ alertsSince: settings.alertsSince }).from(settings)).toEqual([row]);
  });

  it('turns alerts off with no addresses', async () => {
    await put({ alerts: { to: 'ops@example.com' } });
    const view = (await (await put({ alerts: { to: '' } })).json()) as SettingsView;
    expect(view.alerts.to).toBe('');
    expect(await db().select({ alertTo: settings.alertTo }).from(settings)).toEqual([{ alertTo: null }]);
  });

  it('refuses text that is not an address, and names it', async () => {
    const response = await put({ alerts: { to: 'ops@example.com, nobody' } });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'Could not read "nobody" as an email address. Separate addresses with commas, such as ops@example.com, it@example.com.',
      field: 'alerts.to',
    });
    expect(await db().select({ alertTo: settings.alertTo }).from(settings)).toEqual([{ alertTo: null }]);
  });

  it('sends a test alert to the saved addresses', async () => {
    await put({ alerts: { to: 'ops@example.com' } });
    const response = await test();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ to: 'ops@example.com' });
    expect(sent).toMatchObject([{ to: 'ops@example.com', subject: 'Spooldoc: test alert' }]);
    expect(sent[0]!.text).toContain('a run fails or ends with a warning');
  });

  it('says what to do when there is no address or the test alert fails', async () => {
    const none = await test();
    expect(none.status).toBe(400);
    expect((await none.json()).error).toBe('Could not send a test alert: no addresses are saved. Enter them under Alerts and save first.');

    await put({ alerts: { to: 'ops@example.com' } });
    await db().update(settings).set({ smtpHost: null });
    const failed = await test();
    expect(failed.status).toBe(502);
    expect((await failed.json()).error).toBe(NO_MAIL_SERVER);
  });

  it('shows the last send error with the next try', async () => {
    await put({ alerts: { to: 'ops@example.com' } });
    await db().update(settings).set({ alertError: 'Could not connect to the mail server.', alertErrorDetail: 'ECONNREFUSED', alertErrorAt: at(0) });
    const view = (await (await settingsRoute.GET(appRequest('/api/settings', { headers: auth }))).json()) as SettingsView;
    expect(view.alerts.error).toEqual({ message: 'Could not connect to the mail server.', detail: 'ECONNREFUSED', at: at(0).toISOString(), nextTryAt: at(5).toISOString() });
  });

  it('drops alerts left open from before when alerts are turned on again', async () => {
    await put({ alerts: { to: 'ops@example.com' } });
    await insertRun('failed', new Date());
    await checkAlerts(new Date());
    await put({ alerts: { to: '' } });
    await put({ alerts: { to: 'ops@example.com' } });
    expect(await db().select().from(alerts).where(eq(alerts.key, `run:${jobId}`))).toEqual([]);
  });
});
