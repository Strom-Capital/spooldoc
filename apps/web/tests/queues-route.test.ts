import { ConnectionError } from '@spooldoc/ibmi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { samples, servers } from '@/lib/server/db/schema';
import type { QueueCountView, QueueView, SpooledFileView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { resetTables } from './helpers/db';
import { FakeConnection, GOOD_PASSWORD, loadSample } from './helpers/fake-connection';
import { db, insertServer } from './helpers/fixtures';
import { appRequest, connections, fakeJt400, params } from './helpers/mocks';

vi.mock('@spooldoc/ibmi/jt400', async () => (await import('./helpers/mocks')).fakeJt400);

const queuesRoute = await import('@/app/api/servers/[id]/queues/route');
const prefsRoute = await import('@/app/api/servers/[id]/queue-prefs/route');
const countsRoute = await import('@/app/api/servers/[id]/queue-counts/route');
const filesRoute = await import('@/app/api/servers/[id]/queues/[lib]/[name]/files/route');
const viewRoute = await import('@/app/api/servers/[id]/queues/[lib]/[name]/files/view/route');
const realtimeRoute = await import('@/app/api/servers/[id]/queues/[lib]/[name]/realtime/route');
const pollingRoute = await import('@/app/api/servers/[id]/queues/[lib]/[name]/polling/route');
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
    await db().update(servers).set({ libraries: ['NOSUCHLIB'] });
    expect((await list()).queues).toEqual([]);
    const call = conn.calls.find((c) => c.method === 'listOutputQueues');
    expect(call?.args[0]).toMatchObject({ libraries: ['NOSUCHLIB'] });
  });

  it('counts the ready and held files of each queue in the server\'s libraries', async () => {
    const counts = async () =>
      (
        (await (await countsRoute.GET(appRequest(`/api/servers/${serverId}/queue-counts`, { headers: auth }), params({ id: serverId }))).json()) as {
          counts: QueueCountView[];
        }
      ).counts;
    const s = sample.splf;
    conn.status.set(`${s.name}/${s.number}/${s.jobNumber}/${s.jobUser}/${s.jobName}`, 'READY');
    const before = (await counts()).find((c) => c.library === library && c.name === queue);
    const onQueue = conn.samples.filter((x) => x.attributes.queue.library === library && x.attributes.queue.name === queue).length;
    expect(before).toEqual({ library, name: queue, ready: 1, held: onQueue - 1 });

    // Saved and other statuses are not asked for.
    expect(conn.calls.find((c) => c.method === 'countSpooledFiles')?.args[0]).toMatchObject({ status: ['READY', 'HELD'] });

    await db().update(servers).set({ libraries: ['NOSUCHLIB'] });
    expect(await counts()).toEqual([]);
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

  it('says when the list of spooled files was cut off', async () => {
    const answer = async (query: string) =>
      (await (
        await filesRoute.GET(appRequest(`/api/servers/${serverId}/queues/${library}/${queue}/files${query}`, { headers: auth }), params({ id: serverId, lib: library, name: queue }))
      ).json()) as { files: SpooledFileView[]; more: boolean };
    const first = await answer('');
    // Three more files on the queue than the fixtures have.
    for (const number of [101, 102, 103]) conn.samples.push({ ...sample, splf: { ...sample.splf, number } });
    const total = first.files.length + 3;

    expect(await answer(`?limit=${total - 1}`)).toMatchObject({ more: true, files: { length: total - 1 } });
    expect(await answer(`?limit=${total}`)).toMatchObject({ more: false, files: { length: total } });
    // One more than shown is asked for, to know; the default is 200 and the most 5000.
    const limits = () => conn.calls.filter((c) => c.method === 'listSpooledFiles').map((c) => (c.args[1] as { limit: number }).limit);
    await answer('');
    await answer('?limit=999999');
    expect(limits().slice(-2)).toEqual([201, 5001]);
  });
});

