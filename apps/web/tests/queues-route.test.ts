import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueView, SpooledFileView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { resetTables } from './helpers/db';
import { FakeConnection, loadSample } from './helpers/fake-connection';
import { db, insertServer } from './helpers/fixtures';
import { appRequest, connections, params } from './helpers/mocks';

vi.mock('@spooldoc/ibmi/jt400', async () => (await import('./helpers/mocks')).fakeJt400);

const queuesRoute = await import('@/app/api/servers/[id]/queues/route');
const prefsRoute = await import('@/app/api/servers/[id]/queue-prefs/route');
const filesRoute = await import('@/app/api/servers/[id]/queues/[lib]/[name]/files/route');
const realtimeRoute = await import('@/app/api/servers/[id]/queues/[lib]/[name]/realtime/route');
const { getServerRow } = await import('@/lib/server/servers');

const sample = loadSample('invoice');
const { library, name: queue } = sample.attributes.queue;
let auth: Record<string, string>;
let serverId: string;
let conn: FakeConnection;

const list = async (query = '') =>
  (await (await queuesRoute.GET(appRequest(`/api/servers/${serverId}/queues${query}`, { headers: auth }), params({ id: serverId }))).json()) as {
    queues: QueueView[];
  };

beforeEach(async () => {
  await resetTables(db());
  connections.clear();
  conn = new FakeConnection();
  connections.set('ibmi.example.com|DEMOUSER', conn);
  auth = await signedIn();
  serverId = await insertServer();
});

describe('queues', () => {
  it('hides and unhides queues, and leaves hidden ones out with visible=1', async () => {
    const before = await list();
    expect(before.queues.length).toBeGreaterThan(1);
    expect(before.queues.every((q) => !q.hidden)).toBe(true);

    const hide = await prefsRoute.PUT(
      appRequest(`/api/servers/${serverId}/queue-prefs`, { method: 'PUT', body: { queues: [{ library, name: queue, hidden: true }] }, headers: auth }),
      params({ id: serverId }),
    );
    expect(hide.status).toBe(204);
    expect((await list()).queues.find((q) => q.name === queue)?.hidden).toBe(true);
    expect((await list('?visible=1')).queues.some((q) => q.name === queue)).toBe(false);

    await prefsRoute.PUT(
      appRequest(`/api/servers/${serverId}/queue-prefs`, { method: 'PUT', body: { queues: [{ library, name: queue, hidden: false }] }, headers: auth }),
      params({ id: serverId }),
    );
    expect((await list('?visible=1')).queues.some((q) => q.name === queue)).toBe(true);
  });

  it("lists only the server's libraries", async () => {
    await db().update((await import('@/lib/server/db/schema')).servers).set({ libraries: ['NOSUCHLIB'] });
    expect((await list()).queues).toEqual([]);
    const call = conn.calls.find((c) => c.method === 'listOutputQueues');
    expect(call?.args[0]).toMatchObject({ libraries: ['NOSUCHLIB'] });
  });

  it('lists the spooled files of a queue with a status filter', async () => {
    const files = async (query: string) =>
      (
        (await (
          await filesRoute.GET(appRequest(`/api/servers/${serverId}/queues/${library}/${queue}/files${query}`, { headers: auth }), params({ id: serverId, lib: library, name: queue }))
        ).json()) as { files: SpooledFileView[] }
      ).files;
    expect((await files('')).length).toBeGreaterThan(0);
    expect(await files('?status=READY')).toEqual([]);
  });
});

describe('real-time set-up', () => {
  const setup = (body: unknown = {}) =>
    realtimeRoute.POST(
      appRequest(`/api/servers/${serverId}/queues/${library}/${queue}/realtime`, { method: 'POST', body, headers: auth }),
      params({ id: serverId, lib: library, name: queue }),
    );

  it('creates the data queue, attaches it and saves it on the server', async () => {
    const response = await setup();
    expect(response.status).toBe(200);
    const commands = conn.calls.filter((c) => c.method === 'runCommand').map((c) => c.args[0]);
    expect(commands).toEqual([
      `CRTDTAQ DTAQ(${library}/SPOOLDOC) MAXLEN(256) TEXT('Spooldoc: spooled files ready')`,
      `CHGOUTQ OUTQ(${library}/${queue}) DTAQ(${library}/SPOOLDOC)`,
    ]);
    expect((await getServerRow(serverId))?.dtaqName).toBe('SPOOLDOC');
  });

  it('goes on when the data queue exists already', async () => {
    conn.commandResult = (command) =>
      command.startsWith('CRTDTAQ') ? { ok: false, messages: [{ id: 'CPF9870', text: 'Object already exists.' }] } : { ok: true, messages: [] };
    expect((await setup()).status).toBe(200);
  });

  it('answers with the commands for an operator without authority', async () => {
    conn.commandResult = () => ({ ok: false, messages: [{ id: 'CPF2189', text: 'Not authorized to object.' }] });
    const response = await setup();
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.commands).toHaveLength(2);
    expect((await getServerRow(serverId))?.dtaqName).toBeNull();
  });

  it('leaves a queue that sends to another data queue alone, unless told to use it', async () => {
    conn.dataQueues.set(`${library}/${queue}`, { library, name: 'SPLFDTAQ' });
    const refused = await setup();
    expect(refused.status).toBe(409);
    expect(conn.calls.some((c) => c.method === 'runCommand')).toBe(false);

    expect((await setup({ adopt: true })).status).toBe(200);
    expect((await getServerRow(serverId))?.dtaqName).toBe('SPLFDTAQ');
  });
});
