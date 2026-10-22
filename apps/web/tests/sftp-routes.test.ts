import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SftpConfig } from '@/lib/destination-config';
import { emptySpec, type JobSpec } from '@/lib/job-spec';
import { destinations, jobs, runDeliveries } from '@/lib/server/db/schema';
import { openSftpSecrets, sealSftpSecrets } from '@/lib/server/destinations/sftp';
import { storeSample } from '@/lib/server/samples';
import { hostKeyInfo } from '@/lib/server/sftp';
import { outcomes } from '@/lib/server/sftp-folder';
import type { DestinationView, SftpCheckView, SftpFolderView, SftpKeyView, SftpUploadTestView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { resetTables } from './helpers/db';
import { fixtureText, loadSample } from './helpers/fake-connection';
import { db, insertServer } from './helpers/fixtures';
import { appRequest, params } from './helpers/mocks';
import { TestSftpServer } from './helpers/sftp-server';

const keyRoute = await import('@/app/api/destinations/sftp-key/route');
const checkRoute = await import('@/app/api/destinations/sftp-check/route');
const list = await import('@/app/api/destinations/route');
const one = await import('@/app/api/destinations/[id]/route');
const folderRoute = await import('@/app/api/jobs/[id]/sftp-folder/route');
const testRoute = await import('@/app/api/jobs/[id]/sftp-test/route');

const PASSWORD = 'Sftp-Password-789';
let auth: Record<string, string>;
let server: TestSftpServer;

const post = (path: string, route: { POST(request: Request): Promise<Response> }, body: unknown) => route.POST(appRequest(path, { method: 'POST', body, headers: auth }));
const makeKey = async (type = 'ed25519') => (await (await post('/api/destinations/sftp-key', keyRoute, { type, name: 'Invoices to bank' })).json()) as SftpKeyView;
const check = async (body: unknown) => {
  const response = await post('/api/destinations/sftp-check', checkRoute, body);
  return { status: response.status, view: (await response.json()) as SftpCheckView & { error?: string } };
};
const add = (body: unknown) => list.POST(appRequest('/api/destinations', { method: 'POST', body, headers: auth }));
const change = (id: string, body: unknown) => one.PATCH(appRequest(`/api/destinations/${id}`, { method: 'PATCH', body, headers: auth }), params({ id }));

const config = (change: Partial<SftpConfig> = {}) => ({
  host: '127.0.0.1',
  port: server.port,
  username: 'MYUSER',
  auth: 'spooldoc-key',
  folder: '/in/invoices',
  testFolder: null,
  ifExists: 'replace',
  keepCopy: true,
  tempName: true,
  ...change,
});

beforeEach(async () => {
  await resetTables(db());
  auth = await signedIn();
  server = await new TestSftpServer({ password: PASSWORD }).folder('/in/invoices').folder('/test/in').start();
  server.file('/in/invoices/invoice-260099.pdf');
});

afterEach(async () => {
  await server.stop();
});

describe('sftp-key', () => {
  it('makes a key, and hands the page the private key only sealed', async () => {
    const key = await makeKey();
    expect(key.publicKey).toMatch(/^ssh-ed25519 AAAA\S+ spooldoc Invoices to bank$/);
    expect(key.key).toMatchObject({ type: 'ED25519', bits: 256 });
    expect(key.sealed).toMatch(/^v1\./);
    expect(JSON.stringify(key)).not.toContain('PRIVATE KEY');
  });
});

// These sign in over real SSH, in pure JS: slower than a unit test on a busy CI runner.
describe('sftp-check', { timeout: 30_000 }, () => {
  it('stops at a new host key before the sign-in, then checks every line once the key is trusted, and writes nothing', async () => {
    const key = await makeKey();
    server.options.publicKey = key.publicKey;
    const before = new Map([...server.files].map(([path, node]) => [path, node.data.toString()]));

    const first = await check({ config: config(), sealedKey: key.sealed });
    expect(first.status).toBe(200);
    expect(first.view.stages.map((s) => [s.stage, s.status])).toEqual([
      ['reach', 'ok'],
      ['hostKey', 'new'],
    ]);
    expect(first.view.stages[0]).toMatchObject({ text: `Reached 127.0.0.1 on port ${server.port}`, ms: expect.any(Number) });
    const fingerprint = hostKeyInfo(Buffer.from(server.hostKeyBlob, 'base64')).fingerprint;
    expect(first.view.hostKey).toMatchObject({ state: 'new', type: 'ED25519', bits: 256, fingerprint, token: expect.any(String) });
    expect(first.view.compare).toBe('ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub');
    // Nothing was sent to sign in.
    expect(server.signIns).toEqual([]);

    const second = await check({ config: config({ testFolder: '/test/in' }), sealedKey: key.sealed, trust: first.view.hostKey!.token });
    expect(second.view.stages.map((s) => [s.stage, s.status, s.text])).toEqual([
      ['reach', 'ok', `Reached 127.0.0.1 on port ${server.port}`],
      ['hostKey', 'ok', `Trusted ED25519 key ${fingerprint}`],
      ['signIn', 'ok', 'Signed in as MYUSER with the key'],
      ['folder', 'ok', 'Found /in/invoices, 1 file'],
      ['testFolder', 'ok', 'Found /test/in, empty'],
    ]);
    expect(second.view.trusted).toMatchObject({ fingerprint, token: expect.any(String) });

    expect(new Map([...server.files].map(([path, node]) => [path, node.data.toString()]))).toEqual(before);
    expect(server.log.some((line) => /^(OPEN |RENAME|POSIX-RENAME|REMOVE)/.test(line))).toBe(false);
  });

  it('shows both fingerprints when the host key changed', async () => {
    const first = await check({ config: config({ auth: 'password' }), secrets: { password: PASSWORD } });
    const token = first.view.hostKey!.token;
    const trustedFingerprint = first.view.hostKey!.fingerprint;
    await server.swapHostKey();
    const second = await check({ config: config({ auth: 'password' }), secrets: { password: PASSWORD }, trust: token });
    expect(second.view.stages.at(-1)).toMatchObject({ stage: 'hostKey', status: 'changed' });
    expect(second.view.hostKey).toMatchObject({ state: 'changed', trustedFingerprint, fingerprint: hostKeyInfo(Buffer.from(server.hostKeyBlob, 'base64')).fingerprint });
    expect(server.signIns).toEqual([]);
  });

  it('says what failed on each line: the sign-in and a missing folder', async () => {
    const trust = (await check({ config: config({ auth: 'password' }), secrets: { password: PASSWORD } })).view.hostKey!.token;
    const wrong = await check({ config: config({ auth: 'password' }), secrets: { password: 'Wrong-Password-1' }, trust });
    expect(wrong.view.stages.at(-1)).toMatchObject({ stage: 'signIn', status: 'failed', text: '127.0.0.1 did not accept the password for MYUSER. Check the user and the password.' });
    expect(JSON.stringify(wrong.view)).not.toContain('Wrong-Password-1');

    const missing = await check({ config: config({ auth: 'password', folder: '/in/missing' }), secrets: { password: PASSWORD }, trust });
    expect(missing.view.stages.at(-1)).toMatchObject({
      stage: 'folder',
      status: 'failed',
      text: "The folder /in/missing does not exist on 127.0.0.1. Create it, or change the destination's folder.",
    });
  });

  it('says when the host cannot be reached', async () => {
    const { port } = server;
    await server.stop();
    const result = await check({ config: config({ auth: 'password', port }), secrets: { password: PASSWORD } });
    expect(result.view.stages).toEqual([
      { stage: 'reach', status: 'failed', text: `127.0.0.1 refused the connection on port ${port}. Check the port, and that the SSH server runs.`, detail: expect.stringContaining('ECONNREFUSED') },
    ]);
  });
});

describe('adding and changing an SFTP destination', () => {
  async function trustToken(port = server.port) {
    return (await check({ config: config({ auth: 'password', port }), secrets: { password: PASSWORD } })).view.hostKey!.token;
  }

  it('saves the key Spooldoc made and the host key from the check, and shows neither secret', async () => {
    const key = await makeKey();
    const response = await add({ kind: 'sftp', name: 'MYSFTP', config: config(), sealedKey: key.sealed, hostKeyToken: await trustToken() });
    expect(response.status).toBe(201);
    const view = (await response.json()) as Extract<DestinationView, { kind: 'sftp' }>;
    expect(view.config).toMatchObject({ publicKey: key.publicKey, key: key.key, hasKey: true, hasPassword: false, hostKey: { type: 'ED25519', bits: 256 } });
    expect(JSON.stringify(view)).not.toContain('PRIVATE KEY');
    const [row] = await db().select().from(destinations).where(eq(destinations.id, view.id));
    expect(openSftpSecrets(row!.secretsEnc).privateKey).toContain('OPENSSH PRIVATE KEY');
    expect((row!.config as SftpConfig).hostKey).toEqual({ type: 'ssh-ed25519', key: server.hostKeyBlob });
  });

  it('refuses a host key the page made up', async () => {
    const key = await makeKey();
    const forged = await add({ kind: 'sftp', name: 'MYSFTP', config: { ...config(), hostKey: { type: 'ssh-ed25519', key: server.hostKeyBlob } }, sealedKey: key.sealed });
    expect(forged.status).toBe(400);
    expect(await forged.json()).toMatchObject({ error: 'Trust a host key through Check connection.' });
    const otherHost = await add({ kind: 'sftp', name: 'MYSFTP', config: config({ host: 'sftp.example.com' }), sealedKey: key.sealed, hostKeyToken: await trustToken() });
    expect(otherHost.status).toBe(400);
    expect(await otherHost.json()).toMatchObject({ error: 'Check the connection again, then trust the host key.' });
  });

  it('keeps a saved password for the same server, asks for it again for another, and forgets the host key with the host', async () => {
    const added = await add({ kind: 'sftp', name: 'MYSFTP', config: config({ auth: 'password' }), secrets: { password: PASSWORD }, hostKeyToken: await trustToken() });
    const view = (await added.json()) as Extract<DestinationView, { kind: 'sftp' }>;
    expect(view.config).toMatchObject({ hasPassword: true, hasKey: false, publicKey: null });

    const kept = await change(view.id, { config: config({ auth: 'password', folder: '/in/other' }) });
    expect(kept.status).toBe(200);
    const [row] = await db().select().from(destinations).where(eq(destinations.id, view.id));
    expect(openSftpSecrets(row!.secretsEnc).password).toBe(PASSWORD);
    expect((row!.config as SftpConfig).hostKey).not.toBeNull();

    const again = await change(view.id, { config: config({ auth: 'password', username: 'OTHERUSER' }) });
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ error: 'Enter the password again for the new server or user.', field: 'secrets.password' });

    const moved = await change(view.id, { config: config({ auth: 'password', host: 'sftp.example.com' }), secrets: { password: 'New-Password-1' } });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as Extract<DestinationView, { kind: 'sftp' }>).config.hostKey).toBeNull();
  });

  it('reads a pasted key, keeps it when left empty, and says what is wrong with one', async () => {
    const key = await makeKey();
    // A key made elsewhere: the sealed one opened, as a user would paste their own file.
    const sealedOpen = (await import('@/lib/server/sftp')).openSealedKey(key.sealed)!;
    const added = await add({ kind: 'sftp', name: 'MYSFTP', config: config({ auth: 'own-key' }), secrets: { privateKey: sealedOpen } });
    expect(added.status).toBe(201);
    const view = (await added.json()) as Extract<DestinationView, { kind: 'sftp' }>;
    expect(view.config.key?.fingerprint).toBe(key.key.fingerprint);
    expect((await change(view.id, { name: 'Renamed', config: config({ auth: 'own-key' }) })).status).toBe(200);

    const bad = await change(view.id, { config: config({ auth: 'own-key' }), secrets: { privateKey: key.publicKey } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'This is the public key. Paste the private key: the file without .pub.', field: 'secrets.privateKey' });
  });
});

