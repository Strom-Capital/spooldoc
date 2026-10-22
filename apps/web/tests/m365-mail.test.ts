import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailSpecSchema, emptySpec, type EmailSpec, type JobSpec } from '@/lib/job-spec';
import { destinations, jobs, jobVersions, runDeliveries, runs, settings } from '@/lib/server/db/schema';
import { composeEmail } from '@/lib/server/email-message';
import { clearGraphTokens, GRAPH_FILE_LIMIT, GraphMailError, graphMessage, graphSendMail, graphTiming, type M365Account } from '@/lib/server/graph-mail';
import { mailErrorText, stopsSending, updateMail, type M365Server } from '@/lib/server/mail';
import { runJob } from '@/lib/server/runner';
import type { SettingsView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { resetTables } from './helpers/db';
import { FakeConnection, fixtureText, GOOD_PASSWORD, loadSample } from './helpers/fake-connection';
import { db, insertServer } from './helpers/fixtures';
import { appRequest } from './helpers/mocks';

const settingsRoute = await import('@/app/api/settings/route');
const testRoute = await import('@/app/api/settings/mail/route');

const TENANT = '11111111-2222-4333-8444-555555555555';
const CLIENT = '66666666-7777-4888-9999-000000000000';
const SECRET = 'Xy7~m365-Secret.Value';
const account: M365Account = { tenantId: TENANT, clientId: CLIENT, clientSecret: SECRET, mailbox: 'invoices@contoso.example' };
const server: M365Server = { sender: 'm365', tenantId: TENANT, clientId: CLIENT, clientSecret: SECRET, from: 'invoices@contoso.example', fromName: 'Contoso' };
const m365 = { sender: 'm365', tenantId: TENANT, clientId: CLIENT, clientSecret: SECRET, from: 'invoices@contoso.example', fromName: 'Contoso' } as const;

/** An access token as Microsoft issues it: a JWT with the app's permissions in `roles`. */
const jwt = (roles: string[]) => ['{"alg":"none"}', JSON.stringify({ aud: 'https://graph.microsoft.com', roles })].map((part) => Buffer.from(part).toString('base64url')).join('.') + '.sig';

interface Call {
  url: string;
  init: RequestInit;
}

/**
 * A stand-in for the token endpoint and Graph, in place of `fetch`. Nothing goes to the
 * network. `token` and `send` answer each request; by default a token with Mail.Send and
 * a 202 for every email.
 */
function fakeMicrosoft() {
  const calls: Call[] = [];
  const state: { token: () => Response; send: (body: { message: Record<string, unknown> }, n: number) => Response } = {
    token: () => Response.json({ token_type: 'Bearer', expires_in: 3599, access_token: jwt(['Mail.Send']) }),
    send: () => new Response(null, { status: 202 }),
  };
  let sends = 0;
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/oauth2/v2.0/token')) return state.token();
    if (url.endsWith('/sendMail')) return state.send(JSON.parse(String(init.body)), ++sends);
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  return {
    calls,
    state,
    tokenCalls: () => calls.filter((call) => call.url.includes('/oauth2/v2.0/token')),
    sendCalls: () => calls.filter((call) => call.url.endsWith('/sendMail')),
    sent: () => calls.filter((call) => call.url.endsWith('/sendMail')).map((call) => JSON.parse(String(call.init.body)) as { message: Record<string, unknown> }),
  };
}

/** A Graph error response. */
const graphError = (status: number, code: string, message: string, headers: Record<string, string> = {}) => Response.json({ error: { code, message } }, { status, headers });
/** A token endpoint error response, with the AADSTS text and its trace lines. */
const signInError = (status: number, error: string, code: number, text: string) =>
  Response.json({ error, error_codes: [code], error_description: `AADSTS${code}: ${text}\r\nTrace ID: 0000\r\nCorrelation ID: 0000` }, { status });

const message = { from: { name: 'Contoso', address: 'invoices@contoso.example' }, to: ['buyer@example.com'], subject: 'Invoice 260101', html: '<p>Hello</p>', text: 'Hello' };

let ms: ReturnType<typeof fakeMicrosoft>;
let waits: number[];
const realSleep = graphTiming.sleep;

beforeEach(() => {
  clearGraphTokens();
  ms = fakeMicrosoft();
  waits = [];
  graphTiming.sleep = async (wait) => void waits.push(wait);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  graphTiming.sleep = realSleep;
  delete process.env.SPOOLDOC_MICROSOFT_URL;
});

describe('the Microsoft 365 token', () => {
  it('comes from the client credentials flow of the tenant, and is cached until shortly before it expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await graphSendMail(account, message);
    await graphSendMail(account, message);
    expect(ms.tokenCalls()).toHaveLength(1);
    const [token] = ms.tokenCalls();
    expect(token!.url).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`);
    expect(token!.init.method).toBe('POST');
    expect(Object.fromEntries(new URLSearchParams(String(token!.init.body)))).toEqual({
      grant_type: 'client_credentials',
      client_id: CLIENT,
      client_secret: SECRET,
      scope: 'https://graph.microsoft.com/.default',
    });
    const [send] = ms.sendCalls();
    expect(send!.url).toBe('https://graph.microsoft.com/v1.0/users/invoices%40contoso.example/sendMail');
    expect((send!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${jwt(['Mail.Send'])}`);

    // 3599 seconds, less five minutes: still cached at 54 minutes, fetched again at 56.
    vi.setSystemTime(Date.now() + 54 * 60_000);
    await graphSendMail(account, message);
    expect(ms.tokenCalls()).toHaveLength(1);
    vi.setSystemTime(Date.now() + 2 * 60_000);
    await graphSendMail(account, message);
    expect(ms.tokenCalls()).toHaveLength(2);
  });

  it('is fetched again once when Graph rejects it', async () => {
    ms.state.send = (_body, n) => (n === 1 ? graphError(401, 'InvalidAuthenticationToken', 'Access token has expired or is not yet valid.') : new Response(null, { status: 202 }));
    await graphSendMail(account, message);
    expect(ms.tokenCalls()).toHaveLength(2);
    expect(ms.sendCalls()).toHaveLength(2);
  });

  it('goes to the stand-in that SPOOLDOC_MICROSOFT_URL names, for tests and checks', async () => {
    process.env.SPOOLDOC_MICROSOFT_URL = 'http://localhost:3499/';
    await graphSendMail(account, message);
    expect(ms.calls.map((call) => call.url)).toEqual([`http://localhost:3499/${TENANT}/oauth2/v2.0/token`, 'http://localhost:3499/v1.0/users/invoices%40contoso.example/sendMail']);
  });
});

