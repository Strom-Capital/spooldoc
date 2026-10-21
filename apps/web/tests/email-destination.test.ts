import { eq } from 'drizzle-orm';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emailSpecSchema, emptySpec, type EmailSpec, type JobSpec } from '@/lib/job-spec';
import { destinations, jobs, jobVersions, runDeliveries, runs, settings } from '@/lib/server/db/schema';
import { addressList, addressProblems, composeEmail, emailSpecProblems, inlineHtml } from '@/lib/server/email-message';
import { mailErrorText, setMailSender, stopsSending, updateMail } from '@/lib/server/mail';
import { runJob } from '@/lib/server/runner';

import { resetTables } from './helpers/db';
import { FakeConnection, fixtureText, GOOD_PASSWORD, loadSample } from './helpers/fake-connection';
import { db, insertServer } from './helpers/fixtures';

const data = { pg: { email: 'buyer@example.com', invoiceNo: '260101', empty: '', contact: 'J. SMITH' }, splf: { name: 'SPDINVOICE' } };
const spec = (change: Partial<EmailSpec> = {}): EmailSpec => emailSpecSchema.parse({ to: '{d.pg.email}', ...change });
const pdf = { name: 'invoice-260101.pdf', contentType: 'application/pdf', content: new Uint8Array([37, 80, 68, 70]) };
const docx = { name: 'invoice-260101.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: new Uint8Array([80, 75]) };
const compose = (change: Partial<EmailSpec>, testAddress: string | null = null) =>
  composeEmail({ spec: spec(change), data, document: 'invoice-260101', files: [pdf, docx], from: 'invoices@example.com', testAddress });

/** What Nodemailer's JSON transport makes of a message: the message as it would be sent, without a network. */
async function asSent(message: SendMailOptions): Promise<{ subject: string; html: string; text: string; to: { address: string }[]; cc?: unknown; bcc?: unknown; attachments: { filename?: string; cid?: string; contentType: string }[] }> {
  const info = await nodemailer.createTransport({ jsonTransport: true }).sendMail(message);
  return JSON.parse(info.message as unknown as string);
}

describe('email fields', () => {
  it('fill in several addresses, mixing fields and fixed addresses', () => {
    expect(addressList('{d.pg.email}, orders@example.com; {d.splf.name}@example.com', data)).toEqual({
      addresses: ['buyer@example.com', 'orders@example.com', 'SPDINVOICE@example.com'],
      empty: [],
      missing: [],
      invalid: [],
    });
  });

  it('fail on an empty or missing field in To, and on text that is not an address', () => {
    expect(addressProblems(spec({ to: '{d.pg.empty}' }), data)).toEqual(['{d.pg.empty} is empty']);
    expect(addressProblems(spec({ to: '{d.pg.nope}, orders@example.com' }), data)).toEqual(['{d.pg.nope} is not in the data']);
    expect(addressProblems(spec({ to: '{d.pg.contact}' }), data)).toEqual(['"J. SMITH" in To is not an email address']);
    expect(addressProblems(spec({ to: '' }), data)).toEqual(['To has no address']);
    expect(compose({ to: '{d.pg.empty}' })).toEqual({ email: null, problems: ['{d.pg.empty} is empty'] });
  });

  it('leave out an empty Cc, Bcc or Reply-To', async () => {
    const { email } = compose({ cc: '{d.pg.empty}', bcc: '{d.pg.nope}', replyTo: '{d.pg.empty}' });
    const sent = await asSent(email!.message);
    expect(sent.to).toEqual([{ address: 'buyer@example.com', name: '' }]);
    expect(sent.cc).toBeUndefined();
    expect(sent.bcc).toBeUndefined();
  });

  it('flag tags that are not fields of the definition, and formats no template makes', () => {
    const def = { type: 'invoice', version: 1, source: 'text', text: { fields: [{ name: 'invoiceNo' }, { name: 'email' }] } } as never;
    const templates = [{ id: 'template-1', name: 'Invoice', kind: 'html', source: null, formats: ['pdf'] }] as never;
    expect(emailSpecProblems(spec({ subject: 'Invoice {d.pg.invoiceNumber}', attach: ['pdf', 'docx'] }), def, templates)).toEqual([
      'Subject: {d.pg.invoiceNumber} is not in the data. Did you mean {d.pg.invoiceNo}?',
      'Attach picks DOCX, which no template of the job makes.',
    ]);
  });
});

describe('composing an email', () => {
  it('attaches only the formats picked, and uses the document name when the subject is empty', async () => {
    const { email } = compose({ subject: '', attach: ['pdf'] });
    const sent = await asSent(email!.message);
    expect(sent.subject).toBe('invoice-260101');
    expect(sent.attachments.map((file) => file.filename)).toEqual(['invoice-260101.pdf']);
    expect(sent.text).toContain('Your document is attached.');
  });

  it('with a test address, sends only there, drops Cc and Bcc, and says where it would have gone', async () => {
    const { email } = compose({ cc: 'boss@example.com', bcc: 'archive@example.com', subject: 'Invoice {d.pg.invoiceNo}' }, 'you@example.com');
    expect(email!.to).toEqual(['buyer@example.com']);
    const sent = await asSent(email!.message);
    expect(sent.to).toEqual([{ address: 'you@example.com', name: '' }]);
    expect(sent.cc).toBeUndefined();
    expect(sent.bcc).toBeUndefined();
    expect(sent.subject).toBe('[Test] Invoice 260101');
    expect(sent.text.split('\n')[0]).toBe('Test email from Spooldoc. Without the test address it would go to buyer@example.com.');
    expect(sent.html).toContain('it would go to buyer@example.com');
  });

  it("inlines a template's CSS, and turns data URI images into inline CID attachments", async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const html = `<html><head><style>.total { color: #3159e8; font-weight: bold; }</style></head><body><img src="${png}" alt="Logo"><p class="total">302.66</p></body></html>`;
    expect(inlineHtml(html)).toContain('<p class="total" style="color: #3159e8; font-weight: bold;">');
    const { email } = composeEmail({ spec: spec({ bodyTemplateId: 'template-1' }), data, document: 'invoice-260101', files: [], from: 'invoices@example.com', testAddress: null, templateHtml: html });
    const sent = await asSent(email!.message);
    expect(sent.html).not.toContain('data:image');
    const image = sent.attachments.find((file) => file.contentType === 'image/png');
    expect(image?.cid).toBeTruthy();
    expect(sent.html).toContain(`cid:${image!.cid}`);
    expect(sent.text).toContain('302.66');
  });
});

