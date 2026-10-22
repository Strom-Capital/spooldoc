import type { AddressInfo } from 'node:net';
import ssh2, { type Connection, type ParsedKey, type SFTPWrapper } from 'ssh2';

const { Server, utils } = ssh2;
const { OPEN_MODE, STATUS_CODE } = utils.sftp;

/** A file or folder of the in-memory tree. */
export interface Node {
  folder: boolean;
  data: Buffer;
  /** Seconds since 1970. */
  mtime: number;
}

/** What the test server takes and how it misbehaves. */
export interface SftpServerOptions {
  /** The OpenSSH public key line it accepts. */
  publicKey?: string | null;
  /** The password it accepts. */
  password?: string | null;
  /** Ask for the password only through keyboard-interactive. */
  keyboardOnly?: boolean;
  /** Advertise `posix-rename@openssh.com`. On by default, as OpenSSH does. */
  posixRename?: boolean;
  /** Advertise `fsync@openssh.com`. On by default. */
  fsync?: boolean;
  /** Refuse every rename with permission denied, as some file transfer gateways do. */
  denyRename?: boolean;
  /** Refuse every remove with permission denied. */
  denyRemove?: boolean;
  /** Paths a rename to fails with a plain failure. */
  failRenameTo?: string[];
  /** Paths whose STAT is refused with permission denied. */
  denyStat?: string[];
  /** Fail each write with a plain failure after this many bytes are written, as on a full disk. */
  failAfterBytes?: number | null;
  /** Folders where writes are refused with permission denied. */
  deny?: string[];
  /** Stop answering after this many bytes are written. */
  hangAfterBytes?: number | null;
  /** End the connection after this many files are closed. */
  dropAfterFiles?: number | null;
  /** Refuse the SFTP subsystem. */
  noSftp?: boolean;
  /** Never answer the request for the SFTP subsystem. */
  ignoreSftp?: boolean;
  /** The home folder, where relative paths go. */
  home?: string;
}

/** A host key for the server: an Ed25519 key by default. Made again when ssh2 makes one it cannot read. */
export function makeHostKey(type: 'ed25519' | 'rsa' = 'ed25519'): string {
  for (;;) {
    const key = (type === 'rsa' ? utils.generateKeyPairSync('rsa', { bits: 2048 }) : utils.generateKeyPairSync('ed25519')).private;
    if (!(utils.parseKey(key) instanceof Error)) return key;
  }
}

/** The base64 of a private key's public half in SSH wire format, as a host key is stored. */
export const publicBlob = (privateKey: string): string => (utils.parseKey(privateKey) as ParsedKey).getPublicSSH().toString('base64');