describe('the Graph message', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const spec = (change: Partial<EmailSpec> = {}): EmailSpec => emailSpecSchema.parse({ to: '{d.pg.email}', ...change });
  const pdf = { name: 'invoice-260101.pdf', contentType: 'application/pdf', content: new Uint8Array([37, 80, 68, 70]) };

  it('has the same recipients, Reply-To, subject, HTML and files as the SMTP email', () => {
    const { email } = composeEmail({
      spec: spec({ to: '{d.pg.email}, orders@example.com', cc: 'boss@example.com', bcc: 'archive@example.com', replyTo: 'sales@example.com', subject: 'Invoice {d.pg.no}' }),
      data: { pg: { email: 'buyer@example.com', no: '260101' } },
      document: 'invoice-260101',
      files: [pdf],
      from: { name: 'Contoso', address: 'invoices@contoso.example' },
      testAddress: null,
    });
    const graph = graphMessage(email!.message);
    expect(graph.saveToSentItems).toBe(true);
    expect(graph.message).toMatchObject({
      subject: 'Invoice 260101',
      from: { emailAddress: { address: 'invoices@contoso.example', name: 'Contoso' } },
      toRecipients: [{ emailAddress: { address: 'buyer@example.com' } }, { emailAddress: { address: 'orders@example.com' } }],
      ccRecipients: [{ emailAddress: { address: 'boss@example.com' } }],
      bccRecipients: [{ emailAddress: { address: 'archive@example.com' } }],
      replyTo: [{ emailAddress: { address: 'sales@example.com' } }],
      body: { contentType: 'HTML' },
      attachments: [{ '@odata.type': '#microsoft.graph.fileAttachment', name: 'invoice-260101.pdf', contentType: 'application/pdf', contentBytes: Buffer.from(pdf.content).toString('base64') }],
    });
    expect((graph.message.body as { content: string }).content).toContain('Your document is attached.');
  });

  it('keeps the names of the addresses', () => {
    const { email } = composeEmail({
      spec: spec({ to: '{d.pg.contact}; orders@example.com', replyTo: 'Sales Team <sales@example.com>' }),
      data: { pg: { contact: '"Smith, John" <john@example.com>' } },
      document: 'd',
      files: [],
      from: 'invoices@contoso.example',
      testAddress: null,
    });
    const graph = graphMessage(email!.message);
    expect(graph.message.toRecipients).toEqual([{ emailAddress: { address: 'john@example.com', name: 'Smith, John' } }, { emailAddress: { address: 'orders@example.com' } }]);
    expect(graph.message.replyTo).toEqual([{ emailAddress: { address: 'sales@example.com', name: 'Sales Team' } }]);
  });

  it('turns data URI images into inline attachments the HTML points to with cid', () => {
    const html = `<html><body><img src="${png}" alt="Logo"><img src='${png}'><p>302.66</p></body></html>`;
    const { email } = composeEmail({ spec: spec({ bodyTemplateId: 'template-1' }), data: { pg: { email: 'buyer@example.com' } }, document: 'd', files: [], from: 'invoices@contoso.example', testAddress: null, templateHtml: html });
    const graph = graphMessage(email!.message);
    const content = (graph.message.body as { content: string }).content;
    expect(content).not.toContain('data:image');
    const images = graph.message.attachments as { isInline?: boolean; contentId?: string; contentType: string; name: string; contentBytes: string }[];
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({ isInline: true, contentId: 'image1@spooldoc', contentType: 'image/png', name: 'image1.png', contentBytes: png.split(',')[1] });
    expect(content).toContain('src="cid:image1@spooldoc"');
    expect(content).toContain('src="cid:image2@spooldoc"');
  });

  it('sends a message with no HTML as text', () => {
    expect(graphMessage({ to: 'Buyer <buyer@example.com>', subject: 'Test', text: 'Plain' }).message).toMatchObject({
      toRecipients: [{ emailAddress: { address: 'buyer@example.com', name: 'Buyer' } }],
      body: { contentType: 'Text', content: 'Plain' },
    });
  });

  it('fails a file over 3 MB with its name, and sends nothing', async () => {
    const big = { filename: 'statement-2026.pdf', content: Buffer.alloc(GRAPH_FILE_LIMIT + 1), contentType: 'application/pdf' };
    const error = await graphSendMail(account, { ...message, attachments: [big] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GraphMailError);
    expect(ms.sendCalls()).toHaveLength(0);
    expect(stopsSending(error)).toBe(false);
    expect(mailErrorText(error, server)).toEqual({
      message: 'statement-2026.pdf is larger than the 3 MB Microsoft 365 takes for a file here. Attach fewer formats, make the document smaller, or send it through an SMTP server.',
      detail: 'statement-2026.pdf is 3.0 MB; sendMail takes files up to 3 MB.',
    });
  });

  it('fails an email over 4 MB in all, though each file is under 3 MB', async () => {
    const file = (n: number) => ({ filename: `part-${n}.pdf`, content: Buffer.alloc(2 * 1024 * 1024), contentType: 'application/pdf' });
    const error = await graphSendMail(account, { ...message, attachments: [file(1), file(2)] }).catch((e: unknown) => e);
    expect(mailErrorText(error, server).message).toBe(
      'The email is larger than the 4 MB Microsoft 365 takes here. Attach fewer formats, make the documents smaller, or send them through an SMTP server.',
    );
  });
});

