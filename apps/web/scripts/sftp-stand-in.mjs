#!/usr/bin/env node
// A stand-in SFTP server for the SFTP destination, to check it without a real server. It
// serves a local folder over SFTP on 127.0.0.1, prints its host key fingerprint at start,
// and prints each call. Its host key is made at start, so a restart shows a changed key.
//
//   node apps/web/scripts/sftp-stand-in.mjs --folder /tmp/sftp --password secret
//   node apps/web/scripts/sftp-stand-in.mjs --folder /tmp/sftp --authorized-keys key.pub
//
// Then add an SFTP destination for 127.0.0.1, port 2222, any user, and a folder such as
// /in. Paths are inside --folder, which is both the root and the home folder. Options:
//   --port N               the port, 2222 by default
//   --folder PATH          the folder to serve, made if it is missing
//   --password TEXT        take this password, also as a keyboard-interactive prompt
//   --authorized-keys FILE take the public keys in this file, one per line
//   --no-posix-rename      do not offer posix-rename@openssh.com, so Replace renames aside
//   --deny-rename          refuse every rename, as some file transfer gateways do
//   --slow                 stop answering writes, past Spooldoc's 60 second wait
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { open, readdir, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import ssh2 from 'ssh2';

const { Server, utils } = ssh2;
const { OPEN_MODE, STATUS_CODE } = utils.sftp;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const port = Number(value('--port', '2222'));
const root = resolve(value('--folder', './sftp-stand-in'));
const password = value('--password', null);
const keysFile = value('--authorized-keys', null);
const posixRename = !flag('--no-posix-rename');
const denyRename = flag('--deny-rename');
const slow = flag('--slow');

if (!password && !keysFile) {
  console.error('Give --password or --authorized-keys, so the stand-in can let Spooldoc in.');
  process.exit(1);
}
if (!existsSync(root)) mkdirSync(root, { recursive: true });
const authorized = keysFile
  ? readFileSync(keysFile, 'utf8')
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('#'))
      .map((line) => utils.parseKey(line))
      .filter((key) => !(key instanceof Error))
  : [];

// ssh2 1.17 makes about one Ed25519 key in 256 that it cannot read: make another.
let hostKey;
do hostKey = utils.generateKeyPairSync('ed25519').private;
while (utils.parseKey(hostKey) instanceof Error);
const blob = utils.parseKey(hostKey).getPublicSSH();
console.log(`Host key: 256 SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')} (ED25519)`);

/** A path the client gives, inside the served folder. */
const local = (path) => join(root, resolve('/', path));
const remote = (path) => resolve('/', path);
const methods = () => [...(authorized.length ? ['publickey'] : []), ...(password ? ['password', 'keyboard-interactive'] : [])];