describe('mail errors', () => {
  const server = { host: 'smtp.example.com', port: 587 };
  const error = (props: Record<string, unknown>) => Object.assign(new Error(String(props.message ?? 'failed')), props);

  it('say what went wrong and what to do next, and keep the server text as the detail', () => {
    expect(mailErrorText(error({ code: 'EAUTH', responseCode: 535, response: '535 5.7.8 Authentication credentials invalid' }), server)).toEqual({
      message: 'The mail server refused the sign-in. Check the user name and password in Settings, under Mail server, or use an app password.',
      detail: '535 5.7.8 Authentication credentials invalid',
    });
    expect(mailErrorText(error({ code: 'ESOCKET', message: 'connect ECONNREFUSED 127.0.0.1:587' }), server).message).toBe(
      'Could not connect to the mail server smtp.example.com:587. Check the host and port, and that a firewall lets the Spooldoc server reach it.',
    );
    expect(mailErrorText(error({ code: 'ETLS', message: 'wrong version number' }), server).message).toMatch(/^Could not set up a secure connection with smtp.example.com:587\. Port 465 usually takes TLS/);
    expect(mailErrorText(error({ responseCode: 552, response: '552 5.3.4 Message size exceeds fixed limit' }), server).message).toMatch(/^The email is too large/);
    expect(mailErrorText(error({ code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550, rejected: ['nobody@example.com'], response: '550 5.1.1 User unknown' }), server).message).toBe(
      "The mail server refused the address nobody@example.com. Check the address, or the job's To, Cc and Bcc.",
    );
  });

  it('stop the run sending more only for errors of the server or the connection', () => {
    expect(stopsSending(error({ code: 'EAUTH' }))).toBe(true);
    expect(stopsSending(error({ code: 'ECONNECTION' }))).toBe(true);
    expect(stopsSending(error({ code: 'EENVELOPE' }))).toBe(false);
  });
});