describe('Microsoft 365 errors', () => {
  const failure = async () => {
    const error = await graphSendMail(account, message).catch((e: unknown) => e);
    return { ...mailErrorText(error, server), stops: stopsSending(error) };
  };

  it.each([
    [
      'a wrong tenant ID',
      () => (ms.state.token = () => signInError(400, 'invalid_request', 90002, `Tenant '${TENANT}' not found.`)),
      `Microsoft 365 has no tenant ${TENANT}. Check the directory (tenant) ID in Settings, under Mail server. It is on the Overview page of the app registration in Microsoft Entra ID.`,
      `AADSTS90002: Tenant '${TENANT}' not found.`,
    ],
    [
      'a wrong client ID',
      () => (ms.state.token = () => signInError(400, 'unauthorized_client', 700016, `Application with identifier '${CLIENT}' was not found in the directory.`)),
      `Microsoft 365 has no application ${CLIENT} in this tenant. Check the application (client) ID and the tenant ID in Settings, under Mail server.`,
      `AADSTS700016: Application with identifier '${CLIENT}' was not found in the directory.`,
    ],
    [
      'a wrong secret',
      () => (ms.state.token = () => signInError(401, 'invalid_client', 7000215, 'Invalid client secret provided.')),
      "Microsoft 365 refused the client secret. Enter the secret's value, not its ID, in Settings, under Mail server. Make a new secret in the app registration if the value is lost.",
      'AADSTS7000215: Invalid client secret provided.',
    ],
    [
      'an expired secret',
      () => (ms.state.token = () => signInError(401, 'invalid_client', 7000222, `The provided client secret keys for app '${CLIENT}' are expired.`)),
      'The client secret has expired. Make a new one under Certificates & secrets in the app registration, and enter its value in Settings, under Mail server.',
      `AADSTS7000222: The provided client secret keys for app '${CLIENT}' are expired.`,
    ],
    [
      'no Mail.Send permission or admin consent',
      () => {
        ms.state.token = () => Response.json({ expires_in: 3599, access_token: jwt([]) });
        ms.state.send = () => graphError(403, 'ErrorAccessDenied', 'Access is denied. Check credentials and try again.');
      },
      'The app has no permission to send email. Give it the Mail.Send application permission with admin consent in Microsoft Entra ID, or the Application Mail.Send role in Exchange Online for this mailbox.',
      'ErrorAccessDenied: Access is denied. Check credentials and try again.',
    ],
    [
      'a mailbox the application access policy leaves out',
      () => (ms.state.send = () => graphError(403, 'ErrorAccessDenied', 'Access to OData is disabled: [RAOP] : Blocked by tenant configured AppOnly AccessPolicy settings.')),
      "Microsoft 365 does not let the app send as invoices@contoso.example. Add the mailbox to the app's application access policy or RBAC scope, or send from a mailbox it covers.",
      'ErrorAccessDenied: Access to OData is disabled: [RAOP] : Blocked by tenant configured AppOnly AccessPolicy settings.',
    ],
    [
      'a mailbox that does not exist',
      () => (ms.state.send = () => graphError(404, 'ErrorInvalidUser', "The requested user 'invoices@contoso.example' is invalid.")),
      'Microsoft 365 has no mailbox invoices@contoso.example. Check the From address in Settings, under Mail server: it must be a mailbox of the tenant with an Exchange Online license, or a shared mailbox.',
      "ErrorInvalidUser: The requested user 'invoices@contoso.example' is invalid.",
    ],
    [
      'the connection',
      () => vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })))),
      'Could not reach Microsoft 365. Check that the Spooldoc server can connect to login.microsoftonline.com and graph.microsoft.com on port 443.',
      'fetch failed: ENOTFOUND',
    ],
  ])('say what to do about %s, keep Microsoft text as the detail, and stop the run', async (_name, set, text, detail) => {
    set();
    expect(await failure()).toEqual({ message: text, detail, stops: true });
  });

  it('say an address was refused, without stopping the run', async () => {
    ms.state.send = () => graphError(400, 'ErrorInvalidRecipients', "At least one recipient isn't valid.");
    expect(await failure()).toEqual({
      message: "Microsoft 365 refused an address of the email. Check the job's To, Cc, Bcc and Reply-To.",
      detail: "ErrorInvalidRecipients: At least one recipient isn't valid.",
      stops: false,
    });
  });

  it('say the email is too large when Graph refuses its size', async () => {
    ms.state.send = () => graphError(413, 'ErrorMessageSizeExceeded', 'The message exceeds the maximum supported size.');
    expect((await failure()).message).toMatch(/^The email is larger than the 4 MB Microsoft 365 takes here\./);
  });

  it('never show the client secret, even when Microsoft echoes it', async () => {
    ms.state.token = () => signInError(401, 'invalid_client', 7000215, `Invalid client secret provided: ${SECRET}`);
    const shown = await failure();
    expect(JSON.stringify(shown)).not.toContain(SECRET);
    expect(shown.detail).toBe('AADSTS7000215: Invalid client secret provided: ***');
  });
});

