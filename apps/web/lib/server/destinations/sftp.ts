import 'server-only';

import { redact } from '@spooldoc/ibmi';
import { and, eq } from 'drizzle-orm';
import { sftpConfigSchema, sftpServer, type SftpConfig, type SftpConfigView, type SftpSecretsInput } from '@/lib/destination-config';
import { getDb } from '../db';
import { runDeliveries, runs } from '../db/schema';
import { decryptSecret, encryptSecret } from '../secrets';
import {
  connectSftp,
  findFolder,
  hostKeyInfo,
  inFolder,
  openHostKeyToken,
  openSealedKey,
  parsePrivateKey,
  publicKeyInfo,
  SftpError,
  SftpKeyError,
  statPath,
  uploadFile,
  type SftpSession,
  type SftpTarget,
} from '../sftp';
import { StepError } from '../step-error';
import type { DeliverInput, Destination } from './index';
import { key, numbered, ownNames } from './names';
import { deliveryFailed, deliveryRecorder, earlierText } from './deliveries';
import { nFiles, storeRunFiles } from './store';

/** The secrets of an SFTP destination, kept encrypted in `destinations.secrets_enc`. */
export interface SftpSecrets {
  privateKey: string | null;
  passphrase: string | null;
  password: string | null;
}

const NO_SECRETS: SftpSecrets = { privateKey: null, passphrase: null, password: null };

/** Seal the secrets of an SFTP destination for `destinations.secrets_enc`. */
export const sealSftpSecrets = (secrets: SftpSecrets): string => encryptSecret(JSON.stringify(secrets));

/**
 * The secrets of an SFTP destination. None saved gives none.
 *
 * @throws Error when they cannot be decrypted, such as after SPOOLDOC_SECRET_KEY changed
 */
export function openSftpSecrets(sealed: string | null): SftpSecrets {
  if (!sealed) return { ...NO_SECRETS };
  const parsed = JSON.parse(decryptSecret(sealed, 'key or password')) as Partial<SftpSecrets>;
  return { privateKey: parsed.privateKey ?? null, passphrase: parsed.passphrase ?? null, password: parsed.password ?? null };
}

/** The values to keep out of every error: the private key, its passphrase and the password. */
export const sftpSecretValues = (secrets: SftpSecrets): string[] => [secrets.privateKey, secrets.passphrase, secrets.password].filter((s): s is string => !!s && s.length > 0);

/** An SFTP destination as the pages see it: never the secrets. */
export function sftpConfigView(config: SftpConfig, sealed: string | null): SftpConfigView {
  let secrets: SftpSecrets = NO_SECRETS;
  try {
    secrets = openSftpSecrets(sealed);
  } catch {
    // Secrets that cannot be decrypted show as none; a run says why.
  }
  const { hostKey, ...rest } = config;
  return {
    ...rest,
    hostKey: hostKey ? hostKeyInfo(Buffer.from(hostKey.key, 'base64')) : null,
    key: publicKeyInfo(config.publicKey),
    hasKey: !!secrets.privateKey,
    hasPassword: !!secrets.password,
  };
}

/** Where a connection goes and with what, from the settings and the secrets. */
export const sftpTargetOf = (config: SftpConfig, secrets: SftpSecrets): SftpTarget => ({
  host: config.host,
  port: config.port,
  username: config.username,
  auth: config.auth,
  privateKey: config.auth === 'password' ? null : secrets.privateKey,
  passphrase: config.auth === 'own-key' ? secrets.passphrase : null,
  password: config.auth === 'password' ? secrets.password : null,
  hostKey: config.hostKey,
});

/** What a save or a check gives: the settings and secrets to use, or the field to fix. */
export type SftpResolved = { config: SftpConfig; secrets: SftpSecrets } | { error: string; field: string; status?: number };

/**
 * The settings and secrets of an SFTP destination after a change, from what the page sent
 * and what is saved:
 *
 * - The key Spooldoc made comes sealed from `sftp-key`; the saved one stays otherwise.
 * - A pasted key is read with its passphrase; the saved one stays when none is pasted.
 * - The saved password is used only for the host, port and user it was entered for.
 * - The host key is the one in the token from Check connection, for this host and port,
 *   or the saved one while the host and port stay. A `hostKey` the page made up is refused.
 *
 * Only the secrets of the chosen way to sign in are kept.
 */