/** The SFTP version answer with the extensions this stand-in has: ssh2's server sends none. */
function advertise(sftp) {
  const names = [...(posixRename ? ['posix-rename@openssh.com'] : []), 'fsync@openssh.com'];
  const parts = names.flatMap((name) => [name, '1']).map((text) => {
    const bytes = Buffer.from(text);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    return Buffer.concat([length, bytes]);
  });
  const body = Buffer.concat([Buffer.from([2, 0, 0, 0, 3]), ...parts]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const packet = Buffer.concat([length, body]);
  const protocol = sftp._protocol;
  const send = protocol.channelData.bind(protocol);
  protocol.channelData = (id, data) => send(id, data.length === 9 && data[4] === 2 ? packet : data);
}

const statusOf = (error) =>
  error.code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : error.code === 'EACCES' || error.code === 'EPERM' ? STATUS_CODE.PERMISSION_DENIED : STATUS_CODE.FAILURE;
const attrsOf = (stats) => ({ mode: stats.mode, uid: 0, gid: 0, size: stats.size, atime: Math.floor(stats.atimeMs / 1000), mtime: Math.floor(stats.mtimeMs / 1000) });

function serve(sftp) {
  const handles = new Map();
  let next = 0;
  const handleOf = (entry) => {
    const handle = Buffer.from(String(next++));
    handles.set(handle.toString(), entry);
    return handle;
  };
  const fail = (id, error) => sftp.status(id, statusOf(error), error.message);
  const doRename = async (id, from, to, replace) => {
    console.log(`${replace ? 'posix-rename' : 'rename'} ${remote(from)} ${remote(to)}`);
    if (denyRename) return sftp.status(id, STATUS_CODE.PERMISSION_DENIED, 'Renames are refused');
    try {
      if (!replace && existsSync(local(to))) return sftp.status(id, STATUS_CODE.FAILURE, 'Failure');
      await rename(local(from), local(to));
      sftp.status(id, STATUS_CODE.OK);
    } catch (error) {
      fail(id, error);
    }
  };

  sftp.on('REALPATH', async (id, path) => {
    const real = remote(path);
    try {
      const stats = await stat(local(real));
      sftp.name(id, [{ filename: real, longname: real, attrs: attrsOf(stats) }]);
    } catch (error) {
      fail(id, error);
    }
  });
  const onStat = async (id, path) => {
    try {
      sftp.attrs(id, attrsOf(await stat(local(path))));
    } catch (error) {
      fail(id, error);
    }
  };
  sftp.on('STAT', onStat);
  sftp.on('LSTAT', onStat);
  sftp.on('OPEN', async (id, path, flags) => {
    console.log(`open ${remote(path)} ${utils.sftp.flagsToString(flags)}`);
    try {
      const mode = flags & OPEN_MODE.EXCL ? 'wx' : flags & OPEN_MODE.TRUNC || flags & OPEN_MODE.CREAT ? 'w' : 'r';
      const file = await open(local(path), mode);
      sftp.handle(id, handleOf({ file, path }));
    } catch (error) {
      fail(id, error);
    }
  });
  sftp.on('WRITE', async (id, handle, offset, data) => {
    const entry = handles.get(handle.toString());
    if (!entry?.file) return sftp.status(id, STATUS_CODE.FAILURE, 'Bad handle');
    if (slow) return;
    try {
      await entry.file.write(data, 0, data.length, offset);
      sftp.status(id, STATUS_CODE.OK);
    } catch (error) {
      fail(id, error);
    }
  });
  sftp.on('CLOSE', async (id, handle) => {
    const entry = handles.get(handle.toString());
    handles.delete(handle.toString());
    await entry?.file?.close();
    sftp.status(id, entry ? STATUS_CODE.OK : STATUS_CODE.FAILURE);
  });
  sftp.on('OPENDIR', async (id, path) => {
    try {
      const names = await readdir(local(path));
      sftp.handle(id, handleOf({ dir: path, names, listed: false }));
    } catch (error) {
      fail(id, error);
    }
  });
  sftp.on('READDIR', async (id, handle) => {
    const entry = handles.get(handle.toString());
    if (!entry?.names) return sftp.status(id, STATUS_CODE.FAILURE, 'Bad handle');
    if (entry.listed) return sftp.status(id, STATUS_CODE.EOF);
    entry.listed = true;
    const list = await Promise.all(entry.names.map(async (name) => ({ filename: name, longname: name, attrs: attrsOf(await stat(join(local(entry.dir), name))) })));
    sftp.name(id, list);
  });
  sftp.on('RENAME', (id, from, to) => doRename(id, from, to, false));
  sftp.on('REMOVE', async (id, path) => {
    console.log(`remove ${remote(path)}`);
    try {
      await rm(local(path));
      sftp.status(id, STATUS_CODE.OK);
    } catch (error) {
      fail(id, error);
    }
  });
  sftp.on('EXTENDED', async (id, name, data) => {
    if (name === 'posix-rename@openssh.com' && posixRename) {
      const a = data.readUInt32BE(0);
      const from = data.subarray(4, 4 + a).toString();
      const b = data.readUInt32BE(4 + a);
      return doRename(id, from, data.subarray(8 + a, 8 + a + b).toString(), true);
    }
    if (name === 'fsync@openssh.com') {
      const length = data.readUInt32BE(0);
      const entry = handles.get(data.subarray(4, 4 + length).toString());
      await entry?.file?.sync();
      return sftp.status(id, STATUS_CODE.OK);
    }
    sftp.status(id, STATUS_CODE.OP_UNSUPPORTED, 'Unsupported');
  });
}

new Server({ hostKeys: [hostKey] }, (client) => {
  client.on('error', (error) => console.log(`connection error: ${error.message}`));
  client.on('authentication', (ctx) => {
    if (ctx.method === 'publickey') {
      const key = authorized.find((known) => known.getPublicSSH().equals(ctx.key.data));
      if (key && (!ctx.signature || key.verify(ctx.blob, ctx.signature, ctx.hashAlgo))) return ctx.accept();
    }
    if (ctx.method === 'password' && password && ctx.password === password) return ctx.accept();
    if (ctx.method === 'keyboard-interactive' && password) {
      return ctx.prompt([{ prompt: 'Password: ', echo: false }], (answers) => (answers[0] === password ? ctx.accept() : ctx.reject(methods())));
    }
    ctx.reject(methods());
  });
  client.on('ready', () => {
    console.log('signed in');
    client.on('session', (accept) => {
      accept().on('sftp', (acceptSftp) => {
        const sftp = acceptSftp();
        advertise(sftp);
        serve(sftp);
      });
    });
  });
}).listen(port, '127.0.0.1', () => console.log(`SFTP stand-in on 127.0.0.1:${port}, serving ${root}`));