describe('throttling', () => {
  it('waits the Retry-After Microsoft asks for and tries again', async () => {
    ms.state.send = (_body, n) => (n < 3 ? graphError(429, 'ApplicationThrottled', 'Application is over its MailboxConcurrency limit.', { 'Retry-After': String(n * 2) }) : new Response(null, { status: 202 }));
    await graphSendMail(account, message);
    expect(waits).toEqual([2000, 4000]);
    expect(ms.sendCalls()).toHaveLength(3);
  });

  it('fails with a clear message when the wait is too long or throttling goes on, and stops the run', async () => {
    ms.state.send = () => graphError(429, 'ApplicationThrottled', 'Application is over its MailboxConcurrency limit.', { 'Retry-After': '120' });
    const error = await graphSendMail(account, message).catch((e: unknown) => e);
    expect(waits).toEqual([]);
    expect(stopsSending(error)).toBe(true);
    expect(mailErrorText(error, server)).toEqual({
      message: 'Microsoft 365 is throttling the app and asks to wait 120 seconds. Retry the run later.',
      detail: 'ApplicationThrottled: Application is over its MailboxConcurrency limit.',
    });

    ms.state.send = () => graphError(429, 'ApplicationThrottled', 'Too many requests.', { 'Retry-After': '1' });
    await graphSendMail(account, message).catch(() => undefined);
    expect(waits).toEqual([1000, 1000]);
  });
});

