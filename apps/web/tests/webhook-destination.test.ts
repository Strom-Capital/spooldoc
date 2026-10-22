import { eq } from 'drizzle-orm';
import { Webhook } from 'standardwebhooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySpec, type JobSpec } from '@/lib/job-spec';
import { destinations, jobs, jobVersions, runDeliveries, runs } from '@/lib/server/db/schema';
import { sealWebhookSecrets, webhookTiming } from '@/lib/server/destinations/webhook';
import { runJob } from '@/lib/server/runner';
import { runViews } from '@/lib/server/runs';
import { storeSample } from '@/lib/server/samples';
import { newSigningSecret, type WebhookPayload } from '@/lib/server/webhook-payload';
import type { WebhookPreviewView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { resetTables } from './helpers/db';
import { FakeConnection, fixtureText, GOOD_PASSWORD, loadSample } from './helpers/fake-connection';
import { db, insertServer } from './helpers/fixtures';
import { appRequest, params } from './helpers/mocks';

const previewRoute = await import('@/app/api/jobs/[id]/webhook-preview/route');

const URL_IN_USE = 'https://hooks.example.com/spooldoc?token=Query-Token-123';
const TEST_URL = 'https://inspect.example.com/abc';
const HEADER_VALUE = 'Bearer Header-Secret-456';

interface Call {
  url: string;
  headers: Record<string, string>;
  body: string;
  redirect: RequestRedirect | undefined;
}

/** A receiver in place of `fetch`. `answer` answers each call; by default 200 with a short JSON. */
function fakeReceiver() {
  const calls: Call[] = [];
  const state: { answer: (call: Call, n: number) => Response | Promise<Response> } = {
    answer: () => Response.json({ received: true }),
  };
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(input), headers: Object.fromEntries(new Headers(init.headers).entries()), body: String(init.body), redirect: init.redirect };
    calls.push(call);
    return state.answer(call, calls.length);
  });
  vi.stubGlobal('fetch', fetch);
  return { calls, state, payloads: () => calls.map((call) => JSON.parse(call.body) as WebhookPayload) };
}

/** A network failure as Node's fetch throws it. */
const networkError = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(`connect ${code} 203.0.113.9:443`), { code }) });

const realSleep = webhookTiming.sleep;
let waits: number[];
let receiver: ReturnType<typeof fakeReceiver>;

beforeEach(() => {
  receiver = fakeReceiver();
  waits = [];
  webhookTiming.sleep = async (wait) => void waits.push(wait);
});

afterEach(() => {
  vi.unstubAllGlobals();
  webhookTiming.sleep = realSleep;
});