/** An SFTP version answer with the extensions the server advertises. */
function versionPacket(extensions: string[]): Buffer {
  const parts = extensions.flatMap((name) => [name, '1']).map((text) => {
    const bytes = Buffer.from(text);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    return Buffer.concat([length, bytes]);
  });
  const body = Buffer.concat([Buffer.from([2, 0, 0, 0, 3]), ...parts]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  return Buffer.concat([length, body]);
}

/** Two SSH strings from the data of an extended request. */
function twoStrings(data: Buffer): [string, string] {
  const a = data.readUInt32BE(0);
  const first = data.subarray(4, 4 + a).toString();
  const b = data.readUInt32BE(4 + a);
  return [first, data.subarray(8 + a, 8 + a + b).toString()];
}

const normalize = (path: string): string => {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
};
const parentOf = (path: string): string => normalize(path.slice(0, path.lastIndexOf('/')) || '/');

/**
 * An SSH server in this process, on 127.0.0.1 and a free port, with an SFTP subsystem over
 * a file tree in memory. It answers what Spooldoc asks: OPEN, WRITE, CLOSE, STAT, LSTAT,
 * FSTAT, REALPATH, OPENDIR, READDIR, RENAME and REMOVE, and the `posix-rename@openssh.com`
 * and `fsync@openssh.com` extensions. A rename never replaces, as under OpenSSH.
 */
export class TestSftpServer {
  readonly files = new Map<string, Node>();
  /** Every SFTP call, in order, such as `RENAME /in/.a.pdf.1a2b3c4d.part /in/a.pdf`. */
  readonly log: string[] = [];
  /** How many connections signed in. */
  connections = 0;
  /** What a client offered to sign in with, in order. */
  readonly signIns: string[] = [];
  options: SftpServerOptions;
  hostKey: string;
  port = 0;
  private server: InstanceType<typeof Server> | null = null;
  private clients = new Set<Connection>();
  private written = 0;
  private closedFiles = 0;

  constructor(options: SftpServerOptions = {}, hostKey: string = makeHostKey()) {
    this.options = options;
    this.hostKey = hostKey;
    const home = options.home ?? '/home/MYUSER';
    for (const folder of ['/', '/home', home]) this.files.set(folder, { folder: true, data: Buffer.alloc(0), mtime: 1_760_000_000 });
  }

  /** Add a folder, with its parents. */
  folder(path: string): this {
    let at = '';
    for (const part of normalize(path).split('/').filter(Boolean)) {
      at += `/${part}`;
      if (!this.files.has(at)) this.files.set(at, { folder: true, data: Buffer.alloc(0), mtime: 1_760_000_000 });
    }
    return this;
  }

  /** Add a file. */
  file(path: string, content: string | Buffer = 'old', mtime = 1_760_400_000): this {
    this.folder(parentOf(normalize(path)));
    this.files.set(normalize(path), { folder: false, data: Buffer.from(content), mtime });
    return this;
  }

  /** The names in a folder, sorted. */
  names(folder: string): string[] {
    const base = normalize(folder);
    return [...this.files.keys()].filter((path) => path !== base && parentOf(path) === base).map((path) => path.slice(base === '/' ? 1 : base.length + 1)).sort();
  }

  /** The base64 of the server's host key, as Spooldoc stores it. */
  get hostKeyBlob(): string {
    return publicBlob(this.hostKey);
  }

  async start(port = 0): Promise<this> {
    this.server = new Server({ hostKeys: [this.hostKey] }, (client) => this.accept(client));
    await new Promise<void>((resolve) => this.server!.listen(port, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  async stop(): Promise<void> {
    for (const client of this.clients) client.end();
    this.clients.clear();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = null;
  }

  /** Restart on the same port with another host key, as after the server's admin made new keys. */
  async swapHostKey(hostKey = makeHostKey()): Promise<void> {
    const { port } = this;
    await this.stop();
    this.hostKey = hostKey;
    await this.start(port);
  }

  private methods(): ('publickey' | 'password' | 'keyboard-interactive')[] {
    const { publicKey, password, keyboardOnly } = this.options;
    return [...(publicKey ? (['publickey'] as const) : []), ...(password && !keyboardOnly ? (['password'] as const) : []), ...(password ? (['keyboard-interactive'] as const) : [])];
  }

  private accept(client: Connection): void {
    this.clients.add(client);
    client.on('close', () => this.clients.delete(client));
    client.on('error', () => undefined);
    client.on('authentication', (ctx) => {
      this.signIns.push(ctx.method);
      const { publicKey, password, keyboardOnly } = this.options;
      if (ctx.method === 'publickey' && publicKey) {
        const allowed = utils.parseKey(publicKey) as ParsedKey;
        if (ctx.key.data.equals(allowed.getPublicSSH()) && (!ctx.signature || allowed.verify(ctx.blob!, ctx.signature, ctx.hashAlgo))) return ctx.accept();
      }
      if (ctx.method === 'password' && password && !keyboardOnly && ctx.password === password) return ctx.accept();
      if (ctx.method === 'keyboard-interactive' && password) {
        return ctx.prompt([{ prompt: 'Password: ', echo: false }], (answers) => (answers[0] === password ? ctx.accept() : ctx.reject(this.methods())));
      }
      ctx.reject(this.methods());
    });
    client.on('ready', () => {
      this.connections++;
      client.on('session', (acceptSession) => {
        const session = acceptSession();
        session.on('sftp', (acceptSftp, reject) => {
          if (this.options.noSftp) return reject();
          if (this.options.ignoreSftp) return;
          const sftp = acceptSftp();
          this.advertise(sftp);
          this.serve(sftp, client);
        });
      });
    });
  }

  /** ssh2's server answers INIT without extensions: send the version with the ones this server has. */
  private advertise(sftp: SFTPWrapper): void {
    const protocol = (sftp as unknown as { _protocol: { channelData(id: number, data: Buffer): void } })._protocol;
    const extensions = [...(this.options.posixRename !== false ? ['posix-rename@openssh.com'] : []), ...(this.options.fsync !== false ? ['fsync@openssh.com'] : [])];
    const send = protocol.channelData.bind(protocol);
    protocol.channelData = (id: number, data: Buffer) => {
      const isVersion = data.length === 9 && data[4] === 2 && data.readUInt32BE(5) === 3;
      send(id, isVersion ? versionPacket(extensions) : data);
    };
  }

  private serve(sftp: SFTPWrapper, client: Connection): void {
    const home = this.options.home ?? '/home/MYUSER';
    const resolve = (path: string) => normalize(path.startsWith('/') ? path : `${home}/${path}`);
    // `listed` is how many entries of a folder READDIR has sent: 100 at a time, as servers do.
    const handles = new Map<string, { path: string; folder: boolean; listed: number }>();
    let next = 0;
    const handleOf = (path: string, folder: boolean) => {
      const handle = Buffer.from(String(next++));
      handles.set(handle.toString(), { path, folder, listed: 0 });
      return handle;
    };
    const denied = (path: string) => (this.options.deny ?? []).some((folder) => parentOf(path) === normalize(folder));
    const attrs = (node: Node) => ({ mode: node.folder ? 0o040755 : 0o100644, uid: 0, gid: 0, size: node.data.length, atime: node.mtime, mtime: node.mtime });
    const rename = (reqId: number, from: string, to: string, replace: boolean) => {
      this.log.push(`${replace ? 'POSIX-RENAME' : 'RENAME'} ${from} ${to}`);
      const node = this.files.get(from);
      if (this.options.denyRename || denied(to)) return sftp.status(reqId, STATUS_CODE.PERMISSION_DENIED, 'Permission denied');
      if (this.options.failRenameTo?.includes(to)) return sftp.status(reqId, STATUS_CODE.FAILURE, 'Failure');
      if (!node) return sftp.status(reqId, STATUS_CODE.NO_SUCH_FILE, 'No such file');
      if (this.files.has(to) && !replace) return sftp.status(reqId, STATUS_CODE.FAILURE, 'Failure');
      this.files.delete(from);
      this.files.set(to, node);
      sftp.status(reqId, STATUS_CODE.OK);
    };

    sftp.on('REALPATH', (reqId, path) => {
      const real = resolve(path);
      if (!this.files.has(real)) return sftp.status(reqId, STATUS_CODE.NO_SUCH_FILE, 'No such file');
      sftp.name(reqId, [{ filename: real, longname: real, attrs: attrs(this.files.get(real)!) }]);
    });
    const stat = (reqId: number, path: string) => {
      const node = this.files.get(resolve(path));
      this.log.push(`STAT ${resolve(path)}`);
      if (this.options.denyStat?.includes(resolve(path))) return sftp.status(reqId, STATUS_CODE.PERMISSION_DENIED, 'Permission denied');
      if (!node) return sftp.status(reqId, STATUS_CODE.NO_SUCH_FILE, 'No such file');
      sftp.attrs(reqId, attrs(node));
    };
    sftp.on('STAT', stat);
    sftp.on('LSTAT', stat);
    sftp.on('OPEN', (reqId, filename, flags) => {
      const path = resolve(filename);
      this.log.push(`OPEN ${path} ${utils.sftp.flagsToString(flags)}`);
      if (denied(path)) return sftp.status(reqId, STATUS_CODE.PERMISSION_DENIED, 'Permission denied');
      const parent = this.files.get(parentOf(path));
      if (!parent?.folder) return sftp.status(reqId, STATUS_CODE.NO_SUCH_FILE, 'No such file');
      const there = this.files.get(path);
      if (there && flags & OPEN_MODE.EXCL) return sftp.status(reqId, STATUS_CODE.FAILURE, 'Failure');
      if (!there && !(flags & OPEN_MODE.CREAT)) return sftp.status(reqId, STATUS_CODE.NO_SUCH_FILE, 'No such file');
      if (!there || flags & OPEN_MODE.TRUNC) this.files.set(path, { folder: false, data: Buffer.alloc(0), mtime: Math.floor(Date.now() / 1000) });
      sftp.handle(reqId, handleOf(path, false));
    });
    sftp.on('WRITE', (reqId, handle, offset, data) => {
      const open = handles.get(handle.toString());
      const node = open && this.files.get(open.path);
      if (!open || !node) return sftp.status(reqId, STATUS_CODE.FAILURE, 'Bad handle');
      this.written += data.length;
      if (this.options.hangAfterBytes != null && this.written > this.options.hangAfterBytes) return;
      if (this.options.failAfterBytes != null && this.written > this.options.failAfterBytes) return sftp.status(reqId, STATUS_CODE.FAILURE, 'No space left on device');
      const end = offset + data.length;
      const grown = node.data.length >= end ? node.data : Buffer.concat([node.data, Buffer.alloc(end - node.data.length)]);
      data.copy(grown, offset);
      node.data = grown;
      sftp.status(reqId, STATUS_CODE.OK);
    });
    sftp.on('FSTAT', (reqId, handle) => {
      const open = handles.get(handle.toString());
      const node = open && this.files.get(open.path);
      if (!node) return sftp.status(reqId, STATUS_CODE.FAILURE, 'Bad handle');
      sftp.attrs(reqId, attrs(node));
    });
    sftp.on('CLOSE', (reqId, handle) => {
      const open = handles.get(handle.toString());
      handles.delete(handle.toString());
      if (!open) return sftp.status(reqId, STATUS_CODE.FAILURE, 'Bad handle');
      this.log.push(`CLOSE ${open.path}`);
      sftp.status(reqId, STATUS_CODE.OK);
      if (!open.folder) {
        this.closedFiles++;
        if (this.options.dropAfterFiles != null && this.closedFiles >= this.options.dropAfterFiles) setImmediate(() => client.end());
      }
    });
    sftp.on('OPENDIR', (reqId, path) => {
      const real = resolve(path);
      this.log.push(`OPENDIR ${real}`);
      const node = this.files.get(real);
      if (!node) return sftp.status(reqId, STATUS_CODE.NO_SUCH_FILE, 'No such file');
      if (!node.folder) return sftp.status(reqId, STATUS_CODE.FAILURE, 'Not a directory');
      sftp.handle(reqId, handleOf(real, true));
    });
    sftp.on('READDIR', (reqId, handle) => {
      const open = handles.get(handle.toString());
      if (!open?.folder) return sftp.status(reqId, STATUS_CODE.FAILURE, 'Bad handle');
      const all = this.names(open.path);
      if (open.listed >= all.length + 1) return sftp.status(reqId, STATUS_CODE.EOF);
      const page = [{ filename: '.', longname: '.', attrs: attrs(this.files.get(open.path)!) }, ...all.map((name) => {
        const node = this.files.get(normalize(`${open.path}/${name}`))!;
        return { filename: name, longname: name, attrs: attrs(node) };
      })].slice(open.listed, open.listed + 100);
      open.listed += page.length;
      sftp.name(reqId, page);
    });
    sftp.on('RENAME', (reqId, from, to) => rename(reqId, resolve(from), resolve(to), false));
    sftp.on('REMOVE', (reqId, path) => {
      const real = resolve(path);
      this.log.push(`REMOVE ${real}`);
      if (this.options.denyRemove || denied(real)) return sftp.status(reqId, STATUS_CODE.PERMISSION_DENIED, 'Permission denied');
      if (!this.files.has(real)) return sftp.status(reqId, STATUS_CODE.NO_SUCH_FILE, 'No such file');
      this.files.delete(real);
      sftp.status(reqId, STATUS_CODE.OK);
    });
    sftp.on('EXTENDED', (reqId, name, data) => {
      if (name === 'posix-rename@openssh.com' && this.options.posixRename !== false) {
        const [from, to] = twoStrings(data);
        return rename(reqId, resolve(from), resolve(to), true);
      }
      if (name === 'fsync@openssh.com' && this.options.fsync !== false) {
        this.log.push('FSYNC');
        return sftp.status(reqId, STATUS_CODE.OK);
      }
      sftp.status(reqId, STATUS_CODE.OP_UNSUPPORTED, 'Unsupported');
    });
  }
}
