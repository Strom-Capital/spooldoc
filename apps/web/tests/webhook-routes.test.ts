import { eq } from 'drizzle-orm';
import { Webhook } from 'standardwebhooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySpec } from '@/lib/job-spec';
import { destinations, jobs, runDeliveries } from '@/lib/server/db/schema';
import { sealWebhookSecrets } from '@/lib/server/destinations/webhook';
import { storeSample } from '@/lib/server/samples';
import { newSigningSecret, type WebhookPayload } from '@/lib/server/webhook-payload';
import type { WebhookPreviewView, WebhookTestView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { resetTables } from './helpers/db';
import { fixtureText, loadSample } from './helpers/fake-connection';
import { db, insertServer } from './helpers/fixtures';
import { appRequest, params } from './helpers/mocks';

const previewRoute = await import('@/app/api/jobs/[id]/webhook-preview/route');
const testRoute = await import('@/app/api/jobs/[id]/webhook-test/route');

const HEADER_VALUE = 'Bearer Header-Secret-456';
let auth: Record<string, string>;
let secret: string;

/** A job with the invoice definition, the invoice sample as preview, and MYHOOK as its destination. */
async function webhookJob(testUrl: string | null = null): Promise<string> {
  const serverId = await insertServer();
  const sample = await storeSample(serverId, { sample: loadSample('invoice'), warnings: [] });
  const [destination] = await db()
    .insert(destinations)
    .values({
      kind: 'webhook',
      name: 'MYHOOK',
      config: { url: 'https://hooks.example.com/spooldoc', testUrl },
      secretsEnc: sealWebhookSecrets({ signingSecret: secret, headers: [{ name: 'Authorization', value: HEADER_VALUE }] }),
    })
    .returning();
  const base = emptySpec({ serverId, library: 'MYLIB', queue: 'MYOUTQ', destinationId: destination!.id });
  const draft = { ...base, extract: { definition: fixtureText('invoice', 'definition.yaml') }, preview: { sampleId: sample.id } };
  const [job] = await db().insert(jobs).values({ name: 'MYJOB', draft }).returning();
  return job!.id;
}

const post = (route: typeof previewRoute | typeof testRoute, id: string, body: unknown) =>
  route.POST(appRequest(`/api/jobs/${id}/webhook`, { method: 'POST', body, headers: auth }), params({ id }));

let calls: { url: string; headers: Record<string, string>; body: string }[];

beforeEach(async () => {
  await resetTables(db());
  auth = await signedIn();
  secret = newSigningSecret();
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      calls.push({ url: String(input), headers: Object.fromEntries(new Headers(init.headers).entries()), body: String(init.body) });
      return new Response('{"received":true}', { status: 200, statusText: 'OK' });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('the webhook preview', () => {
  it('shows the call with the header values masked, the files by size and the real signature, and sends nothing', async () => {
    const id = await webhookJob();
    const response = await post(previewRoute, id, { pageGroupIndex: 1 });
    expect(response.status).toBe(200);
    const view = (await response.json()) as WebhookPreviewView;
    expect(view).toMatchObject({ pageGroup: 1, pageGroups: 6, document: 'invoice-260102', method: 'POST', url: 'https://hooks.example.com/spooldoc', testMode: false });
    const headers = Object.fromEntries(view.headers.map((h) => [h.name, h.value]));
    expect(headers).toMatchObject({ host: 'hooks.example.com', 'content-type': 'application/json', Authorization: '••••••' });
    expect(headers['webhook-signature']).toMatch(/^v1,[A-Za-z0-9+/]+=*$/);
    expect(JSON.stringify(view)).not.toContain(HEADER_VALUE);
    expect(JSON.stringify(view)).not.toContain(secret);

    const body = JSON.parse(view.body) as WebhookPayload;
    expect(body).toMatchObject({ type: 'document.test', data: { document: { name: 'invoice-260102', pageGroup: 2 }, run: null, job: { name: 'MYJOB', version: null } } });
    expect(body.data.files).toEqual([{ name: 'invoice-260102.pdf', contentType: 'application/pdf', size: expect.any(Number), template: 'Template 1', content: expect.stringMatching(/ of base64$/) }]);
    expect(view.bodyBytes).toBeGreaterThan(view.body.length / 2);
    expect(calls).toEqual([]);
  });

  it('shows the test URL in test mode, without the custom headers', async () => {
    const id = await webhookJob('https://inspect.example.com/abc');
    const view = (await (await post(previewRoute, id, { pageGroupIndex: 0 })).json()) as WebhookPreviewView;
    expect(view).toMatchObject({ url: 'https://inspect.example.com/abc', testMode: true });
    expect(view.headers.map((h) => h.name)).not.toContain('Authorization');
  });

  it('says to pick a sample, and a webhook destination', async () => {
    const id = await webhookJob();
    const [job] = await db().select().from(jobs).where(eq(jobs.id, id));
    await db()
      .update(jobs)
      .set({ draft: { ...job!.draft, preview: { sampleId: null } } })
      .where(eq(jobs.id, id));
    expect((await (await post(previewRoute, id, {})).json()).error).toBe('Pick a spooled file to preview first.');
    await db().update(jobs).set({ draft: job!.draft }).where(eq(jobs.id, id));
    expect((await (await post(previewRoute, id, { destinationId: null, pageGroupIndex: 0 })).status)).toBe(200);
    const [builtin] = await db().select().from(destinations).where(eq(destinations.builtin, true));
    expect((await (await post(previewRoute, id, { destinationId: builtin!.id })).json()).error).toBe('Pick a webhook destination first.');
  });
});

describe('Send test', () => {
  it('sends one page group once, signed and marked as a test, and records no delivery', async () => {
    const id = await webhookJob();
    const response = await post(testRoute, id, { pageGroupIndex: 2 });
    expect(response.status).toBe(200);
    expect((await response.json()) as WebhookTestView).toMatchObject({ status: 200, statusText: 'OK', body: '{"received":true}', truncated: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.authorization).toBe(HEADER_VALUE);
    expect(() => new Webhook(secret).verify(calls[0]!.body, calls[0]!.headers)).not.toThrow();
    expect((JSON.parse(calls[0]!.body) as WebhookPayload).type).toBe('document.test');
    expect(await db().select().from(runDeliveries)).toEqual([]);
  });

  it('tries a failing receiver once, and says why with its answer', async () => {
    const id = await webhookJob();
    vi.stubGlobal('fetch', async () => {
      calls.push({ url: '', headers: {}, body: '' });
      return new Response(`down, ${HEADER_VALUE}`, { status: 503, statusText: 'Service Unavailable' });
    });
    const response = await post(testRoute, id, {});
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      status: 503,
      statusText: 'Service Unavailable',
      ms: expect.any(Number),
      body: 'down, ***',
      truncated: false,
      error: 'hooks.example.com had a problem and did not take the call (503 Service Unavailable). Retry the run later.',
      detail: 'down, ***',
    });
    expect(calls).toHaveLength(1);
  });
});
