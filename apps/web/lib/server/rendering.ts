import 'server-only';

import {
  CARBONE_CLOUD_URL,
  CarboneError,
  carbonePublicKeyEnv,
  carboneStatus,
  generateCarboneKeys,
  isCarboneError,
  probeEdition,
  signCarboneToken,
  type CarboneServer,
} from '@spooldoc/core';
import { eq, isNull } from 'drizzle-orm';
import type { CarboneCheck, RenderingView } from '../types';
import { getDb } from './db';
import { settings } from './db/schema';
import { log } from './log';
import { decryptSecret, encryptSecret } from './secrets';
import { DEFAULT_SETTINGS } from './settings';

/** The Carbone service of the Compose file. */
export const DEFAULT_CARBONE_URL = 'http://carbone:4000';

/** How often the connection is checked again: a server that stops, or a licence that expires, shows up. */
export const RECHECK_MS = 10 * 60_000;

type Row = Pick<typeof settings.$inferSelect, 'carboneMode' | 'carboneUrl' | 'carboneApiKeyEnc' | 'carboneKeyEnc' | 'carbonePublicKey' | 'carboneCheck'>;

const columns = {
  carboneMode: settings.carboneMode,
  carboneUrl: settings.carboneUrl,
  carboneApiKeyEnc: settings.carboneApiKeyEnc,
  carboneKeyEnc: settings.carboneKeyEnc,
  carbonePublicKey: settings.carbonePublicKey,
  carboneCheck: settings.carboneCheck,
};

async function readRow(): Promise<Row> {
  const [row] = await getDb().select(columns).from(settings).where(eq(settings.id, 1));
  return row ?? { carboneMode: 'onprem', carboneUrl: null, carboneApiKeyEnc: null, carboneKeyEnc: null, carbonePublicKey: null, carboneCheck: null };
}

async function save(values: Partial<typeof settings.$inferInsert>): Promise<void> {
  await getDb()
    .insert(settings)
    .values({ id: 1, ...DEFAULT_SETTINGS, ...values })
    .onConflictDoUpdate({ target: settings.id, set: values });
}

/**
 * Spooldoc's key pair for Carbone tokens, made and saved on first use. When the private
 * key can't be decrypted (SPOOLDOC_SECRET_KEY changed), a new pair is made: Carbone then
 * needs the new public key.
 */