describe('the webhook destination', () => {
  const sample = loadSample('invoice');
  let serverId: string;
  let secret: string;

  beforeEach(async () => {
    await resetTables(db());
    serverId = await insertServer();
    secret = newSigningSecret();
  });

  /** An invoice job with an active version that posts each invoice, as PDF, to MYHOOK. */
  async function webhookJob(testUrl: string | null = null, webhook: JobSpec['destination']['webhook'] = null): Promise<{ jobId: string; spec: JobSpec }> {
    const [destination] = await db()
      .insert(destinations)
      .values({
        kind: 'webhook',
        name: 'MYHOOK',
        config: { url: URL_IN_USE, testUrl },
        secretsEnc: sealWebhookSecrets({ signingSecret: secret, headers: [{ name: 'Authorization', value: HEADER_VALUE }] }),
      })
      .returning();
    const base = emptySpec({ serverId, library: 'MYLIB', queue: 'MYOUTQ', destinationId: destination!.id });
    const spec: JobSpec = { ...base, extract: { definition: fixtureText('invoice', 'definition.yaml') }, destination: { ...base.destination, webhook } };
    const [job] = await db().insert(jobs).values({ name: 'MYJOB', draft: spec, activeVersion: 1 }).returning();
    await db().insert(jobVersions).values({ jobId: job!.id, number: 1, spec });
    return { jobId: job!.id, spec };
  }

  const run = async (jobId: string, conn = new FakeConnection()) =>
    runJob({ jobId, version: 1, splf: sample.splf, trigger: 'manual' }, { conn, host: 'ibmi.example.com', serverId, password: GOOD_PASSWORD });
  const runRow = async (id: string) => (await db().select().from(runs).where(eq(runs.id, id)))[0]!;
  const deliveriesOf = (runId: string) => db().select().from(runDeliveries).where(eq(runDeliveries.runId, runId)).orderBy(runDeliveries.sentAt);

  it('posts one signed call per invoice with its data and PDF, records each, and then holds the file', async () => {
    const { jobId } = await webhookJob();
    const conn = new FakeConnection();
    const runId = await run(jobId, conn);
    const row = await runRow(runId);
    expect(row.status).toBe('success');
    expect(row.steps.find((step) => step.step === 'deliver')?.note).toBe('Sent 6 documents to hooks.example.com');
    expect(receiver.calls).toHaveLength(6);

    // Each signature checks out with the Standard Webhooks library, as a receiver checks it.
    const verifier = new Webhook(secret);
    for (const call of receiver.calls) {
      expect(call.url).toBe(URL_IN_USE);
      expect(call.redirect).toBe('manual');
      expect(call.headers).toMatchObject({ 'content-type': 'application/json', authorization: HEADER_VALUE });
      expect(call.headers['user-agent']).toMatch(/^Spooldoc\/\d+\.\d+\.\d+/);
      expect(() => verifier.verify(call.body, call.headers)).not.toThrow();
    }
    expect(() => new Webhook(newSigningSecret()).verify(receiver.calls[0]!.body, receiver.calls[0]!.headers)).toThrow();

    const [first] = receiver.payloads();
    expect(first).toMatchObject({
      type: 'document.created',
      timestamp: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/),
      data: {
        document: { name: 'invoice-260101', pageGroup: 1, pageGroups: 6 },
        job: { id: jobId, name: 'MYJOB', version: 1 },
        run: { id: runId, number: row.seq },
        spooledFile: { name: sample.splf.name, number: sample.splf.number, outputQueue: `${sample.attributes.queue.library}/${sample.attributes.queue.name}`, pages: sample.attributes.pages },
        data: { pg: { invoiceNo: '260101' }, splf: sample.splf },
        files: [{ name: 'invoice-260101.pdf', contentType: 'application/pdf', template: 'Template 1' }],
      },
    });
    const file = first!.data.files[0]!;
    expect(Buffer.from(file.content, 'base64').byteLength).toBe(file.size);

    const deliveries = await deliveriesOf(runId);
    expect(deliveries.map((d) => [d.kind, d.status, d.httpStatus, d.attempts, d.test])).toEqual(Array(6).fill(['webhook', 'sent', 200, 1, false]));
    // The URL is stored without its query string, which can hold a token.
    expect(deliveries[0]!.to).toBe('https://hooks.example.com/spooldoc');
    expect(deliveries[0]!.response).toBe('{"received":true}');
    const [view] = await runViews([row]);
    expect(view!.deliveryKind).toBe('webhook');
    expect(view!.deliveries[0]).toMatchObject({ kind: 'webhook', httpStatus: 200, attempts: 1, response: '{"received":true}', responseTruncated: false });
    expect(conn.actions()).toEqual(['holdSpooledFile']);
  });

  it('sends the data only when the job picks no files', async () => {
    const { jobId } = await webhookJob(null, { attach: [] });
    await run(jobId);
    expect(receiver.payloads().map((payload) => payload.data.files)).toEqual(Array(6).fill([]));
  });

  it('tries a 503 again after 2 seconds, and a Retry-After as asked', async () => {
    const { jobId } = await webhookJob();
    receiver.state.answer = (_, n) =>
      n === 1 ? new Response('busy', { status: 503 }) : n === 3 ? new Response('slow down', { status: 429, headers: { 'retry-after': '7' } }) : Response.json({ ok: true });
    const runId = await run(jobId);
    expect((await runRow(runId)).status).toBe('success');
    expect(waits).toEqual([2_000, 7_000]);
    const deliveries = await deliveriesOf(runId);
    expect(deliveries.map((d) => d.attempts)).toEqual([2, 2, 1, 1, 1, 1]);
  });

  it('fails after 3 tries of a 5xx, and does not try a 400 again, with the answer in the detail', async () => {
    const { jobId } = await webhookJob();
    receiver.state.answer = (call) => {
      const invoice = (JSON.parse(call.body) as WebhookPayload).data.document.name;
      if (invoice === 'invoice-260102') return new Response('{"error":"invoiceNo 260102 is a duplicate"}', { status: 400, statusText: 'Bad Request' });
      if (invoice === 'invoice-260103') return new Response('down', { status: 502, statusText: 'Bad Gateway' });
      return Response.json({ ok: true });
    };
    const conn = new FakeConnection();
    const runId = await run(jobId, conn);
    const row = await runRow(runId);
    expect(row.status).toBe('failed');
    expect(row.error).toBe(
      'Sent 4 of 6 documents to hooks.example.com. invoice-260102: hooks.example.com refused the call (400 Bad Request). Its answer is under Details. 1 more failed; the Webhook calls list of the run has each one.',
    );
    expect(row.steps.find((step) => step.step === 'deliver')?.detail).toBe('{"error":"invoiceNo 260102 is a duplicate"}');
    const deliveries = await deliveriesOf(runId);
    const byName = new Map(deliveries.map((d) => [d.document, d]));
    expect(byName.get('invoice-260102')).toMatchObject({ status: 'failed', httpStatus: 400, attempts: 1 });
    expect(byName.get('invoice-260103')).toMatchObject({
      status: 'failed',
      httpStatus: 502,
      attempts: 3,
      error: 'hooks.example.com had a problem and did not take the call (502 Bad Gateway) after 3 tries. Retry the run later.',
    });
    expect(conn.actions()).toEqual([]);
  });

  it('stops trying once the host refuses the connection, and records the rest as not sent', async () => {
    const { jobId } = await webhookJob();
    receiver.state.answer = () => {
      throw networkError('ECONNREFUSED');
    };
    const runId = await run(jobId);
    // Three tries of the first document, none of the rest.
    expect(receiver.calls).toHaveLength(3);
    const row = await runRow(runId);
    expect(row.error).toMatch(/^Sent 0 of 6 documents to hooks\.example\.com\. invoice-260101: Could not connect to hooks\.example\.com on port 443: the connection was refused\./);
    const deliveries = await deliveriesOf(runId);
    expect(deliveries.map((d) => d.status)).toEqual(Array(6).fill('failed'));
    expect(deliveries[1]!.error).toMatch(/^Not sent: Could not connect to hooks\.example\.com/);
    expect(deliveries[1]!.attempts).toBe(0);
  });

  it('says what to check for a host it cannot find, a timeout and a certificate it does not trust', async () => {
    const { jobId } = await webhookJob();
    const errorFor = async (failure: unknown) => {
      receiver.state.answer = () => {
        throw failure;
      };
      return (await runRow(await run(jobId))).error;
    };
    expect(await errorFor(networkError('ENOTFOUND'))).toContain('invoice-260101: Could not find the host hooks.example.com. Check the URL of MYHOOK.');
    expect(await errorFor(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toContain('hooks.example.com did not answer within 30 seconds.');
    expect(await errorFor(networkError('UNABLE_TO_VERIFY_LEAF_SIGNATURE'))).toContain(
      'Could not connect securely to hooks.example.com: its certificate is signed by an authority Spooldoc does not know.',
    );
  });

  it('on Retry, sends only what failed, with the same webhook-id', async () => {
    const { jobId } = await webhookJob();
    receiver.state.answer = (call) =>
      (JSON.parse(call.body) as WebhookPayload).data.document.name === 'invoice-260103' ? new Response('no', { status: 422, statusText: 'Unprocessable Entity' }) : Response.json({});
    const first = await run(jobId);
    const failedRow = await runRow(first);
    expect(failedRow.status).toBe('failed');
    const firstId = receiver.calls.find((call) => call.body.includes('"invoice-260103"'))!.headers['webhook-id'];
    expect(firstId).toMatch(/^msg_[0-9a-f]{32}$/);

    receiver.state.answer = () => Response.json({});
    const before = receiver.calls.length;
    const conn = new FakeConnection();
    const second = await run(jobId, conn);
    const retried = await runRow(second);
    expect(retried.status).toBe('success');
    const again = receiver.calls.slice(before);
    expect(again).toHaveLength(1);
    expect(again[0]!.headers['webhook-id']).toBe(firstId);
    expect(retried.steps.find((step) => step.step === 'deliver')?.note).toBe(`Sent 1 document to hooks.example.com, 5 were sent in run #${failedRow.seq}`);
    const deliveries = await deliveriesOf(second);
    expect(deliveries.filter((d) => d.status === 'already_sent')).toHaveLength(5);
    expect(conn.actions()).toEqual(['holdSpooledFile']);
  });

  it('keeps the secret and the header values out of the errors and the stored answer', async () => {
    const { jobId } = await webhookJob();
    receiver.state.answer = (call) => new Response(`Refused ${call.headers.authorization} for ${secret}`, { status: 401, statusText: 'Unauthorized' });
    const runId = await run(jobId);
    const row = await runRow(runId);
    expect(row.error).toContain('hooks.example.com refused the call (401 Unauthorized). Check the headers of MYHOOK.');
    const deliveries = await deliveriesOf(runId);
    expect(deliveries[0]!.detail).toBe('Refused *** for ***');
    const stored = JSON.stringify([row, deliveries]);
    expect(stored).not.toContain(HEADER_VALUE);
    expect(stored).not.toContain(secret);
    expect(stored).not.toContain('Query-Token-123');
  });

  it('does not follow a redirect, names where it points, and stops the rest', async () => {
    const { jobId } = await webhookJob();
    receiver.state.answer = () => new Response(null, { status: 301, statusText: 'Moved Permanently', headers: { location: 'https://new.example.com/hook?key=abc' } });
    const runId = await run(jobId);
    expect(receiver.calls).toHaveLength(1);
    expect((await runRow(runId)).error).toContain(
      'Could not send to hooks.example.com: it answered 301 Moved Permanently and points to https://new.example.com/hook. Spooldoc does not follow redirects. Change the URL of MYHOOK to the address the receiver takes.',
    );
    const deliveries = await deliveriesOf(runId);
    expect(deliveries.slice(1).map((d) => d.error)).toEqual(Array(5).fill(expect.stringMatching(/^Not sent: Could not send to hooks\.example\.com: it answered 301/)));
  });

  it('fails the call, without throwing, on a redirect to a Location that is not a URL', async () => {
    const { jobId } = await webhookJob();
    receiver.state.answer = () => new Response(null, { status: 302, statusText: 'Found', headers: { location: 'http://[::1/hook?key=abc' } });
    const runId = await run(jobId);
    const row = await runRow(runId);
    expect(row.status).toBe('failed');
    expect(row.error).toContain('Could not send to hooks.example.com: it answered 302 Found and points to http://[::1/hook. Spooldoc does not follow redirects.');
    expect(row.error).not.toContain('key=abc');
    const deliveries = await deliveriesOf(runId);
    expect(deliveries.map((d) => d.status)).toEqual(Array(6).fill('failed'));
    expect(deliveries[0]).toMatchObject({ httpStatus: 302, attempts: 1 });
  });

  it.each([
    [401, 'Unauthorized', 'hooks.example.com refused the call (401 Unauthorized). Check the headers of MYHOOK.'],
    [404, 'Not Found', 'hooks.example.com has nothing that takes the call at /spooldoc (404 Not Found). Check the URL of MYHOOK.'],
  ])('stops the rest after a %i, as every call would get it', async (status, statusText, message) => {
    const { jobId } = await webhookJob();
    receiver.state.answer = () => new Response('no', { status, statusText });
    const runId = await run(jobId);
    expect(receiver.calls).toHaveLength(1);
    const row = await runRow(runId);
    expect(row.error).toBe(`Sent 0 of 6 documents to hooks.example.com. invoice-260101: ${message} 5 more failed; the Webhook calls list of the run has each one.`);
    const deliveries = await deliveriesOf(runId);
    expect(deliveries.slice(1).map((d) => [d.status, d.error, d.attempts])).toEqual(Array(5).fill(['failed', `Not sent: ${message}`, 0]));
  });

  it('tries a 408 again, and says the receiver timed out', async () => {
    const { jobId } = await webhookJob();
    receiver.state.answer = (call) =>
      (JSON.parse(call.body) as WebhookPayload).data.document.name === 'invoice-260101' ? new Response('', { status: 408, statusText: 'Request Timeout' }) : Response.json({});
    const runId = await run(jobId);
    const deliveries = await deliveriesOf(runId);
    expect(deliveries[0]).toMatchObject({
      status: 'failed',
      attempts: 3,
      error: 'hooks.example.com timed out waiting for the call (408 Request Timeout) after 3 tries. Retry the run later.',
    });
    // A 408 does not stop the rest.
    expect(deliveries.slice(1).map((d) => d.status)).toEqual(Array(5).fill('sent'));
  });

  it('fails at once, without a try, when a saved header value is one a call cannot carry', async () => {
    const { jobId } = await webhookJob();
    await db()
      .update(destinations)
      .set({ secretsEnc: sealWebhookSecrets({ signingSecret: secret, headers: [{ name: 'X-Api-Key', value: 'Avain-€-789' }] }) })
      .where(eq(destinations.kind, 'webhook'));
    const runId = await run(jobId);
    expect(receiver.calls).toHaveLength(0);
    expect(waits).toEqual([]);
    const row = await runRow(runId);
    const message =
      'Could not send the call: the value of the header X-Api-Key of MYHOOK has characters a header cannot carry. Open MYHOOK on the Destinations page and enter the header value again.';
    expect(row.error).toContain(`invoice-260101: ${message}`);
    expect(row.error).not.toContain('Could not reach');
    expect(row.error).not.toContain('Avain');
    const deliveries = await deliveriesOf(runId);
    expect(deliveries[0]).toMatchObject({ status: 'failed', attempts: 0 });
    expect(deliveries.slice(1).map((d) => d.error)).toEqual(Array(5).fill(`Not sent: ${message}`));
  });

  it('records the creation time and pages, and sends again to a new spooled file with a reused job number', async () => {
    const { jobId } = await webhookJob();
    const conn = new FakeConnection();
    const first = await run(jobId, conn);
    const firstIds = receiver.calls.map((call) => call.headers['webhook-id']);
    expect((await deliveriesOf(first))[0]).toMatchObject({ document: 'invoice-260101', splfCreated: sample.attributes.created, firstPage: 1, lastPage: 1 });

    // A plain Retry of the same spooled file sends nothing again.
    const retry = await run(jobId, conn);
    expect(receiver.calls).toHaveLength(6);
    expect((await deliveriesOf(retry)).map((d) => d.status)).toEqual(Array(6).fill('already_sent'));

    // The IBM i reused the job number: same job, name and number, another creation time.
    const file = conn.samples.find((s) => s.splf.name === sample.splf.name)!;
    file.attributes = { ...file.attributes, created: '2026-10-18T08:15:00' };
    const second = await run(jobId, conn);
    expect((await runRow(second)).steps.find((step) => step.step === 'deliver')?.note).toBe('Sent 6 documents to hooks.example.com');
    const newIds = receiver.calls.slice(6).map((call) => call.headers['webhook-id']);
    expect(newIds).toHaveLength(6);
    for (const id of newIds) expect(firstIds).not.toContain(id);
  });

  it('keeps the webhook-id of a call that failed before the creation time was recorded', async () => {
    const { jobId } = await webhookJob();
    receiver.state.answer = (call) =>
      (JSON.parse(call.body) as WebhookPayload).data.document.name === 'invoice-260103' ? new Response('no', { status: 422, statusText: 'Unprocessable Entity' }) : Response.json({});
    const conn = new FakeConnection();
    await run(jobId, conn);
    // Rows as an earlier Spooldoc wrote them, with the id it gave.
    await db().update(runDeliveries).set({ splfCreated: null, firstPage: null, lastPage: null });
    await db().update(runDeliveries).set({ messageId: 'msg_0123456789abcdef0123456789abcdef' }).where(eq(runDeliveries.document, 'invoice-260103'));

    receiver.state.answer = () => Response.json({});
    const before = receiver.calls.length;
    await run(jobId, conn);
    const again = receiver.calls.slice(before);
    expect(again).toHaveLength(1);
    expect(again[0]!.headers['webhook-id']).toBe('msg_0123456789abcdef0123456789abcdef');
  });

  it('sends each document once when two runs of the same spooled file overlap', async () => {
    const { jobId } = await webhookJob();
    const [a, b] = await Promise.all([run(jobId), run(jobId)]);
    expect(receiver.calls).toHaveLength(6);
    const statuses = [...(await deliveriesOf(a)), ...(await deliveriesOf(b))].map((d) => d.status).sort();
    expect(statuses).toEqual([...Array(6).fill('already_sent'), ...Array(6).fill('sent')]);
  });

  it('in test mode, sends every document to the test URL, also those sent for real before', async () => {
    const { jobId } = await webhookJob();
    const first = await run(jobId);
    await db().update(destinations).set({ config: { url: URL_IN_USE, testUrl: TEST_URL } }).where(eq(destinations.kind, 'webhook'));
    await run(jobId);
    expect(receiver.calls.slice(6).map((call) => call.url)).toEqual(Array(6).fill(TEST_URL));
    // Taking the test URL out sends nothing again: the first run sent each for real.
    await db().update(destinations).set({ config: { url: URL_IN_USE, testUrl: null } }).where(eq(destinations.kind, 'webhook'));
    const third = await run(jobId);
    expect(receiver.calls).toHaveLength(12);
    expect((await runRow(third)).steps.find((step) => step.step === 'deliver')?.note).toBe(`Sent 0 documents to hooks.example.com, 6 were sent in run #${(await runRow(first)).seq}`);
  });

  /** A first run of the invoice job whose rows look as an earlier Spooldoc wrote them, at `sentAt`, with invoice-260103 failed. */
  async function legacyRun(sentAt: Date): Promise<{ jobId: string; conn: FakeConnection; seq: number }> {
    const { jobId } = await webhookJob();
    receiver.state.answer = (call) =>
      (JSON.parse(call.body) as WebhookPayload).data.document.name === 'invoice-260103' ? new Response('no', { status: 422, statusText: 'Unprocessable Entity' }) : Response.json({});
    const conn = new FakeConnection();
    const first = await run(jobId, conn);
    await db().update(runDeliveries).set({ splfCreated: null, firstPage: null, lastPage: null, sentAt });
    await db().update(runDeliveries).set({ messageId: 'msg_0123456789abcdef0123456789abcdef' }).where(eq(runDeliveries.document, 'invoice-260103'));
    receiver.state.answer = () => Response.json({});
    return { jobId, conn, seq: (await runRow(first)).seq };
  }

  it('does not let an older row, from before the spooled file was created, count as sent or lend its id', async () => {
    // The invoice sample was created 2026-10-17T21:40:38 on the IBM i's clock; these rows are from two days before.
    const { jobId, conn } = await legacyRun(new Date('2026-10-15T12:00:00Z'));
    const before = receiver.calls.length;
    const second = await run(jobId, conn);
    expect((await runRow(second)).steps.find((step) => step.step === 'deliver')?.note).toBe('Sent 6 documents to hooks.example.com');
    const again = receiver.calls.slice(before);
    expect(again).toHaveLength(6);
    expect(again.map((call) => call.headers['webhook-id'])).not.toContain('msg_0123456789abcdef0123456789abcdef');
  });

  it('lets a row written after the spooled file was created count as sent and lend its id, whatever the time zone', async () => {
    // Ten hours before 21:40:38 read as UTC: still after it, on an IBM i 14 hours ahead of UTC.
    const { jobId, conn, seq } = await legacyRun(new Date('2026-10-17T11:40:38Z'));
    const before = receiver.calls.length;
    const second = await run(jobId, conn);
    expect((await runRow(second)).steps.find((step) => step.step === 'deliver')?.note).toBe(`Sent 1 document to hooks.example.com, 5 were sent in run #${seq}`);
    const again = receiver.calls.slice(before);
    expect(again.map((call) => call.headers['webhook-id'])).toEqual(['msg_0123456789abcdef0123456789abcdef']);
  });

  it('matches an older row on the name alone when the IBM i gave no creation time', async () => {
    const { jobId, conn } = await legacyRun(new Date('2020-01-01T00:00:00Z'));
    const file = conn.samples.find((s) => s.splf.name === sample.splf.name)!;
    file.attributes = { ...file.attributes, created: '' };
    const before = receiver.calls.length;
    await run(jobId, conn);
    const again = receiver.calls.slice(before);
    expect(again.map((call) => call.headers['webhook-id'])).toEqual(['msg_0123456789abcdef0123456789abcdef']);
  });

  it('names documents and files with the same name in the preview as the run does', async () => {
    const { jobId, spec } = await webhookJob();
    const definition = fixtureText('invoice', 'definition.yaml').replace('name: "invoice-{d.pg.invoiceNo}"', 'name: "invoice"');
    const cover = { id: 'cover', name: 'Cover', kind: 'html', source: null, formats: ['pdf'] } as JobSpec['render']['templates'][number];
    const named: JobSpec = { ...spec, extract: { definition }, render: { templates: [...spec.render.templates, cover] } };
    await db().insert(jobVersions).values({ jobId, number: 2, spec: named });
    const stored = await storeSample(serverId, { sample, warnings: [] });
    await db().update(jobs).set({ activeVersion: 2, draft: { ...named, preview: { sampleId: stored.id } } });

    const runId = await runJob({ jobId, version: 2, splf: sample.splf, trigger: 'manual' }, { conn: new FakeConnection(), host: 'ibmi.example.com', serverId, password: GOOD_PASSWORD });
    const names = (await deliveriesOf(runId)).map((d) => d.document);
    expect(names).toEqual(['invoice', 'invoice-2', 'invoice-3', 'invoice-4', 'invoice-5', 'invoice-6']);
    const runFiles = receiver.payloads().map((payload) => payload.data.files.map((file) => file.name));
    expect(runFiles[1]).toEqual(['invoice-2.pdf', 'invoice-cover-2.pdf']);

    const auth = await signedIn();
    for (const pageGroupIndex of [0, 2]) {
      const response = await previewRoute.POST(
        appRequest(`/api/jobs/${jobId}/webhook-preview`, { method: 'POST', body: { pageGroupIndex }, headers: auth }),
        params({ id: jobId }),
      );
      const view = (await response.json()) as WebhookPreviewView;
      expect(view.document).toBe(names[pageGroupIndex]);
      const body = JSON.parse(view.body) as WebhookPayload;
      expect(body.data.document.name).toBe(names[pageGroupIndex]);
      expect(body.data.files.map((file) => file.name)).toEqual(runFiles[pageGroupIndex]);
    }
  });

  it('in test mode, sends to the test URL as document.test without the headers, and Retry does not count it', async () => {
    const { jobId } = await webhookJob(TEST_URL);
    const runId = await run(jobId);
    expect((await runRow(runId)).steps.find((step) => step.step === 'deliver')?.note).toBe('Sent 6 documents to the test URL inspect.example.com/abc');
    expect(receiver.calls.map((call) => call.url)).toEqual(Array(6).fill(TEST_URL));
    expect(receiver.calls[0]!.headers.authorization).toBeUndefined();
    // Still signed.
    expect(() => new Webhook(secret).verify(receiver.calls[0]!.body, receiver.calls[0]!.headers)).not.toThrow();
    expect(receiver.payloads().map((payload) => payload.type)).toEqual(Array(6).fill('document.test'));
    const deliveries = await deliveriesOf(runId);
    expect(deliveries.map((d) => d.test)).toEqual(Array(6).fill(true));

    // With the test URL taken out, every document goes to the real URL.
    await db().update(destinations).set({ config: { url: URL_IN_USE, testUrl: null } }).where(eq(destinations.kind, 'webhook'));
    const before = receiver.calls.length;
    await run(jobId);
    expect(receiver.calls.slice(before).map((call) => call.url)).toEqual(Array(6).fill(URL_IN_USE));
    expect(receiver.calls[before]!.headers['webhook-id']).not.toBe(receiver.calls[0]!.headers['webhook-id']);
  });
});