describe('IBM i errors', () => {
  it('answer with what to do, the message ID and the system\'s own text, without the password', async () => {
    conn.failures.set(
      'listSpooledFiles',
      new ConnectionError('notfound', `Output queue ${library}/${queue} does not exist on ibmi.example.com. Point the job's source at another queue. (CPF2105)`, {
        messageId: 'CPF2105',
        detail: `CPF2105 Object ${queue} in ${library} type *OUTQ not found. ${GOOD_PASSWORD}`,
      }),
    );
    const response = await filesRoute.GET(
      appRequest(`/api/servers/${serverId}/queues/${library}/${queue}/files`, { headers: auth }),
      params({ id: serverId, lib: library, name: queue }),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: `Output queue ${library}/${queue} does not exist on ibmi.example.com. Point the job's source at another queue. (CPF2105)`,
      code: 'notfound',
      messageId: 'CPF2105',
      detail: `CPF2105 Object ${queue} in ${library} type *OUTQ not found. ***`,
    });
    // An error about one queue says nothing about the server.
    expect(await getServerRow(serverId)).toMatchObject({ lastError: null, errorCode: null });
  });

  it('show on the server when it cannot be reached, since when, and that it works again', async () => {
    const reason = 'The connection to ibmi.example.com dropped. Spooldoc connects again on the next try. If it keeps failing, check the network or VPN to ibmi.example.com.';
    conn.failures.set('listOutputQueues', new ConnectionError('host', reason));
    const failed = await queuesRoute.GET(appRequest(`/api/servers/${serverId}/queues`, { headers: auth }), params({ id: serverId }));
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ error: reason, code: 'host' });
    const row = await getServerRow(serverId);
    expect(row).toMatchObject({ lastError: reason, errorCode: 'host', errorSince: expect.any(Date) });

    // A second failure keeps the time of the first.
    await queuesRoute.GET(appRequest(`/api/servers/${serverId}/queues`, { headers: auth }), params({ id: serverId }));
    expect((await getServerRow(serverId))!.errorSince).toEqual(row!.errorSince);

    conn.failures.delete('listOutputQueues');
    const worked = await queuesRoute.GET(appRequest(`/api/servers/${serverId}/queues`, { headers: auth }), params({ id: serverId }));
    expect(worked.status).toBe(200);
    expect(await getServerRow(serverId)).toMatchObject({ lastError: null, errorCode: null, errorSince: null });
  });

  it('do not sign on again after a failed sign-on, until the user acts', async () => {
    const reason = 'ibmi.example.com did not accept the password for DEMOUSER. Check it on the Servers page; repeated wrong passwords can disable the profile.';
    await db().update(servers).set({ lastError: reason, errorCode: 'auth', errorSince: new Date() });
    connections.clear();
    fakeJt400.getConnection.mockClear();
    const response = await queuesRoute.GET(appRequest(`/api/servers/${serverId}/queues`, { headers: auth }), params({ id: serverId }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: `${reason} Spooldoc does not sign on again until you edit the password or press Reconnect on the Servers page.`,
      code: 'auth',
    });
    expect(fakeJt400.getConnection).not.toHaveBeenCalled();
  });
});

