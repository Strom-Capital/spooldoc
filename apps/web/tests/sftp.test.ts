import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ssh2 from 'ssh2';
import { afterEach, describe, expect, it } from 'vitest';
import {
  connectSftp,
  hostKeyInfo,
  makeKeyPair,
  parsePrivateKey,
  publicKeyInfo,
  SftpError,
  sftpErrorText,
  sftpTiming,
  uploadFile,
  type SftpErrorContext,
  type SftpSession,
} from '@/lib/server/sftp';
import { TestSftpServer } from './helpers/sftp-server';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/sftp/${name}`, import.meta.url), 'utf8');

describe('host key fingerprints', () => {
  // Each line was printed by `ssh-keygen -l -f <key>.pub`.
  it.each(['ed25519', 'rsa', 'ecdsa'])('match ssh-keygen -l for an %s key', (type) => {
    const [bits, fingerprint, ...rest] = fixture(`${type}.pub.fingerprint`).trim().split(' ');
    const name = rest.at(-1)!.replace(/[()]/g, '');
    const raw = Buffer.from(fixture(`${type}.pub`).split(' ')[1]!, 'base64');
    expect(hostKeyInfo(raw)).toEqual({ type: name, bits: Number(bits), fingerprint });
    expect(publicKeyInfo(fixture(`${type}.pub`))).toEqual({ type: name, bits: Number(bits), fingerprint });
  });

  it('reads no key from a line that is not one', () => {
    expect(publicKeyInfo('not a key')).toBeNull();
    expect(publicKeyInfo(null)).toBeNull();
  });
});

describe('keys Spooldoc makes', () => {
  it('makes an Ed25519 key named after the destination', () => {
    const pair = makeKeyPair('ed25519', 'Invoices to bank');
    expect(pair.publicKey).toMatch(/^ssh-ed25519 AAAA[A-Za-z0-9+/]+=* spooldoc Invoices to bank$/);
    expect(pair.key).toMatchObject({ type: 'ED25519', bits: 256, fingerprint: expect.stringMatching(/^SHA256:[A-Za-z0-9+/]{43}$/) });
    expect(parsePrivateKey(pair.privateKey).publicKey).toBe(pair.publicKey);
  });

  it('makes an RSA 4096 key for servers that refuse Ed25519', () => {
    const pair = makeKeyPair('rsa', 'Bank');
    expect(pair.publicKey).toMatch(/^ssh-rsa /);
    expect(pair.key).toMatchObject({ type: 'RSA', bits: 4096 });
  });
});

describe('parsePrivateKey', () => {
  const { utils } = ssh2;

  it('reads an OpenSSH key with its passphrase', () => {
    const pair = utils.generateKeyPairSync('ed25519', { passphrase: 'MyPassphrase1', cipher: 'aes256-ctr', rounds: 4, comment: 'mine' });
    expect(parsePrivateKey(pair.private, 'MyPassphrase1').publicKey).toBe(pair.public.trim());
  });

  it('reads a PEM key with its passphrase', () => {
    const pem = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'MyPassphrase1' },
    }).privateKey;
    expect(parsePrivateKey(pem, 'MyPassphrase1').publicKey).toMatch(/^ssh-rsa AAAA/);
    expect(() => parsePrivateKey(pem, 'wrong')).toThrow('The passphrase is wrong.');
  });

  it.each([
    ['the public key', () => fixture('ed25519.pub'), undefined, 'This is the public key. Paste the private key: the file without .pub.'],
    ['a wrong passphrase', () => utils.generateKeyPairSync('ed25519', { passphrase: 'right', cipher: 'aes256-ctr', rounds: 4 }).private, 'wrong', 'The passphrase is wrong.'],
    ['no passphrase', () => utils.generateKeyPairSync('ed25519', { passphrase: 'right', cipher: 'aes256-ctr', rounds: 4 }).private, undefined, 'This key has a passphrase. Enter it below.'],
    ['text that is no key', () => 'hello', undefined, 'Spooldoc cannot read this key. Paste an OpenSSH, PEM or PuTTY private key.'],
  ])('says what to do with %s', (_what, text, passphrase, message) => {
    expect(() => parsePrivateKey(text(), passphrase)).toThrow(message);
  });
});

describe('sftpErrorText', () => {
  const ctx: SftpErrorContext = { host: 'sftp.example.com', port: 22, username: 'MYUSER', auth: 'spooldoc-key' };
  const err = (message: string, extra: Record<string, unknown>) => Object.assign(new Error(message), extra);

  it.each([
    [err('getaddrinfo ENOTFOUND sftp.example.com', { code: 'ENOTFOUND' }), ctx, 'Could not find sftp.example.com. Check the host name.'],
    [err('connect ECONNREFUSED', { code: 'ECONNREFUSED' }), ctx, 'sftp.example.com refused the connection on port 22. Check the port, and that the SSH server runs.'],
    [
      err('Timed out while waiting for handshake', { level: 'client-timeout' }),
      ctx,
      'No answer from sftp.example.com on port 22 within 20 seconds. Check the host, the port and the firewall between Spooldoc and the server.',
    ],
    [
      err('All configured authentication methods failed', { level: 'client-authentication' }),
      { ...ctx, methods: ['publickey', 'password'] },
      "sftp.example.com did not accept the key for MYUSER. Add the destination's public key to ~/.ssh/authorized_keys of MYUSER on the server.",
    ],
    [
      err('All configured authentication methods failed', { level: 'client-authentication' }),
      { ...ctx, methods: ['password'] },
      'sftp.example.com does not take a key for MYUSER: it takes a password only. Sign in with a password instead.',
    ],
    [
      err('All configured authentication methods failed', { level: 'client-authentication' }),
      { ...ctx, auth: 'password' as const, methods: ['publickey', 'password'] },
      'sftp.example.com did not accept the password for MYUSER. Check the user and the password.',
    ],
    [
      err('All configured authentication methods failed', { level: 'client-authentication' }),
      { ...ctx, auth: 'password' as const, methods: ['publickey'] },
      'sftp.example.com does not take a password for MYUSER: it takes a key only. Sign in with a key instead.',
    ],
    [
      err('Handshake failed: no matching cipher', { level: 'handshake' }),
      { ...ctx, offered: { 'C->S cipher': '3des-cbc,blowfish-cbc' } },
      "Spooldoc and sftp.example.com have no cipher in common. The server offers 3des-cbc, blowfish-cbc. Ask the server's admin to allow a current one.",
    ],
    [err('Unable to start subsystem: sftp', {}), ctx, "sftp.example.com does not offer SFTP to MYUSER. Ask the server's admin to allow SFTP for the user."],
    [
      err('Permission denied', { code: 3 }),
      { ...ctx, op: { action: 'write' as const, path: '/in/invoices/a.pdf', folder: '/in/invoices' } },
      "MYUSER may not write to /in/invoices on sftp.example.com. Ask the server's admin for write access to the folder.",
    ],
    [
      err('No such file', { code: 2 }),
      { ...ctx, op: { action: 'list' as const, path: '/in/invoices', folder: '/in/invoices' } },
      '/in/invoices does not exist on sftp.example.com.',
    ],
    [
      err('Failure', { code: 4 }),
      { ...ctx, op: { action: 'rename' as const, path: '/in/invoices/a.pdf', folder: '/in/invoices' } },
      "sftp.example.com could not rename /in/invoices/a.pdf. The server's own text is under Details.",
    ],
  ])('words %s', (error, context, message) => {
    const text = sftpErrorText(error, context);
    expect(text.message).toBe(message);
    expect(text.detail).toContain(error.message);
  });
});

describe('uploadFile', () => {
  let server: TestSftpServer;
  let session: SftpSession | null = null;
  const pair = makeKeyPair('ed25519', 'Test');

  afterEach(async () => {
    session?.close();
    session = null;
    await server?.stop();
    sftpTiming.opMs = 60_000;
  });

  async function open(options: ConstructorParameters<typeof TestSftpServer>[0] = {}) {
    server = await new TestSftpServer({ publicKey: pair.publicKey, ...options }).folder('/in').start();
    session = await connectSftp({
      host: '127.0.0.1',
      port: server.port,
      username: 'MYUSER',
      auth: 'spooldoc-key',
      privateKey: pair.privateKey,
      hostKey: { type: 'ssh-ed25519', key: server.hostKeyBlob },
    });
    return session;
  }
  const bytes = Buffer.from('%PDF new');

  it('writes a part file, syncs it and renames it in, so the name only ever holds the whole file', async () => {
    const s = await open();
    expect(s.posixRename).toBe(true);
    expect(s.fsync).toBe(true);
    expect(await uploadFile(s, '/in', 'a.pdf', bytes, { ifExists: 'replace', tempName: true })).toEqual({ finalName: 'a.pdf', replaced: false });
    expect(server.files.get('/in/a.pdf')?.data.toString()).toBe('%PDF new');
    const writes = server.log.filter((line) => /^(OPEN|CLOSE|FSYNC|POSIX-RENAME|RENAME)/.test(line));
    expect(writes).toEqual([
      expect.stringMatching(/^OPEN \/in\/\.a\.pdf\.[0-9a-f]{8}\.part wx$/),
      'FSYNC',
      expect.stringMatching(/^CLOSE \/in\/\.a\.pdf\.[0-9a-f]{8}\.part$/),
      expect.stringMatching(/^POSIX-RENAME \/in\/\.a\.pdf\.[0-9a-f]{8}\.part \/in\/a\.pdf$/),
    ]);
    expect(server.names('/in')).toEqual(['a.pdf']);
  });

  it('replaces with one atomic posix-rename', async () => {
    const s = await open();
    server.file('/in/a.pdf', 'old');
    expect(await uploadFile(s, '/in', 'a.pdf', bytes, { ifExists: 'replace', tempName: true })).toEqual({ finalName: 'a.pdf', replaced: true });
    expect(server.files.get('/in/a.pdf')?.data.toString()).toBe('%PDF new');
    expect(server.names('/in')).toEqual(['a.pdf']);
  });

  it('replaces without posix-rename by renaming the old file aside first', async () => {
    const s = await open({ posixRename: false, fsync: false });
    server.file('/in/a.pdf', 'old');
    expect(await uploadFile(s, '/in', 'a.pdf', bytes, { ifExists: 'replace', tempName: true })).toEqual({ finalName: 'a.pdf', replaced: true });
    expect(server.files.get('/in/a.pdf')?.data.toString()).toBe('%PDF new');
    expect(server.log.filter((line) => line.startsWith('RENAME')).map((line) => line.replace(/[0-9a-f]{8}/g, 'T'))).toEqual([
      'RENAME /in/.a.pdf.T.part /in/a.pdf',
      'RENAME /in/a.pdf /in/.a.pdf.T.old',
      'RENAME /in/.a.pdf.T.part /in/a.pdf',
    ]);
    expect(server.names('/in')).toEqual(['a.pdf']);
  });

  it('fails a taken name with Fail the run and leaves no part file', async () => {
    const s = await open();
    server.file('/in/a.pdf', 'old');
    await expect(uploadFile(s, '/in', 'a.pdf', bytes, { ifExists: 'fail', tempName: true })).rejects.toMatchObject({ extra: { taken: true } });
    expect(server.files.get('/in/a.pdf')?.data.toString()).toBe('old');
    expect(server.names('/in')).toEqual(['a.pdf']);
  });

  it('adds the next free number', async () => {
    const s = await open();
    server.file('/in/a.pdf').file('/in/a-2.pdf');
    expect(await uploadFile(s, '/in', 'a.pdf', bytes, { ifExists: 'suffix', tempName: true })).toEqual({ finalName: 'a-3.pdf', replaced: false });
  });

  it('writes the final name directly without a temporary name', async () => {
    const s = await open();
    server.file('/in/a.pdf', 'old');
    expect(await uploadFile(s, '/in', 'a.pdf', bytes, { ifExists: 'replace', tempName: false })).toEqual({ finalName: 'a.pdf', replaced: true });
    await expect(uploadFile(s, '/in', 'a.pdf', bytes, { ifExists: 'fail', tempName: false })).rejects.toMatchObject({ extra: { taken: true } });
    expect(await uploadFile(s, '/in', 'a.pdf', bytes, { ifExists: 'suffix', tempName: false })).toMatchObject({ finalName: 'a-2.pdf' });
    expect(server.log.some((line) => line.includes('.part'))).toBe(false);
  });

  it('tells to turn off the temporary name when the server refuses renames', async () => {
    const s = await open({ denyRename: true });
    const error = await uploadFile(s, '/in', 'a.pdf', bytes, { ifExists: 'replace', tempName: true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SftpError);
    expect((error as SftpError).message).toMatch(/^127\.0\.0\.1 did not let Spooldoc rename \.a\.pdf\.[0-9a-f]{8}\.part to a\.pdf\. If the server refuses renames, turn off "Write each file under a temporary name first" on the destination\.$/);
    expect(server.names('/in')).toEqual([]);
  });

  it('ends a connection that stops answering', async () => {
    const s = await open({ hangAfterBytes: 0 });
    sftpTiming.opMs = 200;
    const error = (await uploadFile(s, '/in', 'a.pdf', bytes, { ifExists: 'replace', tempName: true }).catch((e: unknown) => e)) as SftpError;
    expect(error.message).toBe('127.0.0.1 stopped answering while Spooldoc uploaded a.pdf.');
    expect(error.stops).toBe(true);
    expect(s.closed).toBe(true);
  });
});
