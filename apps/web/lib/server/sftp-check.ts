import 'server-only';

import { redact } from '@spooldoc/ibmi';
import { SFTP_LIST_LIMIT, type SftpConfig } from '@/lib/destination-config';
import type { SftpCheckStage, SftpCheckView } from '@/lib/types';
import { sftpConnector, sftpSecretValues, sftpTargetOf, type SftpSecrets } from './destinations/sftp';
import { compareCommand, findFolder, hostKeyInfo, hostKeyToken, listFolder, SftpError, sftpErrorText, toHostKey, type SftpSession } from './sftp';

/** "1 file", "312 files", "more than 5,000 files", "empty". */
function contents(count: number, truncated: boolean): string {
  if (truncated) return `more than ${SFTP_LIST_LIMIT.toLocaleString('en-US')} files`;
  if (count === 0) return 'empty';
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'file' : 'files'}`;
}

const SIGN_IN_WITH = { 'spooldoc-key': 'the key', 'own-key': 'your key', password: 'the password' } as const;

/**
 * Check an SFTP destination as a run would use it, line by line: reach the host, verify
 * its host key, sign in, and find the folder and the test folder. It stops at a host key
 * Spooldoc does not trust, before the sign-in, so a password is never sent to a host
 * Spooldoc does not know. It writes nothing.
 */
export async function checkSftp(config: SftpConfig, secrets: SftpSecrets): Promise<SftpCheckView> {
  const hidden = sftpSecretValues(secrets);
  const clean = (text: string | undefined) => (text === undefined ? undefined : redact(text, hidden));
  const { host, port, username } = config;
  const stages: SftpCheckStage[] = [];
  const view: SftpCheckView = { stages };
  const add = (stage: SftpCheckStage) => stages.push({ ...stage, text: clean(stage.text)!, ...(stage.detail ? { detail: clean(stage.detail) } : {}) });
  const reached = (ms: number) => add({ stage: 'reach', status: 'ok', text: `Reached ${host} on port ${port}`, ms });
  const trusted = (session: { hostKey: { type: string; bits: number; fingerprint: string } }) =>
    add({ stage: 'hostKey', status: 'ok', text: `Trusted ${session.hostKey.type} key ${session.hostKey.fingerprint}` });

  /** A host key the server showed that Spooldoc does not trust: the check stops there. */
  const untrusted = (raw: Buffer) => {
    const info = hostKeyInfo(raw);
    const token = hostKeyToken(host, port, toHostKey(raw));
    view.compare = compareCommand(info);
    if (config.hostKey) {
      const before = hostKeyInfo(Buffer.from(config.hostKey.key, 'base64'));
      view.hostKey = { ...info, token, state: 'changed', trustedFingerprint: before.fingerprint };
      add({ stage: 'hostKey', status: 'changed', text: `The host key changed` });
    } else {
      view.hostKey = { ...info, token, state: 'new' };
      add({ stage: 'hostKey', status: 'new', text: 'New host key' });
    }
  };

  let session: SftpSession;
  try {
    session = await sftpConnector.connect(sftpTargetOf(config, secrets));
  } catch (err) {
    const failure = err instanceof SftpError ? err : null;
    const { message, detail } = failure ? { message: failure.message, detail: failure.detail } : sftpErrorText(err, { host, port, username, auth: config.auth });
    const phase = failure?.phase ?? 'reach';
    if (phase === 'reach') {
      add({ stage: 'reach', status: 'failed', text: message, detail });
      return view;
    }
    reached(failure?.extra.reachMs ?? 0);
    if (phase === 'hostKey') {
      if (failure?.extra.seenHostKey) {
        untrusted(failure.extra.seenHostKey);
        return view;
      }
      // A trusted key whose type the server no longer offers: look at the key it has now.
      if (config.hostKey && /host key/i.test(detail ?? '')) {
        try {
          const other = await sftpConnector.connect(sftpTargetOf({ ...config, hostKey: null }, secrets));
          other.close();
        } catch (again) {
          if (again instanceof SftpError && again.extra.seenHostKey) {
            untrusted(again.extra.seenHostKey);
            return view;
          }
        }
      }
      add({ stage: 'hostKey', status: 'failed', text: message, detail });
      return view;
    }
    if (config.hostKey) {
      const info = hostKeyInfo(Buffer.from(config.hostKey.key, 'base64'));
      add({ stage: 'hostKey', status: 'ok', text: `Trusted ${info.type} key ${info.fingerprint}` });
      view.trusted = { ...info, token: hostKeyToken(host, port, config.hostKey) };
    }
    add({ stage: 'signIn', status: 'failed', text: message, detail });
    return view;
  }

  try {
    reached(session.reachMs);
    trusted(session);
    view.trusted = { ...session.hostKey, token: hostKeyToken(host, port, config.hostKey!) };
    add({ stage: 'signIn', status: 'ok', text: `Signed in as ${username} with ${SIGN_IN_WITH[config.auth]}` });
    const folders: [SftpCheckStage['stage'], string][] = [['folder', config.folder]];
    if (config.testFolder) folders.push(['testFolder', config.testFolder]);
    for (const [stage, folder] of folders) {
      try {
        const real = await findFolder(session, folder);
        const { entries, truncated } = await listFolder(session, real);
        const files = entries.filter((entry) => !entry.folder).length;
        const shown = real === folder ? folder : `${folder} (${real})`;
        add({ stage, status: 'ok', text: `Found ${shown}, ${contents(files, truncated)}` });
      } catch (err) {
        const { message, detail } = err instanceof SftpError ? { message: err.message, detail: err.detail } : sftpErrorText(err, session.ctx);
        add({ stage, status: 'failed', text: message, detail });
        // A connection that went stops the check; a missing folder does not.
        if (session.closed) break;
      }
    }
  } finally {
    session.close();
  }
  return view;
}