describe('Microsoft 365 in Settings', () => {
  let auth: Record<string, string>;
  const put = (body: unknown) => settingsRoute.PUT(appRequest('/api/settings', { method: 'PUT', body, headers: auth }));
  const smtp = { host: 'smtp.example.com', port: 587, security: 'starttls', user: 'mailer', password: 'mail-Passw0rd', from: 'invoices@example.com', fromName: 'Example Co' };

  beforeEach(async () => {
    await resetTables(db());
    auth = await signedIn();
  });

  it('is saved with the secret encrypted, never sends it back, and keeps the SMTP server for later', async () => {
    await put({ mail: smtp });
    const response = await put({ mail: { ...smtp, ...m365 } });
    expect(response.status).toBe(200);
    const view = ((await response.json()) as SettingsView).mail;
    expect(view).toMatchObject({ sender: 'm365', tenantId: TENANT, clientId: CLIENT, hasClientSecret: true, from: 'invoices@contoso.example', fromName: 'Contoso', configured: true });
    expect(view).toMatchObject({ host: 'smtp.example.com', user: 'mailer', hasPassword: true });
    expect(JSON.stringify(view)).not.toContain(SECRET);
    const [row] = await db().select({ enc: settings.m365SecretEnc }).from(settings);
    expect(row?.enc).toMatch(/^v1\./);
    expect(row?.enc).not.toContain(SECRET);

    // Saved again without the secret: it keeps the saved one. Null removes it.
    expect(((await (await put({ mail: { ...m365, clientSecret: undefined, fromName: '' } })).json()) as SettingsView).mail).toMatchObject({ hasClientSecret: true, fromName: '' });
    const get = await settingsRoute.GET(appRequest('/api/settings', { headers: auth }));
    expect(((await get.json()) as SettingsView).mail.hasClientSecret).toBe(true);
    const removed = await put({ mail: { ...m365, clientSecret: null } });
    expect(removed.status).toBe(400);
    expect((await removed.json()).error).toBe('Enter the client secret, the value from Certificates & secrets in the app registration.');
  });

  it.each([
    [{ ...m365, tenantId: 'not a tenant' }, 'Enter the directory (tenant) ID, a GUID or a domain such as contoso.onmicrosoft.com'],
    [{ ...m365, clientId: 'my-app' }, 'Enter the application (client) ID, a GUID such as 00000000-0000-0000-0000-000000000000'],
    [{ ...m365, from: '' }, 'Enter the mailbox Spooldoc sends from, such as invoices@example.com'],
    [{ ...m365, clientSecret: undefined }, 'Enter the client secret, the value from Certificates & secrets in the app registration'],
  ])('refuses %j', async (body, text) => {
    const response = await put({ mail: body });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(`${text}.`);
  });

  it('takes a tenant domain, and turns email off with an empty tenant ID', async () => {
    expect(((await (await put({ mail: { ...m365, tenantId: 'contoso.onmicrosoft.com' } })).json()) as SettingsView).mail.configured).toBe(true);
    const off = ((await (await put({ mail: { ...m365, tenantId: '', clientId: '', clientSecret: undefined } })).json()) as SettingsView).mail;
    expect(off).toMatchObject({ sender: 'm365', tenantId: '', clientId: '', hasClientSecret: false, configured: false });
  });

  it('sends a test email to the signed-in user through Graph', async () => {
    await put({ mail: m365 });
    const response = await testRoute.POST(appRequest('/api/settings/mail', { method: 'POST', headers: auth }));
    expect(response.status).toBe(200);
    const { to } = await response.json();
    expect(ms.sent()).toMatchObject([
      {
        message: {
          subject: 'Test email from Spooldoc',
          from: { emailAddress: { address: 'invoices@contoso.example', name: 'Contoso' } },
          toRecipients: [{ emailAddress: { address: to } }],
          body: { contentType: 'Text', content: expect.stringContaining('through Microsoft 365') },
        },
      },
    ]);
  });

  it('says what to do when the test email fails, with Microsoft text as the detail', async () => {
    await put({ mail: m365 });
    ms.state.token = () => signInError(401, 'invalid_client', 7000222, 'The provided client secret keys are expired.');
    const response = await testRoute.POST(appRequest('/api/settings/mail', { method: 'POST', headers: auth }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'The client secret has expired. Make a new one under Certificates & secrets in the app registration, and enter its value in Settings, under Mail server.',
      detail: 'AADSTS7000222: The provided client secret keys are expired.',
    });
  });
});