export function resolveSftp(
  input: { config: unknown; secrets?: SftpSecretsInput; sealedKey?: string; hostKeyToken?: string | null },
  saved: { config: SftpConfig | null; secrets: SftpSecrets | null } = { config: null, secrets: null },
  use: 'save' | 'check' = 'save',
): SftpResolved {
  const parsed = sftpConfigSchema.safeParse(input.config);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue?.message ?? 'The settings are not valid.', field: ['config', ...(issue?.path ?? [])].join('.') };
  }
  const config: SftpConfig = { ...parsed.data };
  const old = saved.config;
  const oldSecrets = saved.secrets ?? NO_SECRETS;
  const given = input.secrets ?? {};
  const secrets: SftpSecrets = { ...NO_SECRETS };

  if (config.auth === 'password') {
    const sameTarget = old !== null && old.auth === 'password' && old.host === config.host && old.port === config.port && old.username === config.username;
    if (given.password) secrets.password = given.password;
    else if (sameTarget && oldSecrets.password) secrets.password = oldSecrets.password;
    else if (old?.auth === 'password' && oldSecrets.password) return { error: 'Enter the password again for the new server or user.', field: 'secrets.password' };
    else return { error: 'Enter the password.', field: 'secrets.password' };
    config.publicKey = null;
  } else if (config.auth === 'spooldoc-key') {
    if (input.sealedKey) {
      const privateKey = openSealedKey(input.sealedKey);
      if (!privateKey) return { error: 'The key could not be read. Make a new key.', field: 'sealedKey' };
      secrets.privateKey = privateKey;
    } else if (old?.auth === 'spooldoc-key' && oldSecrets.privateKey) {
      secrets.privateKey = oldSecrets.privateKey;
    } else {
      return { error: 'Make the key first.', field: 'sealedKey' };
    }
    config.publicKey = parsePrivateKey(secrets.privateKey).publicKey;
  } else {
    const pasted = given.privateKey?.trim();
    if (pasted) {
      secrets.privateKey = pasted;
      secrets.passphrase = given.passphrase || null;
    } else if (old?.auth === 'own-key' && oldSecrets.privateKey) {
      secrets.privateKey = oldSecrets.privateKey;
      secrets.passphrase = given.passphrase || oldSecrets.passphrase;
    } else {
      return { error: 'Paste the private key.', field: 'secrets.privateKey' };
    }
    try {
      config.publicKey = parsePrivateKey(secrets.privateKey, secrets.passphrase).publicKey;
    } catch (error) {
      if (error instanceof SftpKeyError) return { error: error.message, field: `secrets.${error.field}` };
      throw error;
    }
  }

  // The host key: only from a check of this host and port, or the saved one while they stay.
  const sent = (input.config as { hostKey?: unknown } | null)?.hostKey ?? null;
  const fromToken = input.hostKeyToken ? openHostKeyToken(input.hostKeyToken, config.host, config.port) : null;
  if (input.hostKeyToken && !fromToken) return { error: 'Check the connection again, then trust the host key.', field: 'hostKeyToken' };
  const kept = old && old.host === config.host && old.port === config.port ? old.hostKey : null;
  config.hostKey = fromToken ?? kept;
  if (use === 'save' && sent !== null && (config.hostKey === null || JSON.stringify(sent) !== JSON.stringify(config.hostKey))) {
    return { error: 'Trust a host key through Check connection.', field: 'config.hostKey' };
  }
  return { config, secrets };
}

/** "Not uploaded: ..." for the files a stop leaves untried. */
export const notUploaded = (message: string) => `Not uploaded: ${message}`;

/** A failure in plain words, without secrets. */
function reasonOf(err: unknown, clean: (text: string) => string): { message: string; detail?: string; stops: boolean; taken: boolean; rest: string } {
  if (err instanceof SftpError) {
    // Spooldoc's own words name no secret, and a short password would garble them; the server's text is cleaned.
    return { message: err.message, detail: err.detail === undefined ? undefined : clean(err.detail), stops: err.stops, taken: !!err.extra.taken, rest: err.extra.reason ?? err.message };
  }
  const message = clean(err instanceof Error ? err.message : String(err));
  return { message, stops: true, taken: false, rest: message };
}

/** Opens a connection. Tests replace it to count connections. */
export const sftpConnector = { connect: (target: SftpTarget): Promise<SftpSession> => connectSftp(target) };

