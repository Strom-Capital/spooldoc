import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectSftp, listFolder, SftpError, toHostKey, uploadFile, type SftpSession, type SftpTarget } from '@/lib/server/sftp';

/**
 * Against a real OpenSSH server, to check its rename, posix-rename and fsync. Skipped unless
 * SFTP_OPENSSH_PORT is set, such as after:
 *
 *   docker run -d --rm --name spooldoc-sftp-agent -p 127.0.0.1:2224:22 atmoz/sftp MYUSER:pass:::in,test
 *   SFTP_OPENSSH_PORT=2224 pnpm --filter @spooldoc/web exec vitest run tests/sftp-openssh.test.ts
 */
const port = Number(process.env.SFTP_OPENSSH_PORT);

describe.skipIf(!port)('a real OpenSSH server', () => {
  const target: SftpTarget = { host: '127.0.0.1', port, username: 'MYUSER', auth: 'password', password: 'pass', hostKey: null };
  let s: SftpSession;
  const folder = `/in/run-${Date.now()}`;
  const names = async () => (await listFolder(s, folder)).entries.map((e) => e.name).sort();
  const content = async (name: string) =>
    (await s.call<Buffer>('read', (done) => s.sftp.readFile(`${folder}/${name}`, (err: Error | null | undefined, data: Buffer) => done(err, data)))).toString();

  beforeAll(async () => {
    // The first connection stops at the host key, which is then trusted.
    const seen = await connectSftp(target).catch((err: unknown) => err as SftpError);
    expect(seen).toBeInstanceOf(SftpError);
    target.hostKey = toHostKey((seen as SftpError).extra.seenHostKey!);
    s = await connectSftp(target);
    await s.call('mkdir', (done) => s.sftp.mkdir(folder, done));
  });

  afterAll(() => s?.close());

  it('offers posix-rename and fsync', () => {
    expect(s.posixRename).toBe(true);
    expect(s.fsync).toBe(true);
  });

  it('writes, replaces with posix-rename, refuses a taken name and adds a number', async () => {
    expect(await uploadFile(s, folder, 'a.pdf', Buffer.from('one'), { ifExists: 'replace', tempName: true })).toEqual({ finalName: 'a.pdf', replaced: false });
    expect(await uploadFile(s, folder, 'a.pdf', Buffer.from('two'), { ifExists: 'replace', tempName: true })).toEqual({ finalName: 'a.pdf', replaced: true });
    expect(await content('a.pdf')).toBe('two');
    await expect(uploadFile(s, folder, 'a.pdf', Buffer.from('three'), { ifExists: 'fail', tempName: true })).rejects.toMatchObject({ extra: { taken: true } });
    expect(await uploadFile(s, folder, 'a.pdf', Buffer.from('four'), { ifExists: 'suffix', tempName: true })).toMatchObject({ finalName: 'a-2.pdf' });
    expect(await content('a.pdf')).toBe('two');
    expect(await names()).toEqual(['a-2.pdf', 'a.pdf']);
  });

  it('replaces by renaming aside when posix-rename is not used, as on a server without it', async () => {
    const plain = { ...s, posixRename: false } as SftpSession;
    expect(await uploadFile(plain, folder, 'b.pdf', Buffer.from('one'), { ifExists: 'replace', tempName: true })).toEqual({ finalName: 'b.pdf', replaced: false });
    expect(await uploadFile(plain, folder, 'b.pdf', Buffer.from('two'), { ifExists: 'replace', tempName: true })).toEqual({ finalName: 'b.pdf', replaced: true });
    expect(await content('b.pdf')).toBe('two');
    expect((await names()).filter((n) => n.startsWith('.'))).toEqual([]);
  });

  it('writes the final name directly without a temporary name', async () => {
    expect(await uploadFile(s, folder, 'c.pdf', Buffer.from('one'), { ifExists: 'replace', tempName: false })).toEqual({ finalName: 'c.pdf', replaced: false });
    await expect(uploadFile(s, folder, 'c.pdf', Buffer.from('two'), { ifExists: 'fail', tempName: false })).rejects.toMatchObject({ extra: { taken: true } });
    expect(await uploadFile(s, folder, 'c.pdf', Buffer.from('three'), { ifExists: 'suffix', tempName: false })).toMatchObject({ finalName: 'c-2.pdf' });
    expect(await content('c.pdf')).toBe('one');
  });
});