describe('viewing a spooled file', () => {
  const view = (lib: string, name: string, query: Record<string, string | number>) =>
    viewRoute.GET(
      appRequest(`/api/servers/${serverId}/queues/${lib}/${name}/files/view?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}`, { headers: auth }),
      params({ id: serverId, lib, name }),
    );
  const id = { splf: sample.splf.name, number: sample.splf.number, jobName: sample.splf.jobName, jobUser: sample.splf.jobUser, jobNumber: sample.splf.jobNumber };

  it('reads the pages without storing or changing anything', async () => {
    const response = await view(library, queue, id);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sample: { pages: unknown[]; splf: { name: string } } };
    expect(body.sample.pages.length).toBe(sample.pages.length);
    expect(body.sample.splf.name).toBe(sample.splf.name);
    expect(await db().select().from(samples)).toEqual([]);
    expect(conn.actions()).toEqual([]);
  });

  it('refuses a file of another queue, a missing file and a bad request', async () => {
    expect((await view(library, 'OTHERQ', id)).status).toBe(404);
    expect((await view(library, queue, { ...id, number: 999 })).status).toBe(404);
    expect((await view(library, queue, { splf: 'X' })).status).toBe(400);
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
    expect((await getServerRow(serverId))?.dtaqOwned).toBe(true);
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
    expect((await getServerRow(serverId))?.dtaqOwned).toBe(false);
  });

  it('refuses to adopt while other queues still send to the data queue Spooldoc reads', async () => {
    const other = (await conn.listOutputQueues()).find((q) => !(q.library === library && q.name === queue));
    if (!other) throw new Error('The fake needs a second queue.');
    await db().update(servers).set({ dtaqLibrary: library, dtaqName: 'SPOOLDOC', dtaqOwned: true });
    conn.dataQueues.set(`${other.library}/${other.name}`, { library, name: 'SPOOLDOC' });
    conn.dataQueues.set(`${library}/${queue}`, { library, name: 'SPLFDTAQ' });

    const refused = await setup({ adopt: true });
    expect(refused.status).toBe(409);
    expect((await refused.json()).queues).toEqual([{ library: other.library, name: other.name }]);
    expect((await getServerRow(serverId))?.dtaqName).toBe('SPOOLDOC');
    expect((await getServerRow(serverId))?.dtaqOwned).toBe(true);

    conn.dataQueues.delete(`${other.library}/${other.name}`);
    expect((await setup({ adopt: true })).status).toBe(200);
    expect((await getServerRow(serverId))?.dtaqName).toBe('SPLFDTAQ');
    expect((await getServerRow(serverId))?.dtaqOwned).toBe(false);
  });
});

describe('switch to polling', () => {
  const toPolling = () =>
    pollingRoute.POST(
      appRequest(`/api/servers/${serverId}/queues/${library}/${queue}/polling`, { method: 'POST', body: {}, headers: auth }),
      params({ id: serverId, lib: library, name: queue }),
    );

  it("detaches the queue from a data queue Spooldoc created, and keeps reading it for other queues", async () => {
    await db().update(servers).set({ dtaqLibrary: library, dtaqName: 'SPOOLDOC', dtaqOwned: true });
    const response = await toPolling();
    expect(await response.json()).toEqual({ ok: true, change: 'detached' });
    expect(conn.calls.filter((c) => c.method === 'runCommand').map((c) => c.args[0])).toEqual([`CHGOUTQ OUTQ(${library}/${queue}) DTAQ(*NONE)`]);
    expect((await getServerRow(serverId))?.dtaqName).toBe('SPOOLDOC');
  });

  it('stops reading a data queue that was there before, without touching the output queue', async () => {
    await db().update(servers).set({ dtaqLibrary: library, dtaqName: 'SPLFDTAQ', dtaqOwned: false });
    const response = await toPolling();
    expect(await response.json()).toEqual({ ok: true, change: 'stopped-reading' });
    expect(conn.calls.some((c) => c.method === 'runCommand')).toBe(false);
    expect((await getServerRow(serverId))?.dtaqName).toBeNull();
  });

  it('answers with the command for an operator without authority', async () => {
    await db().update(servers).set({ dtaqLibrary: library, dtaqName: 'SPOOLDOC', dtaqOwned: true });
    conn.commandResult = () => ({ ok: false, messages: [{ id: 'CPF2189', text: 'Not authorized to object.' }] });
    const response = await toPolling();
    expect(response.status).toBe(403);
    expect((await response.json()).commands).toEqual([`CHGOUTQ OUTQ(${library}/${queue}) DTAQ(*NONE)`]);
  });
});
