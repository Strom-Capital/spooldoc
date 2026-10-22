import { createServer, type AddressInfo, type Socket } from 'node:net';
import { eq } from 'drizzle-orm';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emailSpecSchema, emptySpec, splfKey as splfKeyOf, type EmailSpec, type JobSpec } from '@/lib/job-spec';
import { destinations, jobs, jobVersions, runDeliveries, runs, settings } from '@/lib/server/db/schema';
import { setEmailLockWait } from '@/lib/server/destinations/email';
import { addressList, addressProblems, composeEmail, emailSpecProblems, htmlToText, inlineHtml } from '@/lib/server/email-message';
import { mailErrorText, mailSender, setMailSender, stopsSending, updateMail, type SmtpServer } from '@/lib/server/mail';
import { runJob } from '@/lib/server/runner';
import { runViews } from '@/lib/server/runs';

import { resetTables } from './helpers/db';
import { FakeConnection, fixtureText, GOOD_PASSWORD, loadSample } from './helpers/fake-connection';
import { db, insertServer, testDb } from './helpers/fixtures';

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

describe('the plain text of an HTML body', () => {
  it('shows escaped text as it reads, and drops styles and images', () => {
    const html =
      '<html><head><style>.note { color: red; }</style></head><body><h1>Invoice 260101</h1><p class="note">Write &lt;script&gt; as text.</p><img src="data:image/png;base64,iVBORw0KGgo=" alt="Logo"><table><tr><th>Item</th><th>Amount</th></tr><tr><td>A-1001</td><td>29.40</td></tr></table></body></html>';
    const text = htmlToText(html);
    expect(text).toContain('Write <script> as text.');
    expect(text).not.toContain('color: red');
    expect(text).not.toContain('.note');
    expect(text).not.toContain('data:image');
    expect(text).toContain('Invoice 260101');
    expect(text).toMatch(/A-1001\s+29\.40/);
  });
});