/**
 * Uploads each file of a run to a folder on an SFTP server, over one connection, one file
 * after the other. Spooldoc never creates the folder. With `keepCopy`, the files are kept
 * in Spooldoc first. A file an earlier run of the same job already uploaded for the same
 * spooled file, through this destination to this folder on this host, is not uploaded
 * again (a test upload does not count), so Retry uploads only the rest. A file that fails
 * fails alone, and the others still upload; a connection, sign-in or host key failure
 * stops the run, and the files not tried say why. Every file is recorded as it goes. The
 * step fails when any file failed, so the finish step does not run.
 */
export function sftpDestination(config: SftpConfig, secrets: SftpSecrets, name: string): Destination {
  return {
    kind: 'sftp',
    async deliver(input: DeliverInput) {
      const { runId, files, job } = input;
      const hidden = sftpSecretValues(secrets);
      for (const secret of hidden) input.addSecret(secret);
      const clean = (text: string) => redact(text, hidden);

      if (config.keepCopy) await storeRunFiles(runId, files);

      const test = config.testFolder !== null;
      const folder = config.testFolder ?? config.folder;
      const server = sftpServer(config);
      const where = test ? `the test folder ${folder} on ${server}` : `${folder} on ${server}`;

      const db = getDb();
      // Files uploaded for real by an earlier run of this job on this spooled file, through this
      // destination. Which of them went to this host and folder is known once the folder is found.
      const earlier = await db
        .select({ document: runDeliveries.document, seq: runs.seq, to: runDeliveries.to })
        .from(runDeliveries)
        .innerJoin(runs, eq(runs.id, runDeliveries.runId))
        .where(
          and(
            eq(runDeliveries.kind, 'sftp'),
            eq(runDeliveries.jobId, job.id),
            eq(runDeliveries.splfKey, job.splfKey),
            eq(runDeliveries.destinationId, input.destinationId),
            eq(runDeliveries.status, 'sent'),
            eq(runDeliveries.test, false),
          ),
        )
        .orderBy(runs.seq);
      const sentIn = new Map<string, number>();

      const record = deliveryRecorder(input, 'sftp');

      const own = ownNames(files);
      let pending = files.map((file, index) => ({ file, name: own[index]!, index }));
      let already = 0;

      const failures: { message: string; detail?: string }[] = [];
      let uploaded = 0;
      let replaced = 0;
      let added = 0;
      const leftovers: string[] = [];
      let session: SftpSession | null = null;
      let real = folder;

      /** Fails every file not tried yet with the reason the run stopped. */
      const stopAll = async (from: number, reason: { message: string; detail?: string }) => {
        for (const { file } of pending.slice(from)) {
          await record({
            pageGroupIndex: file.pageGroupIndex,
            document: file.name,
            to: '',
            test,
            status: 'failed',
            error: notUploaded(reason.message),
            detail: reason.detail ?? null,
            size: file.content.byteLength,
          });
        }
      };

      try {
        if (pending.length > 0) {
          if (!config.hostKey) {
            const message = `The host key of ${config.host} is not trusted yet. Open ${name} on the Destinations page, check the connection and trust the key.`;
            await stopAll(0, { message });
            throw new StepError('deliver', `Uploaded ${already} of ${nFiles(files.length)} to ${where}. ${message}`);
          }
          try {
            session = await sftpConnector.connect(sftpTargetOf(config, secrets));
            real = await findFolder(session, folder);
          } catch (err) {
            const reason = reasonOf(err, clean);
            await stopAll(0, reason);
            throw new StepError('deliver', `Uploaded ${already} of ${nFiles(files.length)} to ${where}. ${reason.message}`, reason.detail);
          }
          const s = session;

          // Only an upload directly in this folder on this host counts.
          const inReal = `${config.host}:${inFolder(real, '')}`;
          for (const row of earlier) {
            const there = row.to.startsWith(inReal) && !row.to.slice(inReal.length).includes('/');
            if (there && !sentIn.has(row.document)) sentIn.set(row.document, row.seq);
          }
          for (const file of files) {
            const before = sentIn.get(file.name);
            if (before === undefined) continue;
            already++;
            await record({ pageGroupIndex: file.pageGroupIndex, document: file.name, to: '', status: 'already_sent', sentInRun: before, size: file.content.byteLength });
          }
          pending = pending.filter(({ file }) => !sentIn.has(file.name));

          // Names taken by this run, as a folder that ignores case compares them.
          const used = new Set(own.map(key));
          const names = pending.map((item) => item.name);
          // For Add a number: the first number free in the folder and in this run, by file.
          const firsts = names.map(() => 1);

          if (config.ifExists === 'fail') {
            // Every name is checked first: when any is taken, nothing is uploaded.
            const inTheWay: string[] = [];
            try {
              for (const file of names) if ((await statPath(s, inFolder(real, file), `looked for ${file}`)) !== null) inTheWay.push(file);
            } catch (err) {
              const reason = reasonOf(err, clean);
              await stopAll(0, reason);
              throw new StepError('deliver', `Uploaded ${already} of ${nFiles(files.length)} to ${where}. ${reason.message}`, reason.detail);
            }
            if (inTheWay.length > 0) {
              const more = inTheWay.length > 1 ? ` and ${nFiles(inTheWay.length - 1)} more are` : ' is';
              const message = `${inTheWay[0]}${more} already in ${folder}. Nothing was uploaded. Change "When a file with the same name exists" or move the old ${inTheWay.length > 1 ? 'files' : 'file'}.`;
              await stopAll(0, { message });
              throw new StepError('deliver', message);
            }
          } else if (config.ifExists === 'suffix') {
            // Each taken name gets the first number free in the folder and in this run.
            try {
              for (const [index, file] of names.entries()) {
                if ((await statPath(s, inFolder(real, file), `looked for ${file}`)) === null) continue;
                let n = 2;
                while (used.has(key(numbered(file, n))) || (await statPath(s, inFolder(real, numbered(file, n)), `looked for ${file}`)) !== null) n++;
                firsts[index] = n;
              }
            } catch (err) {
              const reason = reasonOf(err, clean);
              await stopAll(0, reason);
              throw new StepError('deliver', `Uploaded ${already} of ${nFiles(files.length)} to ${where}. ${reason.message}`, reason.detail);
            }
          }

          for (const [index, { file }] of pending.entries()) {
            const base = { pageGroupIndex: file.pageGroupIndex, document: file.name, test, size: file.content.byteLength };
            const started = performance.now();
            try {
              const result = await uploadFile(s, real, names[index]!, file.content, {
                ifExists: config.ifExists,
                tempName: config.tempName,
                avoid: used,
                first: firsts[index],
              });
              const ms = Math.round(performance.now() - started);
              used.add(key(result.finalName));
              uploaded++;
              if (result.replaced) replaced++;
              if (result.finalName !== file.name) added++;
              if (result.leftover) leftovers.push(result.leftover);
              await record({
                ...base,
                to: `${config.host}:${inFolder(real, result.finalName)}`,
                status: 'sent',
                ms,
                messageId: result.finalName !== file.name ? result.finalName : null,
              });
            } catch (err) {
              const ms = Math.round(performance.now() - started);
              const reason = reasonOf(err, clean);
              failures.push({ message: `${file.name}: ${reason.message}`, detail: reason.detail });
              const tried = firsts[index]! > 1 ? numbered(names[index]!, firsts[index]!) : names[index]!;
              await record({ ...base, to: `${config.host}:${inFolder(real, tried)}`, status: 'failed', ms, error: reason.message, detail: reason.detail ?? null });
              if (reason.stops) {
                const rest = pending.slice(index + 1);
                // The files not tried get the reason the connection went, without notes about this file.
                for (const { file: other } of rest) failures.push({ message: `${other.name}: ${notUploaded(reason.rest)}` });
                await stopAll(index + 1, { message: reason.rest, detail: reason.detail });
                break;
              }
            }
          }
        }
      } finally {
        session?.close();
      }

      if (failures.length > 0) throw deliveryFailed(`Uploaded ${uploaded + already} of ${nFiles(files.length)} to ${where}`, failures, 'Uploads');
      const extra = [replaced > 0 ? `${replaced} replaced` : '', added > 0 ? `${added} with a number added` : ''].filter(Boolean).join(', ');
      const runsBefore = files.map((file) => sentIn.get(file.name)).filter((seq) => seq !== undefined);
      const before = earlierText(already, runsBefore, 'uploaded');
      const left =
        leftovers.length === 0
          ? ''
          : `. ${leftovers.length === 1 ? `The replaced file was kept as ${leftovers[0]}` : `${leftovers.length} replaced files were kept, such as ${leftovers[0]}`}, since it could not be deleted. Delete ${leftovers.length === 1 ? 'it' : 'them'}`;
      return `Uploaded ${nFiles(uploaded)} to ${where}${extra ? ` (${extra})` : ''}${before}${config.keepCopy && !test ? ', a copy kept in Spooldoc' : ''}${left}`;
    },
  };
}
