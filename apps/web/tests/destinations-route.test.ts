import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { destinations, jobs, jobVersions } from '@/lib/server/db/schema';
import type { DestinationView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { resetTables } from './helpers/db';
import { builtinDestination, db, insertJob, insertServer } from './helpers/fixtures';
import { appRequest, params, spyConsole } from './helpers/mocks';

const list = await import('@/app/api/destinations/route');
const one = await import('@/app/api/destinations/[id]/route');

let auth: Record<string, string>;
const input = { kind: 'ifs', name: 'Output folder', config: { folder: '/home/docs/out/' } };

const add = (body: unknown = input) => list.POST(appRequest('/api/destinations', { method: 'POST', body, headers: auth }));
const change = (id: string, body: unknown) => one.PATCH(appRequest(`/api/destinations/${id}`, { method: 'PATCH', body, headers: auth }), params({ id }));
const remove = (id: string) => one.DELETE(appRequest(`/api/destinations/${id}`, { method: 'DELETE', headers: auth }), params({ id }));
const all = async (): Promise<DestinationView[]> => (await (await list.GET(appRequest('/api/destinations', { headers: auth }))).json()).destinations;

describe('/api/destinations', () => {
  beforeEach(async () => {
    await resetTables(db());
    auth = await signedIn();
  });

  it('answers 401 without a signed-in user', async () => {
    expect((await list.GET(appRequest('/api/destinations'))).status).toBe(401);
  });

  it('adds, changes and deletes an IFS destination', async () => {
    const spies = spyConsole();
    const added = await add();
    expect(added.status).toBe(201);
    const view = (await added.json()) as DestinationView;
    expect(view).toEqual({
      id: expect.any(String),
      kind: 'ifs',
      name: 'Output folder',
      builtin: false,
      jobs: [],
      // The trailing slash is dropped; the choices take their defaults.
      config: { folder: '/home/docs/out', ifExists: 'replace', keepCopy: true },
    });
    expect((await all()).map((d) => d.name)).toEqual(['Output folder', 'Spooldoc download']);

    const changed = await change(view.id, { name: 'Archive', config: { folder: '/home/docs/archive', ifExists: 'suffix', keepCopy: false } });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({ name: 'Archive', config: { folder: '/home/docs/archive', ifExists: 'suffix', keepCopy: false } });
    const [row] = await db().select().from(destinations).where(eq(destinations.id, view.id));
    expect(row).toMatchObject({ kind: 'ifs', name: 'Archive', config: { folder: '/home/docs/archive', ifExists: 'suffix', keepCopy: false } });

    expect((await remove(view.id)).status).toBe(204);
    expect((await all()).map((d) => d.name)).toEqual(['Spooldoc download']);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ['a relative folder', 'home/docs', 'Enter a folder that starts with /, such as /home/docs/out'],
    ['an empty folder', ' ', 'Enter the folder'],
    ['the root', '/', 'Pick a folder below /'],
    ['a .. part', '/home/docs/../etc', 'Enter the folder without . or .. parts'],
    ['the library file system', '/QSYS.LIB/MYLIB.LIB', 'Pick a folder outside /QSYS.LIB; it holds libraries, not files'],
    ['the library file system in lower case', '/qsys.lib', 'Pick a folder outside /QSYS.LIB; it holds libraries, not files'],
  ])('refuses %s', async (_, folder, message) => {
    const response = await add({ ...input, config: { folder } });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(`${message}.`);
  });

  it('refuses a kind that cannot be added and a choice it does not know', async () => {
    expect((await add({ ...input, kind: 'spooldoc' })).status).toBe(400);
    expect((await add({ ...input, kind: 'ftp' })).status).toBe(400);
    expect((await add({ ...input, config: { folder: '/home/docs/out', ifExists: 'ask' } })).status).toBe(400);
    expect((await add({ ...input, name: '' })).status).toBe(400);
  });

  it('keeps the built-in destination as it is', async () => {
    const id = await builtinDestination();
    const changed = await change(id, { name: 'Mine' });
    expect(changed.status).toBe(400);
    expect((await changed.json()).error).toBe('Spooldoc download is built in. It cannot be changed or deleted.');
    expect((await remove(id)).status).toBe(400);
    expect((await all()).map((d) => d.name)).toEqual(['Spooldoc download']);
  });

  it('answers 404 for an unknown or malformed id', async () => {
    expect((await remove('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await change('nope', { name: 'x' })).status).toBe(404);
  });

  it('refuses to delete a destination a draft delivers to, and lists the job', async () => {
    const { id } = (await (await add()).json()) as DestinationView;
    const serverId = await insertServer();
    const jobId = await insertJob(serverId);
    const [row] = await db().select().from(jobs).where(eq(jobs.id, jobId));
    await db().update(jobs).set({ draft: { ...row!.draft, destination: { destinationId: id, email: null, webhook: null } } }).where(eq(jobs.id, jobId));

    const refused = await remove(id);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error: 'Jobs deliver to this destination: Invoices. Change or delete them first.',
      jobs: [{ id: jobId, name: 'Invoices' }],
    });
    expect((await all()).find((d) => d.id === id)?.jobs).toEqual([{ id: jobId, name: 'Invoices', mode: 'manual', paused: false, activeVersion: null }]);
  });

  it('refuses to delete a destination only a saved version delivers to', async () => {
    const { id } = (await (await add()).json()) as DestinationView;
    const jobId = await insertJob(await insertServer());
    const [row] = await db().select().from(jobs).where(eq(jobs.id, jobId));
    // The draft moved on to the built-in destination; version 1 still delivers to the IFS.
    await db().insert(jobVersions).values({ jobId, number: 1, spec: { ...row!.draft, destination: { destinationId: id, email: null, webhook: null } } });

    const refused = await remove(id);
    expect(refused.status).toBe(409);
    expect((await refused.json()).jobs).toEqual([{ id: jobId, name: 'Invoices' }]);
    const views = await all();
    expect(views.find((d) => d.id === id)?.jobs).toMatchObject([{ id: jobId, name: 'Invoices' }]);
    expect(views.find((d) => d.builtin)?.jobs).toMatchObject([{ id: jobId, name: 'Invoices' }]);
  });
});

describe('webhook destinations', () => {
  const hook = { kind: 'webhook', name: 'MYHOOK', config: { url: 'https://hooks.example.com/spooldoc' }, headers: [{ name: 'Authorization', value: 'Bearer Header-Secret-456' }] };
  type Revealed = DestinationView & { revealedSecret?: string };

  beforeEach(async () => {
    await resetTables(db());
    auth = await signedIn();
  });

  it('reveal the signing secret once, on add, and keep it and the header values out of every view', async () => {
    const added = await add(hook);
    expect(added.status).toBe(201);
    const view = (await added.json()) as Revealed;
    expect(view.revealedSecret).toMatch(/^whsec_/);
    expect(view.config).toEqual({ url: 'https://hooks.example.com/spooldoc', testUrl: null, headers: [{ name: 'Authorization' }], hasSecret: true });
    const listed = (await all()).find((d) => d.id === view.id) as Revealed;
    expect(listed.revealedSecret).toBeUndefined();
    expect(JSON.stringify(await all())).not.toContain(view.revealedSecret!);
    expect(JSON.stringify(await all())).not.toContain('Header-Secret-456');
    const [row] = await db().select().from(destinations).where(eq(destinations.id, view.id));
    expect(row!.secretsEnc).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toContain('Header-Secret-456');
  });

  it('rotate the secret, answering with the new one', async () => {
    const { id, revealedSecret } = (await (await add(hook)).json()) as Revealed;
    const rotated = (await (await change(id, { rotateSecret: true })).json()) as Revealed;
    expect(rotated.revealedSecret).toMatch(/^whsec_/);
    expect(rotated.revealedSecret).not.toBe(revealedSecret);
    const renamed = (await (await change(id, { name: 'Orders hook' })).json()) as Revealed;
    expect(renamed.revealedSecret).toBeUndefined();
    expect(renamed.config).toMatchObject({ headers: [{ name: 'Authorization' }], hasSecret: true });
  });

  it('keep a header value given as null, replace one given, and remove one left out', async () => {
    const { id } = (await (await add({ ...hook, headers: [...hook.headers, { name: 'X-Tenant', value: 'tenant-1' }] })).json()) as Revealed;
    const { openWebhookSecrets } = await import('@/lib/server/destinations/webhook');
    const saved = async () => openWebhookSecrets((await db().select().from(destinations).where(eq(destinations.id, id)))[0]!.secretsEnc).headers;
    const kept = await change(id, { headers: [{ name: 'Authorization', value: null }, { name: 'X-Api-Key', value: 'key-789' }] });
    expect(kept.status).toBe(200);
    expect(await saved()).toEqual([
      { name: 'Authorization', value: 'Bearer Header-Secret-456' },
      { name: 'X-Api-Key', value: 'key-789' },
    ]);
    expect((await change(id, { headers: [{ name: 'X-Api-Key', value: 'key-000' }] })).status).toBe(200);
    expect(await saved()).toEqual([{ name: 'X-Api-Key', value: 'key-000' }]);
    const unknown = await change(id, { headers: [{ name: 'X-New', value: null }] });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toBe('Enter the header value.');
  });

  it.each([
    ['a URL without a scheme', { url: 'hooks.example.com/spooldoc' }, 'Enter a full URL, such as https://hooks.example.com/spooldoc.'],
    ['an FTP URL', { url: 'ftp://hooks.example.com/' }, 'Enter a URL that starts with https:// or http://.'],
    ['a user and password', { url: 'https://me:pw@hooks.example.com/' }, 'Enter the URL without a user name or password. Send credentials in a header.'],
    ['a # part', { url: 'https://hooks.example.com/#x' }, 'Enter the URL without a # part; it is not sent.'],
    ['a bad test URL', { url: 'https://hooks.example.com/', testUrl: 'mailto:you@example.com' }, 'Enter a URL that starts with https:// or http://.'],
  ])('refuse %s', async (_, config, message) => {
    const response = await add({ ...hook, config });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(message);
  });

  it.each(['Host', 'content-type', 'Content-Length', 'User-Agent', 'webhook-signature', 'Webhook-Id'])('refuse the header %s, which Spooldoc sets', async (name) => {
    const response = await add({ ...hook, headers: [{ name, value: 'x' }] });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/^Pick another header name\./);
  });

  it('refuse a header name with spaces, a value on two lines, and the same name twice', async () => {
    expect((await add({ ...hook, headers: [{ name: 'X Key', value: 'x' }] })).status).toBe(400);
    expect((await add({ ...hook, headers: [{ name: 'X-Key', value: 'a\r\nb' }] })).status).toBe(400);
    expect((await add({ ...hook, headers: [{ name: 'X-Key', value: 'a' }, { name: 'x-key', value: 'b' }] })).status).toBe(400);
  });

  it('take a test URL, and drop it when it is empty', async () => {
    const { id } = (await (await add({ ...hook, config: { url: 'https://hooks.example.com/spooldoc', testUrl: 'https://inspect.example.com/abc' } })).json()) as Revealed;
    const cleared = (await (await change(id, { config: { url: 'https://hooks.example.com/spooldoc', testUrl: '' } })).json()) as Revealed;
    expect(cleared.config).toMatchObject({ testUrl: null });
  });
});