async function keyPair(row: Row): Promise<{ privateKey: string; publicKey: string }> {
  if (row.carboneKeyEnc && row.carbonePublicKey) {
    try {
      return { privateKey: decryptSecret(row.carboneKeyEnc, 'Carbone key'), publicKey: row.carbonePublicKey };
    } catch (error) {
      log.warn('Made a new key pair for Carbone: the saved private key could not be decrypted', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  const made = generateCarboneKeys();
  const values = { carboneKeyEnc: encryptSecret(made.privateKey), carbonePublicKey: made.publicKey };
  // Another process may make a pair at the same moment; the first one saved wins.
  const replace = row.carboneKeyEnc !== null;
  await getDb()
    .insert(settings)
    .values({ id: 1, ...DEFAULT_SETTINGS, ...values })
    .onConflictDoUpdate({ target: settings.id, set: values, ...(replace ? {} : { setWhere: isNull(settings.carboneKeyEnc) }) });
  const saved = await readRow();
  if (saved.carboneKeyEnc && saved.carbonePublicKey && saved.carbonePublicKey !== made.publicKey) {
    return { privateKey: decryptSecret(saved.carboneKeyEnc, 'Carbone key'), publicKey: saved.carbonePublicKey };
  }
  return made;
}

/**
 * How to reach the Carbone server set in Settings: the on-prem URL with a fresh token per
 * request, or Carbone Cloud with the user's API key.
 *
 * @throws CarboneError when Carbone Cloud is chosen without a key
 */
export async function carboneServer(): Promise<CarboneServer> {
  const row = await readRow();
  if (row.carboneMode === 'cloud') {
    if (!row.carboneApiKeyEnc) {
      throw new CarboneError('auth', 'Add your Carbone Cloud API key in Settings, under Rendering.');
    }
    const key = decryptSecret(row.carboneApiKeyEnc, 'Carbone Cloud key');
    return { url: CARBONE_CLOUD_URL, cloud: true, token: () => key };
  }
  const { privateKey } = await keyPair(row);
  return { url: row.carboneUrl ?? DEFAULT_CARBONE_URL, token: () => signCarboneToken(privateKey) };
}

/** A failed check, from anything thrown. */
function failedCheck(error: unknown): CarboneCheck {
  const at = new Date().toISOString();
  if (isCarboneError(error)) {
    return { ok: false, at, error: error.message, ...(error.detail ? { detail: error.detail } : {}) };
  }
  return { ok: false, at, error: `Could not check Carbone: ${error instanceof Error ? error.message : String(error)}` };
}

/** Saves a check, and logs when the connection starts or stops working. */
async function record(check: CarboneCheck, before: CarboneCheck | null): Promise<CarboneCheck> {
  await save({ carboneCheck: check });
  if (check.ok && before && !before.ok) log.info('Carbone works again', { version: check.version, edition: check.edition });
  if (!check.ok && (!before || before.ok)) log.warn('Carbone does not work', { error: check.error, detail: check.detail });
  return check;
}

/**
 * Checks the Carbone connection and keeps the result: the version from `/status`, and
 * on-prem the edition from the probe. Carbone Cloud is not probed, since each probe there
 * counts as a document. Never throws; a failure is in the result.
 */
export async function checkCarbone(): Promise<CarboneCheck> {
  const before = (await readRow()).carboneCheck;
  try {
    const server = await carboneServer();
    const { version } = await carboneStatus(server);
    const edition = server.cloud ? 'cloud' : await probeEdition(server);
    return await record({ ok: true, at: new Date().toISOString(), version, edition }, before);
  } catch (error) {
    return record(failedCheck(error), before);
  }
}

/**
 * Notes a render that failed because Carbone could not be reached or refused Spooldoc, so
 * Settings, the setup checklist and the job show it before the next scheduled check.
 */
export async function noteRenderFailure(error: unknown): Promise<void> {
  if (!isCarboneError(error) || !['unreachable', 'timeout', 'auth'].includes(error.kind)) return;
  try {
    await record(failedCheck(error), (await readRow()).carboneCheck);
  } catch (err) {
    log.warn('Could not record a Carbone failure', { error: err instanceof Error ? err.message : String(err) });
  }
}

/** Where documents are rendered, without any key. Makes Spooldoc's key pair on first use. */
export async function getRendering(): Promise<RenderingView> {
  const row = await readRow();
  const { publicKey } = await keyPair(row);
  return {
    mode: row.carboneMode === 'cloud' ? 'cloud' : 'onprem',
    url: row.carboneUrl ?? DEFAULT_CARBONE_URL,
    hasApiKey: !!row.carboneApiKeyEnc,
    publicKey: carbonePublicKeyEnv(publicKey),
    check: row.carboneCheck,
  };
}

/** True when the last check found a working Carbone server. */
export async function renderingReady(): Promise<boolean> {
  try {
    return (await readRow()).carboneCheck?.ok === true;
  } catch {
    return false;
  }
}

/** How long a failed check stands before `renderingCheck` checks again. */
export const FAILED_RECHECK_MS = 60_000;

/**
 * The connection as a run would find it: the last check, or a new one when there is none
 * or the last one failed more than a minute ago, so a server that came back is not held
 * to an old failure until the next scheduled check.
 */
export async function renderingCheck(): Promise<CarboneCheck> {
  const last = (await readRow()).carboneCheck;
  if (last && (last.ok || Date.now() - Date.parse(last.at) < FAILED_RECHECK_MS)) return last;
  return checkCarbone();
}

/** A change to the rendering settings. */
export interface RenderingChange {
  mode: 'onprem' | 'cloud';
  /** The on-prem URL. Missing keeps the saved one. */
  url?: string;
  /** A new Carbone Cloud key. Missing or empty keeps the saved key; null removes it. */
  apiKey?: string | null;
}

/** Saves the rendering settings, then checks the connection again. */
export async function updateRendering(change: RenderingChange): Promise<CarboneCheck> {
  const values: Partial<typeof settings.$inferInsert> = { carboneMode: change.mode };
  if (change.url !== undefined) values.carboneUrl = change.url === DEFAULT_CARBONE_URL ? null : change.url;
  if (change.apiKey === null) values.carboneApiKeyEnc = null;
  else if (change.apiKey) values.carboneApiKeyEnc = encryptSecret(change.apiKey);
  await save(values);
  return checkCarbone();
}

const KEY = Symbol.for('spooldoc.rendering.checks');
type Holder = typeof globalThis & { [KEY]?: ReturnType<typeof setInterval> };

/** Checks the Carbone connection now and every 10 minutes, once per process. */
export function startRenderingChecks(): void {
  const holder = globalThis as Holder;
  if (holder[KEY]) return;
  const run = () => {
    checkCarbone().catch((error: unknown) => log.warn('Could not check Carbone', { error: error instanceof Error ? error.message : String(error) }));
  };
  run();
  holder[KEY] = setInterval(run, RECHECK_MS);
  holder[KEY].unref?.();
}
