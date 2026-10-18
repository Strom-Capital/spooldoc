import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { servers } from '@/lib/server/db/schema';
import { signedIn } from './helpers/auth';
import { resetTables } from './helpers/db';
import { GOOD_PASSWORD } from './helpers/fake-connection';
import { db, insertJob } from './helpers/fixtures';
import { appRequest, connections, params, spyConsole } from './helpers/mocks';

vi.mock('@spooldoc/ibmi/jt400', async () => (await import('./helpers/mocks')).fakeJt400);

const list = await import('@/app/api/servers/route');
const one = await import('@/app/api/servers/[id]/route');
const test = await import('@/app/api/servers/[id]/test/route');

let auth: Record<string, string>;
const input = { name: 'Production', host: 'ibmi.example.com', user: 'demouser', password: GOOD_PASSWORD, libraries: ['mylib', 'MYLIB', 'qgpl'] };

async function addServer(body: Record<string, unknown> = input) {
  return list.POST(appRequest('/api/servers', { method: 'POST', body, headers: auth }));
}

describe('/api/servers', () => {
  beforeEach(async () => {
    await resetTables(db());
    connections.clear();
    auth = await signedIn();
  });

  it('answers 401 without a signed-in user', async () => {
    const response = await list.GET(appRequest('/api/servers'));
    expect(response.status).toBe(401);
  });

  it('signs on, stores the password encrypted and never returns it', async () => {
    const spies = spyConsole();
    const response = await addServer();
    const text = await response.text();
    expect(response.status).toBe(201);
    expect(text).not.toContain(GOOD_PASSWORD);
    const body = JSON.parse(text);
    expect(body).toMatchObject({ name: 'Production', user: 'DEMOUSER', libraries: ['MYLIB', 'QGPL'], vrm: 'V7R5', ccsid: 273, lastError: null });

    const [row] = await db().select().from(servers).where(eq(servers.id, body.id));
    expect(row!.passwordEnc).not.toContain(GOOD_PASSWORD);
    expect(row!.passwordEnc).toMatch(/^v1\./);

    const listed = await (await list.GET(appRequest('/api/servers', { headers: auth }))).text();
    expect(listed).not.toContain(GOOD_PASSWORD);
    expect(listed).not.toContain('passwordEnc');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a wrong password with 422 and saves nothing', async () => {
    const response = await addServer({ ...input, password: 'Wrong-Secret-42' });
    const text = await response.text();
    expect(response.status).toBe(422);
    expect(text).toMatch(/Password is incorrect/);
    expect(text).not.toContain('Wrong-Secret-42');
    expect(await db().select().from(servers)).toEqual([]);
  });

  it('refuses a library that is not an IBM i name', async () => {
    const response = await addServer({ ...input, libraries: ['MY LIB'] });
    expect(response.status).toBe(400);
  });

  it('changes the name and libraries without a password and keeps the password', async () => {
    const { id } = await (await addServer()).json();
    const before = (await db().select().from(servers))[0]!.passwordEnc;
    const response = await one.PATCH(appRequest(`/api/servers/${id}`, { method: 'PATCH', body: { name: 'Test', libraries: [] }, headers: auth }), params({ id }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: 'Test', libraries: [] });
    expect((await db().select().from(servers))[0]!.passwordEnc).toBe(before);
  });

  it('signs on again when the password changes and refuses a wrong one', async () => {
    const { id } = await (await addServer()).json();
    const response = await one.PATCH(appRequest(`/api/servers/${id}`, { method: 'PATCH', body: { password: 'nope-nope' }, headers: auth }), params({ id }));
    expect(response.status).toBe(422);
  });

  it('tests the sign-on and records the result', async () => {
    const { id } = await (await addServer()).json();
    const response = await test.POST(appRequest(`/api/servers/${id}/test`, { method: 'POST', headers: auth }), params({ id }));
    expect(response.status).toBe(200);
    expect((await response.json()).lastCheckedAt).toBeTruthy();
  });

  it('refuses to delete a server a job reads from, and deletes it otherwise', async () => {
    const { id } = await (await addServer()).json();
    const jobId = await insertJob(id);
    const refused = await one.DELETE(appRequest(`/api/servers/${id}`, { method: 'DELETE', headers: auth }), params({ id }));
    expect(refused.status).toBe(409);
    expect((await refused.json()).jobs).toEqual([{ id: jobId, name: 'Invoices' }]);

    const other = (await (await addServer({ ...input, name: 'Other' })).json()).id;
    const deleted = await one.DELETE(appRequest(`/api/servers/${other}`, { method: 'DELETE', headers: auth }), params({ id: other }));
    expect(deleted.status).toBe(204);
  });

  it('answers 404 for an unknown or malformed id', async () => {
    const response = await one.GET(appRequest('/api/servers/nope', { headers: auth }), params({ id: 'nope' }));
    expect(response.status).toBe(404);
  });
});
