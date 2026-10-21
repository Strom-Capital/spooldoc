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
    await db().update(jobs).set({ draft: { ...row!.draft, destination: { destinationId: id, email: null } } }).where(eq(jobs.id, jobId));

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
    await db().insert(jobVersions).values({ jobId, number: 1, spec: { ...row!.draft, destination: { destinationId: id, email: null } } });

    const refused = await remove(id);
    expect(refused.status).toBe(409);
    expect((await refused.json()).jobs).toEqual([{ id: jobId, name: 'Invoices' }]);
    const views = await all();
    expect(views.find((d) => d.id === id)?.jobs).toMatchObject([{ id: jobId, name: 'Invoices' }]);
    expect(views.find((d) => d.builtin)?.jobs).toMatchObject([{ id: jobId, name: 'Invoices' }]);
  });
});
