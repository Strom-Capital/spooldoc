import { createPublicKey, verify } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settings } from '@/lib/server/db/schema';
import type { RenderingView, SettingsView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { resetTables } from './helpers/db';
import { db } from './helpers/fixtures';
import { appRequest } from './helpers/mocks';

const route = await import('@/app/api/settings/route');
const checkRoute = await import('@/app/api/settings/rendering/route');
const { carboneServer, checkCarbone, renderingReady } = await import('@/lib/server/rendering');

let auth: Record<string, string>;
const fetchMock = vi.fn<typeof fetch>();

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const STATUS = () => json(200, { success: true, code: 200, message: 'OK', version: '5.15.5' });
const COMMUNITY = () => json(500, { success: false, error: 'Unable to generate the document. Error: Formatter "aggSum" is disabled in the Community Edition.', code: 'w101' });
const ENTERPRISE = () => new Response('3', { status: 200, headers: { 'content-type': 'text/plain' } });

/** Answers /status and the probe, like a Carbone server of this edition. */
function carbone(probe: () => Response): void {
  fetchMock.mockImplementation(async (url) => (String(url).endsWith('/status') ? STATUS() : probe()));
}

const put = async (body: unknown): Promise<SettingsView> => (await route.PUT(appRequest('/api/settings', { method: 'PUT', body, headers: auth }))).json();
const view = async (): Promise<SettingsView> => (await route.GET(appRequest('/api/settings', { headers: auth }))).json();

beforeEach(async () => {
  await resetTables(db());
  auth = await signedIn();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rendering settings', () => {
  it('starts on-prem at the Compose service, with a public key on one line and no check yet', async () => {
    const { rendering } = await view();
    expect(rendering).toMatchObject({ mode: 'onprem', url: 'http://carbone:4000', hasApiKey: false, check: null });
    expect(rendering.publicKey).toMatch(/^-----BEGIN PUBLIC KEY-----\\n.+\\n-----END PUBLIC KEY-----$/);
    expect(rendering.publicKey).not.toContain('\n');
    // The key pair is made once and kept.
    expect((await view()).rendering.publicKey).toBe(rendering.publicKey);
    expect(await renderingReady()).toBe(false);
  });

  it('checks the server after a change: the version, and the edition from the probe, signed with Spooldoc\'s key', async () => {
    carbone(COMMUNITY);
    const saved = await put({ rendering: { mode: 'onprem', url: 'http://carbone.example.com:4000/' } });
    expect(saved.rendering).toMatchObject({ mode: 'onprem', url: 'http://carbone.example.com:4000', check: { ok: true, version: '5.15.5', edition: 'community' } });
    expect(await renderingReady()).toBe(true);

    const [, init] = fetchMock.mock.calls.find(([url]) => String(url).includes('/render/template'))!;
    const token = (init!.headers as Record<string, string>).authorization!.replace(/^Bearer /, '');
    const [head, claims, signature] = token.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toMatchObject({ aud: 'carbone-ee', iss: 'spooldoc' });
    const publicKey = createPublicKey(saved.rendering.publicKey.replace(/\\n/g, '\n'));
    expect(verify('sha512', Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))).toBe(true);

    carbone(ENTERPRISE);
    const again = (await (await checkRoute.POST(appRequest('/api/settings/rendering', { method: 'POST', headers: auth }))).json()) as RenderingView;
    expect(again.check).toMatchObject({ ok: true, edition: 'enterprise' });
  });

  it('says what to do when Carbone refuses the token', async () => {
    fetchMock.mockImplementation(async (url) => (String(url).endsWith('/status') ? STATUS() : json(401, { success: false, error: 'Unauthorized, please provide a valid access token' })));
    const check = await checkCarbone();
    expect(check).toMatchObject({ ok: false, detail: 'Unauthorized, please provide a valid access token' });
    expect(check.error).toMatch(/Set CARBONE_AUTHENTICATION_PUBLIC_KEY on the Carbone service/);
    expect(await renderingReady()).toBe(false);
  });

  it('uses Carbone Cloud with the user\'s key, never shows it, and does not probe', async () => {
    const noKey = await put({ rendering: { mode: 'cloud' } });
    expect(noKey.rendering.check).toMatchObject({ ok: false, error: 'Add your Carbone Cloud API key in Settings, under Rendering.' });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockImplementation(async () => STATUS());
    const saved = await put({ rendering: { mode: 'cloud', apiKey: 'test_key_123' } });
    expect(saved.rendering).toMatchObject({ mode: 'cloud', hasApiKey: true, check: { ok: true, edition: 'cloud' } });
    expect(JSON.stringify(saved)).not.toContain('test_key_123');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['https://api.carbone.io/status']);
    const server = await carboneServer();
    expect(server).toMatchObject({ url: 'https://api.carbone.io', cloud: true });
    expect(server.token?.()).toBe('test_key_123');
    const [row] = await db().select({ key: settings.carboneApiKeyEnc }).from(settings);
    expect(row!.key).not.toContain('test_key_123');

    expect((await put({ rendering: { mode: 'cloud', apiKey: null } })).rendering.hasApiKey).toBe(false);
  });

  it('saves other settings without checking Carbone again', async () => {
    await put({ retentionDays: 30 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ mode: 'onprem', url: 'ftp://carbone' }, 'Enter an http or https URL'],
    [{ mode: 'onprem' }, 'Enter the URL of the Carbone server'],
    [{ mode: 'elsewhere' }, 'Choose on-prem or Carbone Cloud'],
  ])('refuses %j', async (rendering, message) => {
    const response = await route.PUT(appRequest('/api/settings', { method: 'PUT', body: { rendering }, headers: auth }));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain(message);
  });

  it('needs a session to check again', async () => {
    expect((await checkRoute.POST(appRequest('/api/settings/rendering', { method: 'POST' }))).status).toBe(401);
  });
});