describe('mail errors', () => {
  const server: SmtpServer = { sender: 'smtp', host: 'smtp.example.com', port: 587, security: 'starttls', user: null, password: null, from: 'invoices@example.com', fromName: null };
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

describe('the SMTP sender', () => {
  /** A small SMTP server on localhost that counts its connections and refuses one recipient. */
  async function smtpServer(refuse: string): Promise<{ port: number; connections: () => number; close: () => Promise<void> }> {
    let connections = 0;
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      connections++;
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      let data = false;
      let buffer = '';
      socket.write('220 smtp.example.com ESMTP\r\n');
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let end: number;
        while ((end = buffer.indexOf('\r\n')) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (data) {
            if (line === '.') {
              data = false;
              socket.write('250 2.0.0 Queued\r\n');
            }
            continue;
          }
          const command = line.toUpperCase();
          if (command.startsWith('EHLO')) socket.write('250-smtp.example.com\r\n250 8BITMIME\r\n');
          else if (command.startsWith('RCPT') && line.includes(refuse)) socket.write('550 5.1.1 User unknown\r\n');
          else if (command === 'DATA') {
            data = true;
            socket.write('354 Go ahead\r\n');
          } else if (command === 'QUIT') socket.end('221 Bye\r\n');
          else socket.write('250 OK\r\n');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
      port: (server.address() as AddressInfo).port,
      connections: () => connections,
      close: async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  }

  it('sends every email of a run over one connection, and a refused recipient does not fail the emails after it', async () => {
    const smtp = await smtpServer('nobody@example.com');
    const sender = mailSender({ sender: 'smtp', host: '127.0.0.1', port: smtp.port, security: 'none', user: null, password: null, from: 'invoices@example.com', fromName: null });
    const message = (to: string) => ({ from: 'invoices@example.com', to, subject: 'Invoice', text: 'Your document is attached.' });
    try {
      await sender.sendMail(message('buyer@example.com'));
      const refused = await sender.sendMail(message('nobody@example.com')).catch((error: unknown) => error);
      expect(refused).toMatchObject({ code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO' });
      expect(stopsSending(refused)).toBe(false);
      await sender.sendMail(message('orders@example.com'));
      expect(smtp.connections()).toBe(1);
    } finally {
      sender.close?.();
      await smtp.close();
    }
  });
});

describe('the email destination in a run', () => {
  const sample = loadSample('invoice');
  let serverId: string;
  let sent: SendMailOptions[];
  /** Recipients the stand-in mail server refuses. */
  let refused: Set<string>;
  /** How long the stand-in mail server takes to take each email. */
  let delayMs: number;

  beforeEach(async () => {
    await resetTables(db());
    serverId = await insertServer();
    sent = [];
    refused = new Set();
    delayMs = 0;
    await updateMail({ host: 'smtp.example.com', port: 587, security: 'starttls', user: 'mailer', password: 'mail-Passw0rd', from: 'invoices@example.com', fromName: 'Example Co' });
    const json = nodemailer.createTransport({ jsonTransport: true });
    setMailSender(() => ({
      async sendMail(message) {
        const to = (message.to as string[])[0]!;
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (refused.has(to)) throw Object.assign(new Error('Can not send mail'), { code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550, rejected: [to], response: '550 5.1.1 User unknown' });
        sent.push(message);
        return json.sendMail(message);
      },
    }));
  });

  afterEach(() => {
    setMailSender(null);
    setEmailLockWait(null);
  });

  /** An invoice job with an active version that emails each invoice to `<customerNo>@example.com` and holds the file. */
  async function emailJob(
    testAddress: string | null = null,
    change: { definition?: string; templates?: JobSpec['render']['templates']; to?: string; attach?: EmailSpec['attach'] } = {},
  ): Promise<{ jobId: string; spec: JobSpec }> {
    const [destination] = await db().insert(destinations).values({ kind: 'email', name: 'Invoices by email', config: { testAddress } }).returning();
    const base = emptySpec({ serverId, library: 'MYLIB', queue: 'EMAIL', destinationId: destination!.id });
    const email = emailSpecSchema.parse({ to: change.to ?? '{d.pg.customerNo}@example.com', subject: 'Invoice {d.pg.invoiceNo}', ...(change.attach ? { attach: change.attach } : {}) });
    const spec: JobSpec = {
      ...base,
      extract: { definition: change.definition ?? fixtureText('invoice', 'definition.yaml') },
      render: change.templates ? { templates: change.templates } : base.render,
      destination: { destinationId: destination!.id, email, webhook: null },
    };
    const [job] = await db().insert(jobs).values({ name: 'Invoices', draft: spec, activeVersion: 1 }).returning();
    await db().insert(jobVersions).values({ jobId: job!.id, number: 1, spec });
    return { jobId: job!.id, spec };
  }

  const run = async (jobId: string, conn: FakeConnection, version = 1) =>
    runJob({ jobId, version, splf: sample.splf, trigger: 'manual' }, { conn, host: 'ibmi.example.com', serverId, password: GOOD_PASSWORD });

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

  it('records each email as a delivery of kind email, and the run view says so', async () => {
    const { jobId } = await emailJob();
    const runId = await run(jobId, new FakeConnection());
    const deliveries = await db().select().from(runDeliveries).where(eq(runDeliveries.runId, runId));
    expect(deliveries.map((d) => d.kind)).toEqual(Array(6).fill('email'));
    const [row] = await db().select().from(runs).where(eq(runs.id, runId));
    const [view] = await runViews([row!]);
    expect(view!.deliveryKind).toBe('email');
    expect(view!.deliveries.map((d) => d.kind)).toEqual(Array(6).fill('email'));
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

  /** The invoice spooled file of the connection, to change its attributes as a later one would have them. */
  const invoiceFile = (conn: FakeConnection) => conn.samples.find((s) => s.splf.name === sample.splf.name)!;
  const deliverNote = async (runId: string) => {
    const [row] = await db().select().from(runs).where(eq(runs.id, runId));
    return row!.steps.find((step) => step.step === 'deliver')?.note;
  };

  it('sends every email to the test address, even the ones a real run sent, and a later real run still skips those', async () => {
    const { jobId } = await emailJob();
    const conn = new FakeConnection();
    const first = await run(jobId, conn);
    expect(sent).toHaveLength(6);

    await db().update(destinations).set({ config: { testAddress: 'you@example.com' } }).where(eq(destinations.kind, 'email'));
    sent = [];
    const test = await run(jobId, conn);
    expect(sent.map((message) => message.to)).toEqual(Array(6).fill(['you@example.com']));
    expect(await deliverNote(test)).toBe('Sent 6 emails to the test address you@example.com');
    const deliveries = await db().select().from(runDeliveries).where(eq(runDeliveries.runId, test));
    expect(deliveries.map((d) => [d.status, d.test])).toEqual(Array(6).fill(['sent', true]));

    await db().update(destinations).set({ config: { testAddress: null } }).where(eq(destinations.kind, 'email'));
    sent = [];
    const [firstRun] = await db().select().from(runs).where(eq(runs.id, first));
    const last = await run(jobId, conn);
    expect(sent).toHaveLength(0);
    expect(await deliverNote(last)).toBe(`Sent 0 emails, 6 were sent in run #${firstRun!.seq}`);
  });

  it('sends each email once when two runs of the job deliver the same spooled file at the same time', async () => {
    const { jobId } = await emailJob();
    setEmailLockWait({ limitMs: 30_000, pollMs: 10 });
    delayMs = 5;
    const conn = new FakeConnection();
    const [one, two] = await Promise.all([run(jobId, conn), run(jobId, conn)]);
    expect(sent.map((message) => message.to)).toEqual(['10001', '10003', '10002', '10004', '10008', '10006'].map((n) => [`${n}@example.com`]));
    const statuses = async (runId: string) => (await db().select().from(runDeliveries).where(eq(runDeliveries.runId, runId))).map((d) => d.status);
    expect([await statuses(one), await statuses(two)]).toContainEqual(Array(6).fill('sent'));
    expect([await statuses(one), await statuses(two)]).toContainEqual(Array(6).fill('already_sent'));
  });

  it('fails the deliver step, sending nothing, when another run keeps sending email for the spooled file too long', async () => {
    const { jobId } = await emailJob();
    setEmailLockWait({ limitMs: 30, pollMs: 10 });
    const release = await testDb().locks.tryLock(`email:${jobId}:${splfKeyOf(sample.splf)}`);
    try {
      const conn = new FakeConnection();
      const runId = await run(jobId, conn);
      const [row] = await db().select().from(runs).where(eq(runs.id, runId));
      expect(row!.status).toBe('failed');
      expect(row!.error).toBe('Another run of this job is sending email for this spooled file. Retry when it has finished.');
      expect(sent).toHaveLength(0);
      expect(conn.actions()).toEqual([]);
    } finally {
      await release?.();
    }
  });

  it('records the creation time and pages of each email, and a plain Retry sends none again', async () => {
    const { jobId } = await emailJob();
    const conn = new FakeConnection();
    const first = await run(jobId, conn);
    const deliveries = await db().select().from(runDeliveries).where(eq(runDeliveries.runId, first));
    expect(deliveries[0]).toMatchObject({ document: 'invoice-260101', splfCreated: sample.attributes.created, firstPage: 1, lastPage: 1 });
    expect(deliveries.every((d) => d.firstPage !== null && d.lastPage !== null)).toBe(true);

    sent = [];
    const [firstRun] = await db().select().from(runs).where(eq(runs.id, first));
    const second = await run(jobId, conn);
    expect(sent).toHaveLength(0);
    expect(await deliverNote(second)).toBe(`Sent 0 emails, 6 were sent in run #${firstRun!.seq}`);
  });

  it('sends again to a new spooled file that has the same job number, name and number, but another creation time', async () => {
    const { jobId } = await emailJob();
    const conn = new FakeConnection();
    await run(jobId, conn);
    const file = invoiceFile(conn);
    file.attributes = { ...file.attributes, created: '2026-10-18T08:15:00' };
    sent = [];
    const second = await run(jobId, conn);
    expect(sent).toHaveLength(6);
    expect(await deliverNote(second)).toBe('Sent 6 emails');
  });

  it('sends again when a newer job version groups the pages another way, even where the names are the same', async () => {
    // Without an output name, the documents are named spdinvoice-1, spdinvoice-2 and so on.
    const definition = fixtureText('invoice', 'definition.yaml').replace(/^output:[\s\S]*$/m, '');
    const { jobId, spec: first } = await emailJob(null, { definition });
    const conn = new FakeConnection();
    await run(jobId, conn);
    expect(sent).toHaveLength(6);

    // Skipping the first page moves every page group, so spdinvoice-1 is now another invoice.
    const regrouped = definition.replace(/^text:\n/m, 'text:\n  skipFirstPage: true\n');
    await db().insert(jobVersions).values({ jobId, number: 2, spec: { ...first, extract: { definition: regrouped } } });
    sent = [];
    const second = await run(jobId, conn, 2);
    const deliveries = await db().select().from(runDeliveries).where(eq(runDeliveries.runId, second));
    expect(deliveries.length).toBeGreaterThan(0);
    expect(deliveries.map((d) => d.status)).toEqual(Array(deliveries.length).fill('sent'));
    expect(deliveries[0]).toMatchObject({ document: 'spdinvoice-1', firstPage: 2 });
    expect(sent).toHaveLength(deliveries.length);
  });

  it('still skips by name what a run before the creation time was recorded sent', async () => {
    const { jobId } = await emailJob();
    const conn = new FakeConnection();
    await run(jobId, conn);
    await db().update(runDeliveries).set({ splfCreated: null, firstPage: null, lastPage: null });
    const file = invoiceFile(conn);
    file.attributes = { ...file.attributes, created: '' };
    sent = [];
    const second = await run(jobId, conn);
    expect(sent).toHaveLength(0);
    const deliveries = await db().select().from(runDeliveries).where(eq(runDeliveries.runId, second));
    expect(deliveries.map((d) => d.status)).toEqual(Array(6).fill('already_sent'));
  });

  it('sends again what a row from before the spooled file was created sent, as it was for an earlier spooled file', async () => {
    const { jobId } = await emailJob();
    const conn = new FakeConnection();
    await run(jobId, conn);
    // The invoice sample was created 2026-10-17T21:40:38; these rows are from two days before.
    await db().update(runDeliveries).set({ splfCreated: null, firstPage: null, lastPage: null, sentAt: new Date('2026-10-15T12:00:00Z') });
    sent = [];
    const second = await run(jobId, conn);
    expect(sent).toHaveLength(6);
    expect(await deliverNote(second)).toBe('Sent 6 emails');
  });

  describe('with an Excel template of the whole spooled file', () => {
    const templates = [
      { id: 'main', name: 'Invoice', kind: 'html', source: null, formats: ['pdf'] },
      { id: 'lines', name: 'Lines', kind: 'xlsx', fileId: null, scope: 'splf', formats: ['xlsx'] },
    ] as JobSpec['render']['templates'];
    const attachedNames = () => sent.map((message) => ((message.attachments ?? []) as { filename: string }[]).map((file) => file.filename));

    it('sends only the email of the whole spooled file when Attach picks only its files', async () => {
      const { jobId } = await emailJob(null, { templates, to: 'orders@example.com', attach: ['xlsx'] });
      const runId = await run(jobId, new FakeConnection());
      expect(attachedNames()).toEqual([['spdinvoice-lines.xlsx']]);
      expect(await deliverNote(runId)).toBe('Sent 1 email');
    });

    it('sends one email per page group, with nothing attached, when Attach is empty', async () => {
      const { jobId } = await emailJob(null, { templates, to: 'orders@example.com', attach: [] });
      await run(jobId, new FakeConnection());
      expect(attachedNames()).toEqual(Array(6).fill([]));
    });

    it('sends an email per page group and one of the whole spooled file when Attach picks files of both', async () => {
      const { jobId } = await emailJob(null, { templates, to: 'orders@example.com', attach: ['pdf', 'xlsx'] });
      await run(jobId, new FakeConnection());
      expect(attachedNames()).toHaveLength(7);
      expect(attachedNames()[0]).toEqual(['invoice-260101.pdf']);
      expect(attachedNames().at(-1)).toEqual(['spdinvoice-lines.xlsx']);
    });
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
