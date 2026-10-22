import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SftpConfig } from '@/lib/destination-config';
import { emptySpec, type JobSpec } from '@/lib/job-spec';
import { destinations, jobs, jobVersions, runDeliveries, runFiles, runs } from '@/lib/server/db/schema';
import { sealSftpSecrets, sftpConnector, sftpDestination, type SftpSecrets } from '@/lib/server/destinations/sftp';
import type { RunFile } from '@/lib/server/destinations/store';
import { runJob } from '@/lib/server/runner';
import { runViews } from '@/lib/server/runs';
import { hostKeyInfo, makeKeyPair, sftpTiming } from '@/lib/server/sftp';
import { resetTables } from './helpers/db';
import { FakeConnection, fixtureText, GOOD_PASSWORD, loadSample } from './helpers/fake-connection';
import { db, insertServer } from './helpers/fixtures';
import { makeHostKey, publicBlob, TestSftpServer, type SftpServerOptions } from './helpers/sftp-server';

const KEY = makeKeyPair('ed25519', 'MYSFTP');
const PASSWORD = 'Sftp-Password-789';
const INVOICES = ['invoice-260101.pdf', 'invoice-260102.pdf', 'invoice-260103.pdf', 'invoice-260104.pdf', 'invoice-260105.pdf', 'invoice-260106.pdf'];

let server: TestSftpServer;

afterEach(async () => {
  await server?.stop();
  sftpTiming.opMs = 60_000;
  vi.restoreAllMocks();
});