describe('the step folder view and Upload test', { timeout: 30_000 }, () => {
  async function sftpJob(change: Partial<SftpConfig> = {}, templates?: (base: JobSpec['render']['templates']) => JobSpec['render']['templates']): Promise<{ jobId: string; destinationId: string }> {
    const serverId = await insertServer();
    const sample = await storeSample(serverId, { sample: loadSample('invoice'), warnings: [] });
    const key = await makeKey();
    server.options.publicKey = key.publicKey;
    const [destination] = await db()
      .insert(destinations)
      .values({
        kind: 'sftp',
        name: 'MYSFTP',
        config: { ...config(), publicKey: key.publicKey, hostKey: { type: 'ssh-ed25519', key: server.hostKeyBlob }, ...change },
        secretsEnc: sealSftpSecrets({ privateKey: (await import('@/lib/server/sftp')).openSealedKey(key.sealed), passphrase: null, password: null }),
      })
      .returning();
    const base = emptySpec({ serverId, library: 'MYLIB', queue: 'MYOUTQ', destinationId: destination!.id });
    const draft = {
      ...base,
      extract: { definition: fixtureText('invoice', 'definition.yaml') },
      preview: { sampleId: sample.id },
      render: { ...base.render, templates: templates ? templates(base.render.templates) : base.render.templates },
    };
    const [job] = await db().insert(jobs).values({ name: 'MYJOB', draft }).returning();
    return { jobId: job!.id, destinationId: destination!.id };
  }
  const folder = async (jobId: string, body: unknown) => {
    const response = await folderRoute.POST(appRequest(`/api/jobs/${jobId}/sftp-folder`, { method: 'POST', body, headers: auth }), params({ id: jobId }));
    return { status: response.status, view: (await response.json()) as SftpFolderView };
  };
  const uploadTest = async (jobId: string, body: unknown) => {
    const response = await testRoute.POST(appRequest(`/api/jobs/${jobId}/sftp-test`, { method: 'POST', body, headers: auth }), params({ id: jobId }));
    return { status: response.status, view: (await response.json()) as SftpUploadTestView & { error?: string } };
  };

  it('places the page group files in the folder, and reads the folder once a minute', async () => {
    server.file('/in/invoices/invoice-260102.pdf', 'old', 1_760_400_000);
    const { jobId } = await sftpJob();
    const first = await folder(jobId, { pageGroupIndex: 0 });
    expect(first.status).toBe(200);
    expect(first.view).toMatchObject({ target: 'MYUSER@127.0.0.1:/in/invoices', testMode: false, pageGroup: 0, pageGroups: 6, truncated: false });
    expect(first.view.files).toEqual([{ name: 'invoice-260101.pdf', outcome: { kind: 'new' } }]);
    expect(first.view.entries.map((e) => e.name)).toEqual(['invoice-260099.pdf', 'invoice-260102.pdf']);

    const second = await folder(jobId, { pageGroupIndex: 1 });
    expect(second.view.files).toEqual([{ name: 'invoice-260102.pdf', outcome: { kind: 'replaces', mtime: new Date(1_760_400_000_000).toISOString() } }]);
    expect(server.connections).toBe(1);

    await folder(jobId, { pageGroupIndex: 1, refresh: true });
    expect(server.connections).toBe(2);
  });

  it('tags each file by the same-name rule', () => {
    const entries = [{ name: 'a.pdf', mtime: 1 }, { name: 'a-2.pdf', mtime: 1 }];
    expect(outcomes(['a.pdf', 'b.pdf'], entries, 'replace')).toEqual([{ kind: 'replaces', mtime: new Date(1000).toISOString() }, { kind: 'new' }]);
    expect(outcomes(['a.pdf'], entries, 'fail')).toEqual([{ kind: 'fails' }]);
    expect(outcomes(['a.pdf'], entries, 'suffix')).toEqual([{ kind: 'becomes', name: 'a-3.pdf' }]);
    expect(outcomes(['Acme.pdf', 'ACME.pdf'], [], 'replace')).toEqual([{ kind: 'new' }, { kind: 'becomes', name: 'ACME-2.pdf' }]);
  });

  it('answers 409 when the host key is not trusted yet', async () => {
    const { jobId } = await sftpJob({ hostKey: null });
    const result = await folder(jobId, {});
    expect(result.status).toBe(409);
  });

  it('refuses Upload test without a test folder', async () => {
    const { jobId } = await sftpJob();
    const result = await uploadTest(jobId, { pageGroupIndex: 0 });
    expect(result.status).toBe(409);
    expect(result.view.error).toBe('Set a test folder on the destination first, so a test never lands where the receiver picks up files.');
    expect(server.connections).toBe(0);
  });

  it('uploads one page group to the test folder, and records nothing in the Job log', async () => {
    const { jobId } = await sftpJob({ testFolder: '/test/in' });
    const result = await uploadTest(jobId, { pageGroupIndex: 2 });
    expect(result.status).toBe(200);
    expect(result.view.files).toEqual([{ name: 'invoice-260103.pdf', finalName: 'invoice-260103.pdf', size: expect.any(Number), ms: expect.any(Number) }]);
    expect(server.names('/test/in')).toEqual(['invoice-260103.pdf']);
    expect(server.names('/in/invoices')).toEqual(['invoice-260099.pdf']);
    expect(await db().select().from(runDeliveries)).toEqual([]);

    // In test mode the view lists the test folder.
    const view = await folder(jobId, { pageGroupIndex: 2 });
    expect(view.view).toMatchObject({ testMode: true, folder: '/test/in', files: [{ name: 'invoice-260103.pdf', outcome: { kind: 'replaces' } }] });
  });

  const workbook = { id: 'lines', name: 'Lines', kind: 'xlsx' as const, fileId: null, scope: 'splf' as const, formats: ['xlsx' as const] };

  it('places and uploads the workbook of the whole spooled file when it is the only template', async () => {
    const { jobId } = await sftpJob({ testFolder: '/test/in' }, () => [workbook]);
    const view = await folder(jobId, { pageGroupIndex: 3 });
    expect(view.view.files).toEqual([{ name: 'spdinvoice.xlsx', outcome: { kind: 'new' }, whole: true }]);
    const result = await uploadTest(jobId, { pageGroupIndex: 3 });
    expect(result.status).toBe(200);
    expect(result.view.files).toEqual([expect.objectContaining({ name: 'spdinvoice.xlsx', finalName: 'spdinvoice.xlsx', whole: true })]);
    expect(server.names('/test/in')).toEqual(['spdinvoice.xlsx']);
  });

  it('places the workbook of the whole spooled file after the page group files, on every page group', async () => {
    const { jobId } = await sftpJob({ testFolder: '/test/in' }, (templates) => [...templates, workbook]);
    for (const pageGroupIndex of [0, 5]) {
      const view = await folder(jobId, { pageGroupIndex });
      expect(view.view.files.map((file) => [file.name, file.whole === true])).toEqual([
        [`invoice-26010${pageGroupIndex + 1}.pdf`, false],
        ['spdinvoice-lines.xlsx', true],
      ]);
    }
    const result = await uploadTest(jobId, { pageGroupIndex: 0 });
    expect(result.view.files.map((file) => file.finalName)).toEqual(['invoice-260101.pdf', 'spdinvoice-lines.xlsx']);
    expect(server.names('/test/in')).toEqual(['invoice-260101.pdf', 'spdinvoice-lines.xlsx']);
  });
});