describe('the email destination through Microsoft 365', () => {
  const sample = loadSample('invoice');
  let serverId: string;

  beforeEach(async () => {
    await resetTables(db());
    serverId = await insertServer();
    await updateMail(m365);
  });

  async function emailJob(): Promise<string> {
    const [destination] = await db().insert(destinations).values({ kind: 'email', name: 'Invoices by email', config: { testAddress: null } }).returning();
    const spec: JobSpec = {
      ...emptySpec({ serverId, library: 'MYLIB', queue: 'INVOICES', destinationId: destination!.id }),
      extract: { definition: fixtureText('invoice', 'definition.yaml') },
      destination: { destinationId: destination!.id, email: emailSpecSchema.parse({ to: '{d.pg.customerNo}@example.com', subject: 'Invoice {d.pg.invoiceNo}' }), webhook: null },
    };
    const [job] = await db().insert(jobs).values({ name: 'Invoices', draft: spec, activeVersion: 1 }).returning();
    await db().insert(jobVersions).values({ jobId: job!.id, number: 1, spec });
    return job!.id;
  }

  const run = async (jobId: string, conn: FakeConnection) =>
    runJob({ jobId, version: 1, splf: sample.splf, trigger: 'manual' }, { conn, host: 'ibmi.example.com', serverId, password: GOOD_PASSWORD });

  it('sends one email per invoice with its PDF and records each, with one token', async () => {
    const jobId = await emailJob();
    const conn = new FakeConnection();
    const runId = await run(jobId, conn);
    const [row] = await db().select().from(runs).where(eq(runs.id, runId));
    expect(row!.status).toBe('success');
    expect(row!.steps.find((step) => step.step === 'deliver')?.note).toBe('Sent 6 emails');
    expect(ms.tokenCalls()).toHaveLength(1);
    const sent = ms.sent();
    expect(sent).toHaveLength(6);
    expect(sent[0]!.message).toMatchObject({
      subject: 'Invoice 260101',
      toRecipients: [{ emailAddress: { address: '10001@example.com' } }],
      attachments: [{ name: 'invoice-260101.pdf', contentType: 'application/pdf' }],
    });
    const deliveries = await db().select().from(runDeliveries).where(eq(runDeliveries.runId, runId));
    expect(deliveries.map((d) => d.status)).toEqual(Array(6).fill('sent'));
    expect(conn.actions()).toEqual(['holdSpooledFile']);
  });

  it('fails the run on a refused address, sends the rest, and Retry sends only that one', async () => {
    const jobId = await emailJob();
    ms.state.send = (body) =>
      (body.message.toRecipients as { emailAddress: { address: string } }[])[0]!.emailAddress.address === '10003@example.com'
        ? graphError(400, 'ErrorInvalidRecipients', "At least one recipient isn't valid.")
        : new Response(null, { status: 202 });
    const conn = new FakeConnection();
    const first = await run(jobId, conn);
    const [failed] = await db().select().from(runs).where(eq(runs.id, first));
    expect(failed!.status).toBe('failed');
    expect(failed!.error).toBe("Sent 5 of 6 emails. invoice-260102: Microsoft 365 refused an address of the email. Check the job's To, Cc, Bcc and Reply-To.");
    expect(conn.actions()).toEqual([]);

    ms.state.send = () => new Response(null, { status: 202 });
    const before = ms.sent().length;
    const second = await run(jobId, conn);
    const [retried] = await db().select().from(runs).where(eq(runs.id, second));
    expect(retried!.status).toBe('success');
    expect(ms.sent().slice(before).map((body) => body.message.toRecipients)).toEqual([[{ emailAddress: { address: '10003@example.com' } }]]);
    expect(conn.actions()).toEqual(['holdSpooledFile']);
  });

  it('stops sending on a sign-in error, records every email, and keeps the secret out', async () => {
    const jobId = await emailJob();
    ms.state.token = () => signInError(401, 'invalid_client', 7000215, `Invalid client secret provided: ${SECRET}`);
    const runId = await run(jobId, new FakeConnection());
    expect(ms.tokenCalls()).toHaveLength(1);
    const [row] = await db().select().from(runs).where(eq(runs.id, runId));
    expect(row!.error).toMatch(/^Sent 0 of 6 emails\. invoice-260101: Microsoft 365 refused the client secret\./);
    const deliveries = await db().select().from(runDeliveries).where(eq(runDeliveries.runId, runId));
    expect(deliveries.map((d) => d.status)).toEqual(Array(6).fill('failed'));
    expect(deliveries[1]!.error).toMatch(/^Not sent: Microsoft 365 refused the client secret\./);
    expect(deliveries[0]!.detail).toBe('AADSTS7000215: Invalid client secret provided: ***');
    expect(JSON.stringify([row, deliveries])).not.toContain(SECRET);
  });
});