// Each test signs in over real SSH, in pure JS, and runs whole jobs: slower than a unit test on a busy CI runner.
describe('the SFTP destination', { timeout: 30_000 }, () => {
  const sample = loadSample('invoice');
  let serverId: string;

  beforeEach(async () => {
    await resetTables(db());
    serverId = await insertServer();
  });

  async function start(options: SftpServerOptions = {}) {
    server = await new TestSftpServer({ publicKey: KEY.publicKey, ...options }).folder('/in/invoices').folder('/test/in').start();
    return server;
  }

  /** An invoice job with an active version that uploads each invoice, as PDF, to MYSFTP. */
  async function sftpJob(change: Partial<SftpConfig> = {}, secrets: Partial<SftpSecrets> = {}): Promise<string> {
    const config: SftpConfig = {
      host: '127.0.0.1',
      port: server.port,
      username: 'MYUSER',
      auth: 'spooldoc-key',
      publicKey: KEY.publicKey,
      folder: '/in/invoices',
      testFolder: null,
      ifExists: 'replace',
      keepCopy: true,
      tempName: true,
      hostKey: { type: 'ssh-ed25519', key: server.hostKeyBlob },
      ...change,
    };
    const [destination] = await db()
      .insert(destinations)
      .values({ kind: 'sftp', name: 'MYSFTP', config, secretsEnc: sealSftpSecrets({ privateKey: KEY.privateKey, passphrase: null, password: null, ...secrets }) })
      .returning();
    const base = emptySpec({ serverId, library: 'MYLIB', queue: 'MYOUTQ', destinationId: destination!.id });
    const spec: JobSpec = { ...base, extract: { definition: fixtureText('invoice', 'definition.yaml') } };
    const [job] = await db().insert(jobs).values({ name: 'MYJOB', draft: spec, activeVersion: 1 }).returning();
    await db().insert(jobVersions).values({ jobId: job!.id, number: 1, spec });
    return job!.id;
  }

  const run = async (jobId: string, conn = new FakeConnection()) =>
    runJob({ jobId, version: 1, splf: sample.splf, trigger: 'manual' }, { conn, host: 'ibmi.example.com', serverId, password: GOOD_PASSWORD });
  const runRow = async (id: string) => (await db().select().from(runs).where(eq(runs.id, id)))[0]!;
  const deliveriesOf = (runId: string) => db().select().from(runDeliveries).where(eq(runDeliveries.runId, runId)).orderBy(runDeliveries.sentAt);
  const deliverStep = async (runId: string) => (await runRow(runId)).steps.find((step) => step.step === 'deliver')!;

  describe('the host key', () => {
    it('uploads each invoice over one connection to a host whose key it trusts, records each, and then holds the file', async () => {
      await start();
      const jobId = await sftpJob();
      const conn = new FakeConnection();
      const runId = await run(jobId, conn);
      const row = await runRow(runId);
      expect(row.status).toBe('success');
      expect((await deliverStep(runId)).note).toBe('Uploaded 6 files to /in/invoices on 127.0.0.1 port ' + server.port + ', a copy kept in Spooldoc');
      expect(server.connections).toBe(1);
      expect(server.names('/in/invoices')).toEqual(INVOICES);
      expect((await db().select().from(runFiles).where(eq(runFiles.runId, runId))).length).toBe(6);

      const deliveries = await deliveriesOf(runId);
      expect(deliveries.map((d) => [d.kind, d.status, d.document, d.test])).toEqual(INVOICES.map((name) => ['sftp', 'sent', name, false]));
      expect(deliveries[0]).toMatchObject({ to: '127.0.0.1:/in/invoices/invoice-260101.pdf', messageId: null, size: expect.any(Number), ms: expect.any(Number) });
      const [view] = await runViews([row]);
      expect(view!.deliveryKind).toBe('sftp');
      expect(view!.deliveries[0]).toMatchObject({ kind: 'sftp', status: 'sent', size: expect.any(Number) });
      expect(conn.actions()).toEqual(['holdSpooledFile']);
    });

    it('fails at once, without connecting, when no host key is trusted yet', async () => {
      await start();
      const jobId = await sftpJob({ hostKey: null });
      const conn = new FakeConnection();
      const runId = await run(jobId, conn);
      expect((await runRow(runId)).status).toBe('failed');
      expect((await deliverStep(runId)).error).toBe(
        'Uploaded 0 of 6 files to /in/invoices on 127.0.0.1 port ' + server.port + '. The host key of 127.0.0.1 is not trusted yet. Open MYSFTP on the Destinations page, check the connection and trust the key.',
      );
      expect(server.connections).toBe(0);
      expect(server.signIns).toEqual([]);
      const deliveries = await deliveriesOf(runId);
      expect(deliveries.map((d) => d.status)).toEqual(Array(6).fill('failed'));
      expect(deliveries[0]!.error).toMatch(/^Not uploaded: The host key of 127\.0\.0\.1 is not trusted yet\./);
      expect(conn.actions()).toEqual([]);
    });

    it('stops before the sign-in when the host key changed, and names both fingerprints', async () => {
      await start({ password: PASSWORD });
      const trusted = makeHostKey();
      const jobId = await sftpJob({ auth: 'password', publicKey: null, hostKey: { type: 'ssh-ed25519', key: publicBlob(trusted) } }, { privateKey: null, password: PASSWORD });
      const runId = await run(jobId);
      const step = await deliverStep(runId);
      const before = hostKeyInfo(Buffer.from(publicBlob(trusted), 'base64')).fingerprint;
      const after = hostKeyInfo(Buffer.from(server.hostKeyBlob, 'base64')).fingerprint;
      expect(step.error).toContain(`The host key of 127.0.0.1 is not the one Spooldoc trusts. Spooldoc trusts ${before}, and the server showed ${after}.`);
      expect(step.error).toContain('If not, do not: something may be between Spooldoc and the server.');
      // No password went to a host Spooldoc does not know.
      expect(server.signIns).toEqual([]);
      expect(server.connections).toBe(0);
    });
  });

  describe('the sign-in', () => {
    it('says where the key goes when the server does not accept it', async () => {
      await start({ publicKey: makeKeyPair('ed25519', 'other').publicKey });
      const runId = await run(await sftpJob());
      expect((await deliverStep(runId)).error).toBe(
        `Uploaded 0 of 6 files to /in/invoices on 127.0.0.1 port ${server.port}. 127.0.0.1 did not accept the key for MYUSER. Add the destination's public key to ~/.ssh/authorized_keys of MYUSER on the server.`,
      );
    });

    it('signs in with a password, and keeps the password out of every error', async () => {
      await start({ publicKey: null, password: PASSWORD });
      const ok = await run(await sftpJob({ auth: 'password', publicKey: null }, { privateKey: null, password: PASSWORD }));
      expect((await runRow(ok)).status).toBe('success');

      await resetTables(db());
      serverId = await insertServer();
      const runId = await run(await sftpJob({ auth: 'password', publicKey: null }, { privateKey: null, password: 'Wrong-Password-1' }));
      const row = await runRow(runId);
      expect((await deliverStep(runId)).error).toContain('127.0.0.1 did not accept the password for MYUSER. Check the user and the password.');
      const everything = JSON.stringify([row, await deliveriesOf(runId)]);
      expect(everything).not.toContain('Wrong-Password-1');
      expect(everything).not.toContain(PASSWORD);
    });

    it('answers a keyboard-interactive prompt with the password', async () => {
      await start({ publicKey: null, password: PASSWORD, keyboardOnly: true });
      const runId = await run(await sftpJob({ auth: 'password', publicKey: null }, { privateKey: null, password: PASSWORD }));
      expect((await runRow(runId)).status).toBe('success');
      expect(server.signIns).toEqual(['password', 'keyboard-interactive']);
    });

    it('says when the server takes no password', async () => {
      await start();
      const runId = await run(await sftpJob({ auth: 'password', publicKey: null }, { privateKey: null, password: PASSWORD }));
      expect((await deliverStep(runId)).error).toContain('127.0.0.1 does not take a password for MYUSER: it takes a key only. Sign in with a key instead.');
    });

    it('keeps the private key out of every error', async () => {
      await start({ publicKey: null, password: PASSWORD });
      const runId = await run(await sftpJob());
      const everything = JSON.stringify([await runRow(runId), await deliveriesOf(runId)]);
      expect(everything).toContain('does not take a key for MYUSER');
      expect(everything).not.toContain(KEY.privateKey.split('\n')[1]!);
    });
  });

  describe('the folder', () => {
    it('is never created', async () => {
      await start();
      const runId = await run(await sftpJob({ folder: '/in/missing' }));
      expect((await deliverStep(runId)).error).toBe(
        `Uploaded 0 of 6 files to /in/missing on 127.0.0.1 port ${server.port}. The folder /in/missing does not exist on 127.0.0.1. Create it, or change the destination's folder.`,
      );
      expect(server.files.has('/in/missing')).toBe(false);
    });

    it('is not a file', async () => {
      await start();
      server.file('/in/report.pdf');
      const runId = await run(await sftpJob({ folder: '/in/report.pdf' }));
      expect((await deliverStep(runId)).error).toContain("/in/report.pdf on 127.0.0.1 is a file, not a folder. Change the destination's folder.");
    });

    it('is relative to the home folder', async () => {
      await start();
      server.folder('/home/MYUSER/out');
      const runId = await run(await sftpJob({ folder: 'out' }));
      expect((await runRow(runId)).status).toBe('success');
      expect(server.names('/home/MYUSER/out')).toEqual(INVOICES);
      expect((await deliveriesOf(runId))[0]!.to).toBe('127.0.0.1:/home/MYUSER/out/invoice-260101.pdf');
    });

    it('says when the user may not write to it', async () => {
      await start({ deny: ['/in/invoices'] });
      const runId = await run(await sftpJob());
      const step = await deliverStep(runId);
      expect(step.error).toContain("invoice-260101.pdf: MYUSER may not write to /in/invoices on 127.0.0.1. Ask the server's admin for write access to the folder.");
      expect(step.error).toContain('5 more failed; the Uploads list of the run has each one.');
    });
  });

  describe('the same-name rules', () => {
    for (const posixRename of [true, false]) {
      for (const tempName of [true, false]) {
        const how = `${posixRename ? 'with' : 'without'} posix-rename, ${tempName ? 'with' : 'without'} a temporary name`;

        it(`replaces a file, ${how}`, async () => {
          await start({ posixRename });
          server.file('/in/invoices/invoice-260101.pdf', 'old');
          const runId = await run(await sftpJob({ tempName }));
          expect((await deliverStep(runId)).note).toBe(`Uploaded 6 files to /in/invoices on 127.0.0.1 port ${server.port} (1 replaced), a copy kept in Spooldoc`);
          expect(server.files.get('/in/invoices/invoice-260101.pdf')!.data.toString()).not.toBe('old');
          expect(server.names('/in/invoices')).toEqual(INVOICES);
        });

        it(`fails the run before uploading anything, ${how}`, async () => {
          await start({ posixRename });
          server.file('/in/invoices/invoice-260103.pdf', 'old');
          const conn = new FakeConnection();
          const runId = await run(await sftpJob({ tempName, ifExists: 'fail' }), conn);
          expect((await deliverStep(runId)).error).toBe(
            'invoice-260103.pdf is already in /in/invoices. Nothing was uploaded. Change "When a file with the same name exists" or move the old file.',
          );
          expect(server.names('/in/invoices')).toEqual(['invoice-260103.pdf']);
          expect(conn.actions()).toEqual([]);
        });

        it(`adds a number, ${how}`, async () => {
          await start({ posixRename });
          server.file('/in/invoices/invoice-260101.pdf', 'old').file('/in/invoices/invoice-260101-2.pdf', 'old');
          const runId = await run(await sftpJob({ tempName, ifExists: 'suffix' }));
          expect((await deliverStep(runId)).note).toBe(`Uploaded 6 files to /in/invoices on 127.0.0.1 port ${server.port} (1 with a number added), a copy kept in Spooldoc`);
          expect(server.files.get('/in/invoices/invoice-260101.pdf')!.data.toString()).toBe('old');
          expect(server.names('/in/invoices')).toContain('invoice-260101-3.pdf');
          const first = (await deliveriesOf(runId))[0]!;
          expect(first).toMatchObject({ document: 'invoice-260101.pdf', messageId: 'invoice-260101-3.pdf', to: '127.0.0.1:/in/invoices/invoice-260101-3.pdf' });
        });
      }
    }
  });

  describe('writing', () => {
    it('never shows a file under its final name before it is complete', async () => {
      await start();
      const jobId = await sftpJob();
      // At every rename into place the part file is whole, and no final name existed before it.
      const runId = await run(jobId);
      expect((await runRow(runId)).status).toBe('success');
      const opens = server.log.filter((line) => line.startsWith('OPEN '));
      expect(opens.every((line) => /\/\.invoice-\d+\.pdf\.[0-9a-f]{8}\.part wx$/.test(line))).toBe(true);
      expect(server.log.filter((line) => line.startsWith('POSIX-RENAME'))).toHaveLength(6);
    });

    it('numbers names of one run that differ only in case', async () => {
      await start();
      const jobId = await sftpJob();
      const [run1] = await db().insert(runs).values({ jobId, version: 1, trigger: 'manual', splf: sample.splf }).returning();
      const [destination] = await db().select().from(destinations).where(eq(destinations.kind, 'sftp'));
      const file = (name: string): RunFile => ({ pageGroupIndex: 0, template: 'Invoice', templateIndex: 0, name, contentType: 'application/pdf', content: new Uint8Array([1]) });
      const config = destination!.config as SftpConfig;
      const note = await sftpDestination({ ...config, keepCopy: false }, { privateKey: KEY.privateKey, passphrase: null, password: null }, 'MYSFTP').deliver({
        runId: run1!.id,
        files: [file('Acme.pdf'), file('ACME.pdf')],
        documents: [],
        job: { id: jobId, splfKey: 'key' },
        destinationId: destination!.id,
        email: null,
        webhook: null,
        context: { job: { id: jobId, name: 'MYJOB', version: 1 }, run: { id: run1!.id, seq: 1 }, splf: sample.splf, attributes: sample.attributes },
        valueTypes: {},
        conn: new FakeConnection(),
        host: 'ibmi.example.com',
        addSecret: () => undefined,
      });
      expect(server.names('/in/invoices')).toEqual(['ACME-2.pdf', 'Acme.pdf']);
      expect(note).toContain('(1 with a number added)');
    });
  });

  describe('Retry', () => {
    it('uploads only the files not uploaded yet', async () => {
      await start({ dropAfterFiles: 3 });
      const jobId = await sftpJob({ tempName: false });
      const first = await run(jobId);
      expect((await runRow(first)).status).toBe('failed');
      const firstRows = await deliveriesOf(first);
      expect(firstRows.filter((d) => d.status === 'sent').map((d) => d.document)).toEqual(INVOICES.slice(0, 3));
      expect(firstRows.filter((d) => d.status === 'failed').every((d) => d.error!.includes('closed the connection') || d.error!.startsWith('Not uploaded: '))).toBe(true);

      server.options.dropAfterFiles = null;
      const second = await run(jobId);
      const row = await runRow(second);
      expect(row.status).toBe('success');
      expect((await deliverStep(second)).note).toBe(`Uploaded 3 files to /in/invoices on 127.0.0.1 port ${server.port}, 3 were uploaded in run #${(await runRow(first)).seq}, a copy kept in Spooldoc`);
      const secondRows = await deliveriesOf(second);
      expect(secondRows.filter((d) => d.status === 'already_sent').map((d) => [d.document, d.sentInRun])).toEqual(INVOICES.slice(0, 3).map((name) => [name, (row.seq ?? 0) - 1]));
      expect(server.names('/in/invoices')).toEqual(INVOICES);
    });
  });

  describe('the test folder', () => {
    it('takes every file, marked as a test that does not count as uploaded', async () => {
      await start();
      const jobId = await sftpJob({ testFolder: '/test/in' });
      const runId = await run(jobId);
      expect((await deliverStep(runId)).note).toBe(`Uploaded 6 files to the test folder /test/in on 127.0.0.1 port ${server.port}`);
      expect(server.names('/test/in')).toEqual(INVOICES);
      expect(server.names('/in/invoices')).toEqual([]);
      expect((await deliveriesOf(runId)).every((d) => d.test && d.status === 'sent')).toBe(true);

      // A real run afterwards uploads them all again.
      const [saved] = await db().select().from(destinations).where(eq(destinations.kind, 'sftp'));
      await db()
        .update(destinations)
        .set({ config: { ...(saved!.config as SftpConfig), testFolder: null } })
        .where(eq(destinations.id, saved!.id));
      const real = await run(jobId);
      expect((await deliverStep(real)).note).toBe(`Uploaded 6 files to /in/invoices on 127.0.0.1 port ${server.port}, a copy kept in Spooldoc`);
    });
  });

  describe('failures', () => {
    it('stops at a dropped connection and marks the rest not uploaded', async () => {
      await start({ dropAfterFiles: 2 });
      const conn = new FakeConnection();
      const runId = await run(await sftpJob({ tempName: false }), conn);
      const deliveries = await deliveriesOf(runId);
      expect(deliveries.map((d) => d.status)).toEqual(['sent', 'sent', 'failed', 'failed', 'failed', 'failed']);
      expect(deliveries.slice(3).every((d) => d.error!.startsWith('Not uploaded: 127.0.0.1 closed the connection'))).toBe(true);
      expect((await deliverStep(runId)).error).toMatch(/^Uploaded 2 of 6 files to \/in\/invoices on 127\.0\.0\.1 port \d+\. invoice-260103\.pdf: 127\.0\.0\.1 closed the connection/);
      expect(conn.actions()).toEqual([]);
    });

    it('ends a server that stops answering with the watchdog', async () => {
      await start({ hangAfterBytes: 0 });
      sftpTiming.opMs = 300;
      const runId = await run(await sftpJob());
      expect((await deliverStep(runId)).error).toMatch(/invoice-260101\.pdf: 127\.0\.0\.1 stopped answering while Spooldoc uploaded invoice-260101\.pdf\. 5 more failed/);
      const deliveries = await deliveriesOf(runId);
      expect(deliveries.slice(1).every((d) => d.error!.startsWith('Not uploaded: 127.0.0.1 stopped answering'))).toBe(true);
    });

    it('opens one connection per run', async () => {
      await start();
      const connect = vi.spyOn(sftpConnector, 'connect');
      await run(await sftpJob());
      expect(connect).toHaveBeenCalledTimes(1);
    });
  });
});
