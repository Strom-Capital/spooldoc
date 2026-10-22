import 'server-only';

import { createHash } from 'node:crypto';
import { tempName, writeToken } from '@spooldoc/ibmi';
import ssh2, { type ConnectConfig, type ParsedKey, type SFTPWrapper } from 'ssh2';
import { SFTP_LIST_LIMIT, type HostKeyInfo, type IfExists, type SftpAuth, type SftpHostKey, type SftpKeyType } from '@/lib/destination-config';
import { key, numbered, SUFFIX_TRIES } from './destinations/names';
import { decryptSecret, encryptSecret } from './secrets';

const { Client, utils } = ssh2;
type SshClient = InstanceType<typeof Client>;

/** How long Spooldoc waits. Tests shorten them. */
export const sftpTiming = {
  /** For the connection, the SSH handshake and the sign-in. */
  readyMs: 20_000,
  /** For each SFTP call, such as one write. A server that stops answering ends the connection. */
  opMs: 60_000,
};


/** Bytes per SFTP write. */
const CHUNK = 32 * 1024;
/** Writes in flight at once, so a far server is not waited on for every chunk. */
const IN_FLIGHT = 8;

// ---------------------------------------------------------------------------------------
// Keys and fingerprints
// ---------------------------------------------------------------------------------------

/** The names `ssh-keygen -l` gives each key type. */
const KEY_NAMES: Record<string, string> = {
  'ssh-ed25519': 'ED25519',
  'ssh-rsa': 'RSA',
  'ssh-dss': 'DSA',
  'ecdsa-sha2-nistp256': 'ECDSA',
  'ecdsa-sha2-nistp384': 'ECDSA',
  'ecdsa-sha2-nistp521': 'ECDSA',
  'sk-ssh-ed25519@openssh.com': 'ED25519-SK',
  'sk-ecdsa-sha2-nistp256@openssh.com': 'ECDSA-SK',
};

/** The host key algorithms a connection offers for a key Spooldoc trusts, so a server with several keys shows the trusted one. */
const HOST_KEY_ALGORITHMS: Record<string, string[]> = {
  'ssh-ed25519': ['ssh-ed25519'],
  'ssh-rsa': ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa'],
  'ecdsa-sha2-nistp256': ['ecdsa-sha2-nistp256'],
  'ecdsa-sha2-nistp384': ['ecdsa-sha2-nistp384'],
  'ecdsa-sha2-nistp521': ['ecdsa-sha2-nistp521'],
  'ssh-dss': ['ssh-dss'],
};

/** The SSH strings of a key blob, in order. */
function sshStrings(raw: Buffer, count: number): Buffer[] {
  const out: Buffer[] = [];
  let at = 0;
  while (out.length < count && at + 4 <= raw.length) {
    const length = raw.readUInt32BE(at);
    out.push(raw.subarray(at + 4, at + 4 + length));
    at += 4 + length;
  }
  return out;
}

/** The bits of a big-endian number, without its leading zeros. */
function bitLength(n: Buffer | undefined): number {
  if (!n) return 0;
  let at = 0;
  while (at < n.length && n[at] === 0) at++;
  if (at === n.length) return 0;
  return (n.length - at - 1) * 8 + (32 - Math.clz32(n[at]!));
}

/** The SSH type of a key blob, such as `ssh-ed25519`. */
export const sshKeyType = (raw: Buffer): string => sshStrings(raw, 1)[0]?.toString('latin1') ?? '';

/**
 * A key as `ssh-keygen -l` prints it: `{ type: 'ED25519', bits: 256, fingerprint:
 * 'SHA256:...' }`, from the key in SSH wire format, such as a host key.
 */
export function hostKeyInfo(raw: Buffer): HostKeyInfo {
  const sshType = sshKeyType(raw);
  let bits = 0;
  if (sshType === 'ssh-ed25519' || sshType === 'sk-ssh-ed25519@openssh.com') bits = 256;
  else if (sshType === 'ssh-rsa') bits = bitLength(sshStrings(raw, 3)[2]);
  else if (sshType === 'ssh-dss') bits = bitLength(sshStrings(raw, 2)[1]);
  else if (/nistp(\d+)/.test(sshType)) bits = Number(/nistp(\d+)/.exec(sshType)![1]);
  const fingerprint = `SHA256:${createHash('sha256').update(raw).digest('base64').replace(/=+$/, '')}`;
  return { type: KEY_NAMES[sshType] ?? sshType, bits, fingerprint };
}

/** The key of an OpenSSH public key line, such as `ssh-ed25519 AAAAC3... spooldoc`, or null when it is not one. */
export function publicKeyInfo(line: string | null | undefined): HostKeyInfo | null {
  const base64 = line?.trim().split(/\s+/)[1];
  if (!base64 || !/^[A-Za-z0-9+/]+=*$/.test(base64)) return null;
  const raw = Buffer.from(base64, 'base64');
  return sshKeyType(raw) ? hostKeyInfo(raw) : null;
}

/** A host key as Spooldoc stores it, from the key in SSH wire format. */
export const toHostKey = (raw: Buffer): SftpHostKey => ({ type: sshKeyType(raw), key: raw.toString('base64') });