describe('the email destination in a run', () => {
  const sample = loadSample('invoice');
  let serverId: string;
  let sent: SendMailOptions[];
  /** Recipients the stand-in mail server refuses. */
  let refused: Set<string>;

  beforeEach(async () => {
    await resetTables(db());
    serverId = await insertServer();
    sent = [];
    refused = new Set();
    await updateMail({ host: 'smtp.example.com', port: 587, security: 'starttls', user: 'mailer', password: 'mail-Passw0rd', from: 'invoices@example.com', fromName: 'Example Co' });
    const json = nodemailer.createTransport({ jsonTransport: true });
    setMailSender(() => ({
      async sendMail(message) {
        const to = (message.to as string[])[0]!;
        if (refused.has(to)) throw Object.assign(new Error('Can not send mail'), { code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550, rejected: [to], response: '550 5.1.1 User unknown' });
        sent.push(message);
        return json.sendMail(message);
      },
    }));
  });

  afterEach(() => setMailSender(null));

  /** An invoice job with an active version that emails each invoice to `<customerNo>@example.com` and holds the file. */
  async function emailJob(testAddress: string | null = null): Promise<{ jobId: string; spec: JobSpec }> {
    const [destination] = await db().insert(destinations).values({ kind: 'email', name: 'Invoices by email', config: { testAddress } }).returning();
    const spec: JobSpec = {
      ...emptySpec({ serverId, library: 'MYLIB', queue: 'EMAIL', destinationId: destination!.id }),
      extract: { definition: fixtureText('invoice', 'definition.yaml') },
      destination: { destinationId: destination!.id, email: emailSpecSchema.parse({ to: '{d.pg.customerNo}@example.com', subject: 'Invoice {d.pg.invoiceNo}' }) },
    };
    const [job] = await db().insert(jobs).values({ name: 'Invoices', draft: spec, activeVersion: 1 }).returning();
    await db().insert(jobVersions).values({ jobId: job!.id, number: 1, spec });
    return { jobId: job!.id, spec };
  }

  const run = async (jobId: string, conn: FakeConnection) =>
    runJob({ jobId, version: 1, splf: sample.splf, trigger: 'manual' }, { conn, host: 'ibmi.example.com', serverId, password: GOOD_PASSWORD });

  it('sends one email per invoice with its PDF, records each, and then holds the file', async () => {
    const { jobId } = await emailJob();
    const conn = new FakeConnection();
    const runId = await run(jobId, conn);
    const [row] = await db().select().from(runs).where(eq(runs.id, runId));
    expect(row!.status).toBe('success');
    expect(sent).toHaveLength(6);
    expect(sent[0]).toMatchObject({ to: ['10001@example.com'], subject: 'Invoice 260101', from: { name: 'Example Co', address: 'invoices@example.com' } });
    expect((sent[0]!.attachments as { filename: string }[]).map((file) => file.filename)).toEqual(['invoice-260101.pdf']);
    expect(row!.steps.find((step) => step.step === 'deliver')?.note).toBe('Sent 6 emails');
    const deliveries = await db().select().from(runDeliveries).where(eq(runDeliveries.runId, runId));
    expect(deliveries.map((d) => d.status)).toEqual(Array(6).fill('sent'));
    expect(conn.actions()).toEqual(['holdSpooledFile']);
  });

  it('fails the run when one email fails, leaves the file alone, and Retry sends only that one', async () => {
    const { jobId } = await emailJob();
    refused.add('10003@example.com');
    const conn = new FakeConnection();
    const first = await run(jobId, conn);
    const [failed] = await db().select().from(runs).where(eq(runs.id, first));
    expect(failed!.status).toBe('failed');
    expect(failed!.error).toBe(
      "Sent 5 of 6 emails. invoice-260102: The mail server refused the address 10003@example.com. Check the address, or the job's To, Cc and Bcc.",
    );
    expect(failed!.steps.find((step) => step.step === 'deliver')?.detail).toBe('550 5.1.1 User unknown');
    expect(failed!.steps.some((step) => step.step === 'finish')).toBe(false);
    expect(conn.actions()).toEqual([]);
    expect(sent).toHaveLength(5);

    refused.clear();
    sent = [];
    const second = await run(jobId, conn);
    const [retried] = await db().select().from(runs).where(eq(runs.id, second));
    expect(retried!.status).toBe('success');
    expect(sent.map((message) => message.to)).toEqual([['10003@example.com']]);
    expect(retried!.steps.find((step) => step.step === 'deliver')?.note).toBe(`Sent 1 email, 5 were sent in run #${failed!.seq}`);
    const deliveries = await db().select().from(runDeliveries).where(eq(runDeliveries.runId, second));
    expect(deliveries.filter((d) => d.status === 'already_sent')).toHaveLength(5);
    expect(conn.actions()).toEqual(['holdSpooledFile']);
  });

  it('never counts a test send as sent, so taking the test address out sends every email again', async () => {
    const { jobId } = await emailJob('you@example.com');
    const conn = new FakeConnection();
    await run(jobId, conn);
    expect(sent.map((message) => message.to)).toEqual(Array(6).fill(['you@example.com']));
    expect(sent[0]!.subject).toBe('[Test] Invoice 260101');

    await db().update(destinations).set({ config: { testAddress: null } }).where(eq(destinations.kind, 'email'));
    sent = [];
    await run(jobId, conn);
    expect(sent.map((message) => message.to)).toEqual(['10001', '10003', '10002', '10004', '10008', '10006'].map((n) => [`${n}@example.com`]));
  });

  it('fails before sending when no mail server is set', async () => {
    const { jobId } = await emailJob();
    await updateMail({ host: '', port: null, security: 'starttls', user: '', password: null, from: '', fromName: '' });
    const conn = new FakeConnection();
    const runId = await run(jobId, conn);
    const [row] = await db().select().from(runs).where(eq(runs.id, runId));
    expect(row!.error).toBe('No mail server is set. Set one in Settings, under Mail server.');
    expect(sent).toHaveLength(0);
    expect(conn.actions()).toEqual([]);
  });

  it('stores the mail server password encrypted and keeps it out of the errors', async () => {
    const { jobId } = await emailJob();
    setMailSender(() => ({
      async sendMail() {
        throw Object.assign(new Error('Invalid login for mailer with mail-Passw0rd'), { code: 'EAUTH', response: '535 bad mail-Passw0rd' });
      },
    }));
    const runId = await run(jobId, new FakeConnection());
    const [row] = await db().select().from(runs).where(eq(runs.id, runId));
    expect(JSON.stringify(row)).not.toContain('mail-Passw0rd');
    const deliveries = await db().select().from(runDeliveries).where(eq(runDeliveries.runId, runId));
    expect(JSON.stringify(deliveries)).not.toContain('mail-Passw0rd');
    expect(deliveries[0]?.detail).toBe('535 bad ***');
    const [saved] = await db().select({ enc: settings.smtpPasswordEnc }).from(settings);
    expect(saved?.enc).not.toContain('mail-Passw0rd');
  });
});