/** The command that prints the fingerprint of a host key on the server, to compare it by eye. */
export function compareCommand(info: HostKeyInfo): string {
  const file = info.type === 'RSA' ? 'rsa' : info.type === 'ECDSA' ? 'ecdsa' : info.type === 'DSA' ? 'dsa' : 'ed25519';
  return `ssh-keygen -lf /etc/ssh/ssh_host_${file}_key.pub`;
}

/** A comment for a key Spooldoc makes: `spooldoc Invoices to bank`, one line of printable characters. */
const keyComment = (name: string): string => `spooldoc ${name.replace(/[^\x20-\x7e]+/g, ' ')}`.replace(/\s+/g, ' ').trim().slice(0, 100);

/**
 * A new key pair to sign in with: Ed25519, or RSA 4096 for a server that refuses Ed25519.
 * The comment names the destination, so the server's admin can tell the key apart.
 */
export function makeKeyPair(type: SftpKeyType, name: string): { publicKey: string; privateKey: string; key: HostKeyInfo } {
  const comment = keyComment(name);
  // ssh2 1.17 drops a public Ed25519 key's first byte when it is zero, which makes about one
  // key in 256 unreadable. Such a key is made again; it is checked by reading it back.
  for (let tries = 1; ; tries++) {
    const pair = type === 'rsa' ? utils.generateKeyPairSync('rsa', { bits: 4096, comment }) : utils.generateKeyPairSync('ed25519', { comment });
    const publicKey = pair.public.trim();
    const parsed = utils.parseKey(pair.private);
    const ok = !(parsed instanceof Error) && parsed.getPublicSSH().toString('base64') === publicKey.split(' ')[1];
    if (ok) return { publicKey, privateKey: pair.private, key: publicKeyInfo(publicKey)! };
    if (tries >= 10) throw new Error('Could not make a key. Try again.');
  }
}

/** A private key that cannot be used, with the field to fix. */
export class SftpKeyError extends Error {
  constructor(
    message: string,
    readonly field: 'privateKey' | 'passphrase',
  ) {
    super(message);
  }
}

/**
 * Read a private key: OpenSSH, PEM or PuTTY, with its passphrase when it has one.
 *
 * @returns The key, and its public line with its comment
 * @throws SftpKeyError with a message that says what to do
 */
export function parsePrivateKey(text: string, passphrase?: string | null): { key: ParsedKey; publicKey: string } {
  const parsed = utils.parseKey(text.trim(), passphrase || undefined) as ParsedKey | ParsedKey[] | Error;
  if (parsed instanceof Error) {
    const message = parsed.message;
    if (/no passphrase given/i.test(message)) throw new SftpKeyError('This key has a passphrase. Enter it below.', 'passphrase');
    if (/passphrase|decrypt|integrity check failed/i.test(message)) throw new SftpKeyError('The passphrase is wrong.', 'passphrase');
    throw new SftpKeyError('Spooldoc cannot read this key. Paste an OpenSSH, PEM or PuTTY private key.', 'privateKey');
  }
  const key = Array.isArray(parsed) ? parsed[0]! : parsed;
  if (!key.isPrivateKey()) throw new SftpKeyError('This is the public key. Paste the private key: the file without .pub.', 'privateKey');
  const comment = key.comment?.replace(/[^\x20-\x7e]+/g, ' ').trim();
  return { key, publicKey: `${key.type} ${key.getPublicSSH().toString('base64')}${comment ? ` ${comment}` : ''}` };
}

// ---------------------------------------------------------------------------------------
// Tokens the page holds: a key Spooldoc made, and a host key a check saw
// ---------------------------------------------------------------------------------------

/** How long a host key token from a check can be saved with. */
const TOKEN_HOURS = 24;

/** A private key Spooldoc made, sealed for the page to hold until it saves the destination. */
export const sealKey = (privateKey: string): string => encryptSecret(JSON.stringify({ use: 'sftp-key', privateKey }));

/** The private key in a sealed key, or null when it is not one Spooldoc made. */
export function openSealedKey(sealed: string): string | null {
  try {
    const value = JSON.parse(decryptSecret(sealed, 'key')) as { use?: string; privateKey?: string };
    return value.use === 'sftp-key' && typeof value.privateKey === 'string' ? value.privateKey : null;
  } catch {
    return null;
  }
}

/** A host key a check saw on `host` and `port`, signed so the page cannot make one up. */
export const hostKeyToken = (host: string, port: number, hostKey: SftpHostKey): string =>
  encryptSecret(JSON.stringify({ use: 'sftp-host-key', host, port, type: hostKey.type, key: hostKey.key, at: Date.now() }));

/** The host key in a token, when Spooldoc made it for this host and port within the last day. */
export function openHostKeyToken(token: string, host: string, port: number): SftpHostKey | null {
  try {
    const value = JSON.parse(decryptSecret(token, 'host key')) as { use?: string; host?: string; port?: number; type?: string; key?: string; at?: number };
    if (value.use !== 'sftp-host-key' || value.host !== host || value.port !== port || !value.type || !value.key) return null;
    if (typeof value.at !== 'number' || Date.now() - value.at > TOKEN_HOURS * 3600_000) return null;
    return { type: value.type, key: value.key };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------

/** Where a connection got to before it failed. */
export type SftpPhase = 'reach' | 'hostKey' | 'signIn' | 'sftp' | 'work';

/**
 * An SFTP failure in plain words, with what to do. `stops` is true when the connection is
 * gone, so the files not tried yet would fail too.
 */
export class SftpError extends Error {
  constructor(
    message: string,
    readonly phase: SftpPhase,
    readonly detail?: string,
    readonly extra: { stops?: boolean; taken?: boolean; keepPart?: boolean; seenHostKey?: Buffer; reachMs?: number } = {},
  ) {
    super(message);
  }
  /** The connection is gone or cannot be made: the next file would fail too. */
  get stops(): boolean {
    return this.extra.stops ?? this.phase !== 'work';
  }
}

/** What an error is about, for its words. */
export interface SftpErrorContext {
  host: string;
  port: number;
  username: string;
  auth: SftpAuth;
  /** For an error in an SFTP call: what Spooldoc did and on which path. */
  op?: { action: 'write' | 'read' | 'rename' | 'remove' | 'list'; path: string; folder: string };
  /** The methods the server offered for sign-in, when it refused one. */
  methods?: string[] | null;
  /** The algorithms the server offered, by kind, when the handshake failed. */
  offered?: Record<string, string>;
  /** The phase the connection reached. */
  phase?: SftpPhase;
}

/** SFTP status codes. */
const STATUS = utils.sftp.STATUS_CODE;

/** The words for the sign-in methods a server offers: "a key", "a password". */
function methodWords(methods: string[]): string {
  const words = new Set<string>();
  for (const method of methods) {
    if (method === 'publickey') words.add('a key');
    else if (method === 'password' || method === 'keyboard-interactive') words.add('a password');
    else if (method !== 'none') words.add(method);
  }
  const list = [...words];
  return list.length === 0 ? 'no method Spooldoc has' : list.length === 1 ? `${list[0]} only` : list.join(' or ');
}

/** The kind of algorithm a handshake failure is about, as ssh2's debug lines name it. */
const ALGORITHM_KINDS: [RegExp, string, string][] = [
  [/key exchange/i, 'KEX method', 'key exchange method'],
  [/host key/i, 'Host key format', 'host key type'],
  [/cipher/i, 'C->S cipher', 'cipher'],
  [/MAC/i, 'C->S MAC', 'MAC'],
  [/compression/i, 'C->S compression', 'compression'],
];

/**
 * An error in plain words: what went wrong, and what to do next, with the server's own
 * text as the detail. A timeout names the host and the port.
 */
export function sftpErrorText(err: unknown, ctx: SftpErrorContext): { message: string; detail?: string } {
  if (err instanceof SftpError) return { message: err.message, detail: err.detail };
  const e = (err ?? {}) as { message?: string; code?: string | number; level?: string };
  const raw = typeof e.message === 'string' ? e.message : String(err);
  const detail = typeof e.code === 'string' && !raw.includes(e.code) ? `${e.code}: ${raw}` : raw;
  const { host, port, username } = ctx;
  const firewall = 'Check the host, the port and the firewall between Spooldoc and the server.';

  if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN' || e.level === 'client-dns') return { message: `Could not find ${host}. Check the host name.`, detail };
  if (e.code === 'ECONNREFUSED') return { message: `${host} refused the connection on port ${port}. Check the port, and that the SSH server runs.`, detail };
  if (e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH' || e.code === 'EADDRNOTAVAIL') return { message: `Could not reach ${host} on port ${port}. ${firewall}`, detail };
  if (e.level === 'client-timeout' || e.code === 'ETIMEDOUT') {
    if (ctx.phase && ctx.phase !== 'reach') {
      return {
        message: `${host} took the connection on port ${port} but did not finish the SSH sign-in within ${Math.round(sftpTiming.readyMs / 1000)} seconds. Check that port ${port} is the SSH server's.`,
        detail,
      };
    }
    return { message: `No answer from ${host} on port ${port} within ${Math.round(sftpTiming.readyMs / 1000)} seconds. ${firewall}`, detail };
  }
  if (e.code === 'ECONNRESET' || e.code === 'EPIPE') {
    return { message: `${host} closed the connection on port ${port}. Check that the port is the SSH server's, and that the server lets Spooldoc in.`, detail };
  }
  if (e.level === 'protocol' && /identification|header/i.test(raw)) {
    return { message: `${host} did not answer as an SSH server on port ${port}. Check the port.`, detail };
  }
  if (e.level === 'handshake' && /no matching/i.test(raw)) {
    const kind = ALGORITHM_KINDS.find(([test]) => test.test(raw));
    const offered = kind && ctx.offered?.[kind[1]];
    const what = kind?.[2] ?? 'algorithm';
    return {
      message: `Spooldoc and ${host} have no ${what} in common${offered ? `. The server offers ${offered.split(',').join(', ')}` : ''}. Ask the server's admin to allow a current one.`,
      detail,
    };
  }
  if (e.level === 'client-authentication') {
    const methods = ctx.methods ?? null;
    const offers = (method: string) => methods === null || methods.includes(method);
    if (ctx.auth === 'password') {
      if (!offers('password') && !offers('keyboard-interactive')) {
        return { message: `${host} does not take a password for ${username}: it takes ${methodWords(methods ?? [])}. Sign in with a key instead.`, detail };
      }
      return { message: `${host} did not accept the password for ${username}. Check the user and the password.`, detail };
    }
    if (!offers('publickey')) {
      return { message: `${host} does not take a key for ${username}: it takes ${methodWords(methods ?? [])}. Sign in with a password instead.`, detail };
    }
    return {
      message: `${host} did not accept the key for ${username}. Add the destination's public key to ~/.ssh/authorized_keys of ${username} on the server.`,
      detail,
    };
  }
  if (/Unable to start subsystem/i.test(raw)) {
    return { message: `${host} does not offer SFTP to ${username}. Ask the server's admin to allow SFTP for the user.`, detail };
  }
  if (typeof e.code === 'number' && ctx.op) {
    const { action, path, folder } = ctx.op;
    if (e.code === STATUS.NO_SUCH_FILE) return { message: `${path} does not exist on ${host}.`, detail };
    if (e.code === STATUS.PERMISSION_DENIED) {
      if (action === 'read' || action === 'list') return { message: `${username} may not read ${path} on ${host}. Ask the server's admin for access to the folder.`, detail };
      return { message: `${username} may not write to ${folder} on ${host}. Ask the server's admin for write access to the folder.`, detail };
    }
    if (e.code === STATUS.OP_UNSUPPORTED) return { message: `${host} does not support what Spooldoc asked for on ${path}. The server's own text is under Details.`, detail };
    const verb = { write: 'write', read: 'read', rename: 'rename', remove: 'delete', list: 'list' }[action];
    return { message: `${host} could not ${verb} ${path}. The server's own text is under Details.`, detail };
  }
  if (/No response from server|Not connected|closed/i.test(raw)) {
    return { message: `${host} closed the connection. Check that the server is up, then retry the run.`, detail };
  }
  return { message: `Could not use ${host}. The server's own text is under Details.`, detail };
}

// ---------------------------------------------------------------------------------------
// The connection
// ---------------------------------------------------------------------------------------

/** Who to connect as, how, and the host key to trust. */
export interface SftpTarget {
  host: string;
  port: number;
  username: string;
  auth: SftpAuth;
  privateKey?: string | null;
  passphrase?: string | null;
  password?: string | null;
  /** The host key Spooldoc trusts. Without one, the connection stops at the host key. */
  hostKey: SftpHostKey | null;
}

/** An open SFTP session. Every call has a watchdog: a server that stops answering ends the connection. */
export interface SftpSession {
  sftp: SFTPWrapper;
  /** How long the connection took to reach the host. */
  reachMs: number;
  /** The host key the server showed. */
  hostKey: HostKeyInfo;
  /** The server supports `posix-rename@openssh.com`, a rename that replaces. */
  posixRename: boolean;
  /** The server supports `fsync@openssh.com`. */
  fsync: boolean;
  ctx: SftpErrorContext;
  /** The connection is gone: closed, dropped, or ended by the watchdog. */
  readonly closed: boolean;
  close(): void;
  /** One SFTP call, with the watchdog. `doing` finishes "stopped answering while Spooldoc ...". */
  call<T>(doing: string, run: (done: (err: Error | null | undefined, value?: T) => void) => void): Promise<T>;
}

/** True when an ssh2 SFTP extension is there: its call throws at once when the server does not have it. */
function hasExtension(sftp: SFTPWrapper, name: string): boolean {
  const extensions = (sftp as unknown as { _extensions?: Record<string, string> })._extensions ?? {};
  return name in extensions;
}

/**
 * Connect and open SFTP. The host key must be the one Spooldoc trusts: the connection
 * offers only that key's type, and stops before sign-in when the key is another, or when
 * no key is trusted yet, so a password is never sent to a host Spooldoc does not know.
 *
 * @throws SftpError with the phase it got to; for a host key that is not trusted, the key the server showed
 */
export function connectSftp(target: SftpTarget): Promise<SftpSession> {
  const { host, port, username, auth } = target;
  const client: SshClient = new Client();
  const started = performance.now();
  const pinned = target.hostKey ? Buffer.from(target.hostKey.key, 'base64') : null;
  const ctx: SftpErrorContext = { host, port, username, auth, methods: null, offered: {}, phase: 'reach' };
  let reachMs = 0;
  let seen: Buffer | null = null;
  let closed = false;

  // The sign-in: the key, or the password, also as an answer to a keyboard-interactive prompt.
  let tried = 0;
  const authHandler: ConnectConfig['authHandler'] = (methodsLeft, _partial, next) => {
    if (methodsLeft) ctx.methods = methodsLeft;
    tried++;
    if (auth === 'password') {
      const password = target.password ?? '';
      if (tried === 1) return next({ type: 'password', username, password });
      if (tried === 2 && methodsLeft?.includes('keyboard-interactive')) {
        return next({
          type: 'keyboard-interactive',
          username,
          prompt: (_name, _instructions, _lang, prompts, finish) =>
            finish(prompts.map((prompt, index) => (prompts.length === 1 || /pass/i.test(prompt.prompt) || index === 0 ? password : ''))),
        });
      }
      return next(false as never);
    }
    if (tried === 1 && target.privateKey) return next({ type: 'publickey', username, key: target.privateKey, passphrase: target.passphrase || undefined });
    return next(false as never);
  };

  return new Promise<SftpSession>((resolve, reject) => {
    let settled = false;
    let sftpTimer: ReturnType<typeof setTimeout> | undefined;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(sftpTimer);
      client.destroy();
      if (err instanceof SftpError) return reject(err);
      const { message, detail } = sftpErrorText(err, ctx);
      reject(new SftpError(message, ctx.phase ?? 'reach', detail, { seenHostKey: seen ?? undefined, reachMs }));
    };

    client.on('connect', () => {
      reachMs = Math.round(performance.now() - started);
      ctx.phase = 'hostKey';
    });
    client.on('error', fail);
    client.on('close', () => {
      closed = true;
      fail(Object.assign(new Error('The connection closed before the sign-in.'), { code: 'ECONNRESET' }));
    });
    client.on('ready', () => {
      ctx.phase = 'sftp';
      // readyTimeout ends at the sign-in: a server that never answers the SFTP request is ended here.
      sftpTimer = setTimeout(() => {
        fail(
          new SftpError(
            `${host} signed in ${username} on port ${port} but did not start SFTP within ${Math.round(sftpTiming.readyMs / 1000)} seconds. Ask the server's admin to check that SFTP is on for the user.`,
            'sftp',
            undefined,
            { reachMs },
          ),
        );
      }, sftpTiming.readyMs);
      client.sftp((err, sftp) => {
        clearTimeout(sftpTimer);
        if (settled) return;
        if (err) {
          return fail(new SftpError(`${host} does not offer SFTP to ${username}. Ask the server's admin to allow SFTP for the user.`, 'sftp', err.message));
        }
        ctx.phase = 'work';
        settled = true;
        const session: SftpSession = {
          sftp,
          reachMs,
          hostKey: hostKeyInfo(seen!),
          posixRename: hasExtension(sftp, 'posix-rename@openssh.com'),
          fsync: hasExtension(sftp, 'fsync@openssh.com'),
          ctx,
          get closed() {
            return closed;
          },
          close: () => client.end(),
          call<T>(doing: string, run: (done: (err: Error | null | undefined, value?: T) => void) => void) {
            return new Promise<T>((resolveCall, rejectCall) => {
              if (closed) return rejectCall(new SftpError(`${host} closed the connection before Spooldoc ${doing}.`, 'work', undefined, { stops: true }));
              const watchdog = setTimeout(() => {
                closed = true;
                client.destroy();
                rejectCall(new SftpError(`${host} stopped answering while Spooldoc ${doing}.`, 'work', `No answer within ${Math.round(sftpTiming.opMs / 1000)} seconds.`, { stops: true }));
              }, sftpTiming.opMs);
              try {
                run((err, value) => {
                  clearTimeout(watchdog);
                  if (err) {
                    // A call that fails because the connection went is not about this file.
                    if (closed || (typeof (err as { code?: unknown }).code !== 'number' && /No response|closed|Not connected/i.test(err.message))) {
                      closed = true;
                      return rejectCall(new SftpError(`${host} closed the connection while Spooldoc ${doing}.`, 'work', err.message, { stops: true }));
                    }
                    return rejectCall(err);
                  }
                  resolveCall(value as T);
                });
              } catch (err) {
                clearTimeout(watchdog);
                rejectCall(err);
              }
            });
          },
        };
        // After the session is open, a closed connection is seen by the calls.
        client.removeAllListeners('close');
        client.on('close', () => {
          closed = true;
        });
        client.removeAllListeners('error');
        client.on('error', () => {
          closed = true;
        });
        resolve(session);
      });
    });

    try {
      client.connect({
        host,
        port,
        username,
        readyTimeout: sftpTiming.readyMs,
        keepaliveInterval: 10_000,
        tryKeyboard: auth === 'password',
        authHandler,
        algorithms: pinned ? { serverHostKey: (HOST_KEY_ALGORITHMS[target.hostKey!.type] ?? [target.hostKey!.type]) as never } : undefined,
        hostVerifier: (raw: Buffer) => {
          seen = Buffer.from(raw);
          if (!pinned || !raw.equals(pinned)) {
            const info = hostKeyInfo(seen);
            const message = pinned
              ? `The host key of ${host} is not the one Spooldoc trusts. Spooldoc trusts ${hostKeyInfo(pinned).fingerprint}, and the server showed ${info.fingerprint}. If the server's admin changed it, open the destination and trust the new key. If not, do not: something may be between Spooldoc and the server.`
              : `The host key of ${host} is not trusted yet. Open the destination, check the connection and trust the key.`;
            fail(new SftpError(message, 'hostKey', `${info.type} ${info.bits} ${info.fingerprint}`, { seenHostKey: seen, reachMs }));
            return false;
          }
          ctx.phase = 'signIn';
          return true;
        },
        debug: (line: string) => {
          const match = /^Handshake: \(remote\) (.+?): (.*)$/.exec(line);
          if (match) ctx.offered![match[1]!] = match[2]!;
        },
      });
    } catch (err) {
      fail(err);
    }
  });
}

// ---------------------------------------------------------------------------------------
// Folders and files
// ---------------------------------------------------------------------------------------

/** A path in a folder. */
export const inFolder = (folder: string, name: string): string => (folder === '/' ? `/${name}` : `${folder}/${name}`);

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;

/** True when an SFTP call failed because nothing is at the path. */
export const isNoSuchFile = (err: unknown): boolean => (err as { code?: unknown } | null)?.code === STATUS.NO_SUCH_FILE;

/** What is at a path: a folder, a file, or nothing. */
export async function statPath(s: SftpSession, path: string, doing: string): Promise<'folder' | 'file' | null> {
  try {
    const stats = await s.call<{ mode: number }>(doing, (done) => s.sftp.stat(path, done));
    return (stats.mode & S_IFMT) === S_IFDIR ? 'folder' : 'file';
  } catch (err) {
    if (isNoSuchFile(err)) return null;
    throw err;
  }
}

/**
 * Find a folder on the server: its absolute path, as the server resolves it (a relative
 * folder is in the user's home folder), or an error that says it is missing, is a file or
 * cannot be read. Spooldoc never creates it.
 *
 * @throws SftpError that stops the run
 */
export async function findFolder(s: SftpSession, folder: string): Promise<string> {
  const { host } = s.ctx;
  const doing = `looked for ${folder}`;
  const missing = () => new SftpError(`The folder ${folder} does not exist on ${host}. Create it, or change the destination's folder.`, 'work', undefined, { stops: true });
  const mapped = (err: unknown, path: string) => {
    if (err instanceof SftpError) return err;
    if ((err as { code?: unknown }).code === STATUS.NO_SUCH_FILE) return missing();
    const { message, detail } = sftpErrorText(err, { ...s.ctx, op: { action: 'list', path, folder } });
    return new SftpError(message, 'work', detail, { stops: true });
  };
  let real: string;
  try {
    real = await s.call<string>(doing, (done) => s.sftp.realpath(folder, done));
  } catch (err) {
    throw mapped(err, folder);
  }
  let at: 'folder' | 'file' | null;
  try {
    at = await statPath(s, real, doing);
  } catch (err) {
    throw mapped(err, real);
  }
  if (at === 'file') throw new SftpError(`${folder} on ${host} is a file, not a folder. Change the destination's folder.`, 'work', undefined, { stops: true });
  if (at === null) throw missing();
  return real;
}

/** A file in a folder. */
export interface SftpEntry {
  name: string;
  size: number;
  /** Seconds since 1970; null when the server does not say. */
  mtime: number | null;
  folder: boolean;
}

/**
 * The entries of a folder, without `.` and `..`, at most `limit`. `truncated` is true when
 * the folder holds more.
 */
export async function listFolder(s: SftpSession, folder: string, limit = SFTP_LIST_LIMIT): Promise<{ entries: SftpEntry[]; truncated: boolean }> {
  const doing = `listed ${folder}`;
  const ctx = { ...s.ctx, op: { action: 'list' as const, path: folder, folder } };
  let handle: Buffer;
  try {
    handle = await s.call<Buffer>(doing, (done) => s.sftp.opendir(folder, done));
  } catch (err) {
    if (err instanceof SftpError) throw err;
    const { message, detail } = sftpErrorText(err, ctx);
    throw new SftpError(message, 'work', detail, { stops: true });
  }
  const entries: SftpEntry[] = [];
  let truncated = false;
  try {
    for (;;) {
      let batch: { filename: string; attrs: { size: number; mtime: number; mode: number } }[];
      try {
        batch = await s.call(doing, (done) => s.sftp.readdir(handle, done));
      } catch (err) {
        if ((err as { code?: unknown }).code === STATUS.EOF) break;
        if (err instanceof SftpError) throw err;
        const { message, detail } = sftpErrorText(err, ctx);
        throw new SftpError(message, 'work', detail, { stops: true });
      }
      if (!batch || batch.length === 0) break;
      for (const entry of batch) {
        if (entry.filename === '.' || entry.filename === '..') continue;
        if (entries.length >= limit) {
          truncated = true;
          break;
        }
        entries.push({
          name: entry.filename,
          size: entry.attrs.size ?? 0,
          mtime: typeof entry.attrs.mtime === 'number' ? entry.attrs.mtime : null,
          folder: (entry.attrs.mode & S_IFMT) === S_IFDIR,
        });
      }
      if (truncated) break;
    }
  } finally {
    await s.call(doing, (done) => s.sftp.close(handle, done)).catch(() => undefined);
  }
  return { entries, truncated };
}

/** What `uploadFile` did. */
export interface UploadResult {
  /** The name the file has in the folder: its own, or with a number. */
  finalName: string;
  replaced: boolean;
  /** A replaced file Spooldoc renamed aside and could not delete. */
  leftover?: string;
}

/** Options of an upload. */
export interface UploadOptions {
  ifExists: IfExists;
  /** Write a `.part` file first and rename it when it is whole. */
  tempName: boolean;
  /** Names other files of the run use, as `key` gives them, which Add a number skips. */
  avoid?: Set<string>;
  /** For Add a number: the first number to try, when the name itself is known to be taken. */
  first?: number;
}

/**
 * Upload one file. With `tempName`, the bytes go to `.name.<token>.part` first, which is
 * synced when the server can, closed, and then renamed into place, so a program that
 * watches the folder sees whole files only:
 *
 * - Replace uses the server's atomic `posix-rename@openssh.com` when it has it. Else a
 *   file in the way is renamed aside to `.name.<token>.old`, the new one renamed in, and
 *   the old one deleted; if the new one cannot be renamed in, the old one is put back.
 * - Fail the run renames without replacing: a taken name fails this file.
 * - Add a number renames to the next free name, up to 10 tries.
 *
 * Without `tempName`, the file is written under its name: Replace opens it to overwrite,
 * the others open it only when no file has the name.
 *
 * @throws SftpError, with `extra.taken` when the name is taken and `stops` when the connection is gone
 */
export async function uploadFile(s: SftpSession, folder: string, name: string, bytes: Uint8Array, options: UploadOptions): Promise<UploadResult> {
  const { host } = s.ctx;
  const doing = `uploaded ${options.first && options.first > 1 ? numbered(name, options.first) : name}`;
  const path = (file: string) => inFolder(folder, file);
  const fail = (err: unknown, action: NonNullable<SftpErrorContext['op']>['action'], at: string): SftpError => {
    if (err instanceof SftpError) return err;
    const { message, detail } = sftpErrorText(err, { ...s.ctx, op: { action, path: at, folder } });
    return new SftpError(message, 'work', detail, { stops: false });
  };
  const exists = async (file: string) => (await statPath(s, path(file), doing)) !== null;
  const takenError = (file: string) =>
    new SftpError(
      `${file} is already in ${folder}: another run or program put it there after this run looked. It was not replaced. Change "When a file with the same name exists" or move the old file.`,
      'work',
      undefined,
      { stops: false, taken: true },
    );
  const candidates = (): string[] => {
    if (options.ifExists !== 'suffix') return [name];
    const out: string[] = [];
    for (let n = options.first ?? 1; out.length < SUFFIX_TRIES; n++) {
      const candidate = n === 1 ? name : numbered(name, n);
      if (n > 1 && options.avoid?.has(key(candidate))) continue;
      out.push(candidate);
    }
    return out;
  };

  /** Errors of `writeWhole` after the open: the file is there, but not whole. */
  const afterOpen = new WeakSet<SftpError>();
  const written = (err: unknown, file: string): SftpError => {
    const error = fail(err, 'write', file);
    afterOpen.add(error);
    return error;
  };
  /** Open, write in chunks, sync when the server can, and close. */
  const writeWhole = async (file: string, flags: 'w' | 'wx') => {
    let handle: Buffer;
    try {
      handle = await s.call<Buffer>(doing, (done) => s.sftp.open(file, flags, done));
    } catch (err) {
      throw fail(err, 'write', file);
    }
    try {
      const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const writes: Promise<void>[] = [];
      for (let at = 0; at < buffer.length; at += CHUNK) {
        const length = Math.min(CHUNK, buffer.length - at);
        const offset = at;
        const write = s.call<void>(doing, (done) => s.sftp.write(handle, buffer, offset, length, offset, done));
        // Seen as handled: a failed write is thrown where it is awaited, below.
        write.catch(() => undefined);
        writes.push(write);
        if (writes.length >= IN_FLIGHT) await writes.shift();
      }
      await Promise.all(writes);
      if (s.fsync) await s.call(doing, (done) => s.sftp.ext_openssh_fsync(handle, done));
    } catch (err) {
      await s.call(doing, (done) => s.sftp.close(handle, done)).catch(() => undefined);
      throw written(err, file);
    }
    try {
      await s.call(doing, (done) => s.sftp.close(handle, done));
    } catch (err) {
      throw written(err, file);
    }
  };
  /** The error of a write that failed after Spooldoc created the file, after the incomplete file is deleted. */
  const removeWritten = async (err: SftpError, file: string): Promise<SftpError> => {
    try {
      await s.call(doing, (done) => s.sftp.unlink(path(file), done));
      return err;
    } catch (unlinkErr) {
      if (isNoSuchFile(unlinkErr)) return err;
      return new SftpError(`${err.message} The incomplete file ${path(file)} could not be deleted. Delete it.`, err.phase, err.detail, err.extra);
    }
  };
  const rename = (from: string, to: string) => s.call<void>(doing, (done) => s.sftp.rename(path(from), path(to), done));

  if (!options.tempName) {
    if (options.ifExists === 'replace') {
      const replaced = await exists(name);
      try {
        await writeWhole(path(name), 'w');
      } catch (err) {
        if (!(err instanceof SftpError) || !afterOpen.has(err)) throw err;
        throw new SftpError(`${err.message} ${path(name)} on ${host} is incomplete now. Upload it again.`, err.phase, err.detail, err.extra);
      }
      return { finalName: name, replaced };
    }
    for (const candidate of candidates()) {
      try {
        await writeWhole(path(candidate), 'wx');
        return { finalName: candidate, replaced: false };
      } catch (err) {
        // The open took the name, so it was free: the write failed, not the name.
        if (err instanceof SftpError && afterOpen.has(err)) throw await removeWritten(err, candidate);
        if (err instanceof SftpError && err.stops) throw err;
        // Only an open that fails can mean another file has the name.
        if (!(await exists(candidate))) throw err;
        if (options.ifExists === 'fail') throw takenError(candidate);
      }
    }
    throw takenError(name);
  }

  const token = writeToken();
  const part = tempName(name, token, 'part');
  const removePart = async (): Promise<string> => {
    try {
      await s.call(doing, (done) => s.sftp.unlink(path(part), done));
      return '';
    } catch (err) {
      if ((err as { code?: unknown }).code === STATUS.NO_SUCH_FILE) return '';
      return ` The part file ${path(part)} could not be deleted. Delete it.`;
    }
  };
  /** The error, after the part file is deleted. */
  const failed = async (err: SftpError): Promise<SftpError> => {
    if (err.stops || err.extra.keepPart) return err;
    const note = await removePart();
    return note ? new SftpError(`${err.message}${note}`, err.phase, err.detail, err.extra) : err;
  };
  const renameRefused = (err: unknown, to: string): SftpError => {
    const code = (err as { code?: unknown }).code;
    if (code === STATUS.PERMISSION_DENIED || code === STATUS.OP_UNSUPPORTED) {
      return new SftpError(
        `${host} did not let Spooldoc rename ${part} to ${to}. If the server refuses renames, turn off "Write each file under a temporary name first" on the destination.`,
        'work',
        (err as Error).message,
        { stops: false },
      );
    }
    return fail(err, 'rename', path(to));
  };

  try {
    await writeWhole(path(part), 'wx');
  } catch (err) {
    throw await failed(fail(err, 'write', path(part)));
  }

  try {
    if (options.ifExists === 'replace') {
      if (s.posixRename) {
        const replaced = await exists(name);
        try {
          await s.call<void>(doing, (done) => s.sftp.ext_openssh_rename(path(part), path(name), done));
        } catch (err) {
          throw renameRefused(err, name);
        }
        return { finalName: name, replaced };
      }
      try {
        await rename(part, name);
        return { finalName: name, replaced: false };
      } catch (err) {
        if (err instanceof SftpError && err.stops) throw err;
        if (!(await exists(name))) throw renameRefused(err, name);
      }
      // A file has the name: rename it aside, rename the new one in, then delete the old one.
      const old = tempName(name, token, 'old');
      try {
        await rename(name, old);
      } catch (err) {
        if (err instanceof SftpError && err.stops) throw err;
        throw new SftpError(
          `${path(name)} could not be renamed to ${old} to replace it. The old file is unchanged. Check that ${s.ctx.username} may rename files in ${folder}.`,
          'work',
          (err as Error).message,
          { stops: false },
        );
      }
      try {
        await rename(part, name);
      } catch (err) {
        if (err instanceof SftpError && err.stops) throw err;
        try {
          await rename(old, name);
        } catch {
          throw new SftpError(
            `The new file could not be renamed to ${path(name)}, and the old file could not be put back. The old file is now ${path(old)} and the new one ${path(part)}. Rename the one to keep to ${name}.`,
            'work',
            (err as Error).message,
            // The part file is the new file now: it is kept.
            { stops: false, keepPart: true },
          );
        }
        throw new SftpError(`The new file could not be renamed to ${path(name)}. The old file is back in place, unchanged.`, 'work', (err as Error).message, { stops: false });
      }
      try {
        await s.call(doing, (done) => s.sftp.unlink(path(old), done));
        return { finalName: name, replaced: true };
      } catch (err) {
        if (err instanceof SftpError && err.stops) throw err;
        return { finalName: name, replaced: true, leftover: old };
      }
    }

    // Fail the run and Add a number: a plain rename, which never replaces under SFTP.
    for (const candidate of candidates()) {
      try {
        await rename(part, candidate);
        return { finalName: candidate, replaced: false };
      } catch (err) {
        if (err instanceof SftpError && err.stops) throw err;
        if (!(await exists(candidate))) throw renameRefused(err, candidate);
        if (options.ifExists === 'fail') throw takenError(candidate);
      }
    }
    throw takenError(name);
  } catch (err) {
    throw await failed(err instanceof SftpError ? err : fail(err, 'rename', path(name)));
  }
}
