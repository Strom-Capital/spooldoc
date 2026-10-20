import 'server-only';

import type { ConnectionErrorCode, Credentials, SystemInfo } from '@spooldoc/ibmi';
import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { servers } from './db/schema';
import type { ServerErrorCode, ServerView } from '@/lib/types';
import { redact } from './http';
import { log } from './log';
import { decryptSecret } from './secrets';

export type ServerRow = typeof servers.$inferSelect;

/** The API view of a server row. */
export function serverView(row: ServerRow): ServerView {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    user: row.user,
    libraries: row.libraries,
    dataQueue: row.dtaqLibrary && row.dtaqName ? { library: row.dtaqLibrary, name: row.dtaqName, owned: row.dtaqOwned } : null,
    ccsid: row.ccsid,
    vrm: row.vrm,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastError: row.lastError,
    errorCode: serverErrorCode(row.errorCode),
    errorSince: row.errorSince?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The stored error class as the API names it; anything else is null. */
export function serverErrorCode(code: string | null): ServerErrorCode | null {
  return code === 'host' || code === 'auth' ? code : null;
}

/** A server row by id, or null. Ids that are not UUIDs are simply not found. */
export async function getServerRow(id: string): Promise<ServerRow | null> {
  if (!UUID.test(id)) {
    return null;
  }
  const [row] = await getDb().select().from(servers).where(eq(servers.id, id));
  return row ?? null;
}

/**
 * Sign-on details of a server, with the password decrypted.
 *
 * @throws Error when the password cannot be decrypted
 */
export function serverCredentials(row: ServerRow): Credentials {
  return { host: row.host, user: row.user, password: decryptSecret(row.passwordEnc) };
}

/**
 * True when the last sign-on to the server failed. Spooldoc then does not sign on again
 * by itself, since every failed sign-on counts towards the system's QMAXSIGN limit and
 * could disable the user profile. Reconnect, or saving a new password, signs on again.
 */
export function signOnPaused(row: Pick<ServerRow, 'errorCode'>): boolean {
  return row.errorCode === 'auth';
}

/** What a page or the watcher is told instead of signing on to a server whose sign-on is paused. */
export function signOnPausedMessage(row: Pick<ServerRow, 'lastError'>): string {
  const reason = row.lastError ?? 'The last sign-on failed.';
  return `${reason} Spooldoc does not sign on again until you edit the password or press Reconnect on the Servers page.`;
}

/**
 * What an attempt to reach a server came to: it worked, with the system info when it was a
 * fresh sign-on, or it failed with an error class and a message without the password.
 */
export type ServerOutcome = { ok: true; info?: SystemInfo } | { ok: false; code: ConnectionErrorCode; message: string };

/** How often a server that keeps working has `lastCheckedAt` written again. */
const CHECKED_EVERY_MS = 60_000;

const WRITTEN_KEY = Symbol.for('spooldoc.serverState');
type Holder = typeof globalThis & { [WRITTEN_KEY]?: Map<string, { state: string; at: number }> };

/** The state last written per server, kept per process so most calls do not touch the database. */
function written(): Map<string, { state: string; at: number }> {
  return ((globalThis as Holder)[WRITTEN_KEY] ??= new Map());
}

/**
 * Record what an attempt to reach a server came to, so the Servers page, the server
 * pickers and Needs attention show it. Only a host or sign-on error changes the state; an
 * error about one object or authority is about that object, not the server. The row is
 * written when the state changes, after a fresh sign-on, and at most once a minute while
 * the server keeps working. `errorSince` is set on the first failure and cleared when one
 * works again. Never throws: a failed write is logged.
 *
 * @param server - The server's id and name
 * @param outcome - What the attempt came to
 */
export async function recordServerState(server: Pick<ServerRow, 'id' | 'name'>, outcome: ServerOutcome): Promise<void> {
  if (!outcome.ok && outcome.code !== 'host' && outcome.code !== 'auth') return;
  const state = outcome.ok ? 'ok' : `${outcome.code}:${outcome.message}`;
  const now = Date.now();
  const last = written().get(server.id);
  const due = outcome.ok && (!!outcome.info || !last || now - last.at >= CHECKED_EVERY_MS);
  if (last?.state === state && !due) return;
  written().set(server.id, { state, at: now });
  try {
    const db = getDb();
    const [row] = await db.select({ lastError: servers.lastError, errorSince: servers.errorSince }).from(servers).where(eq(servers.id, server.id));
    if (!row) return;
    const at = new Date(now);
    if (outcome.ok) {
      const info = outcome.info ? { ccsid: outcome.info.jobCcsid, vrm: outcome.info.vrm } : {};
      await db
        .update(servers)
        .set({ ...info, lastCheckedAt: at, lastError: null, errorCode: null, errorSince: null, errorDismissed: null })
        .where(eq(servers.id, server.id));
      if (row.lastError) log.info(`Connection to ${server.name} works again`, { serverId: server.id });
    } else {
      await db
        .update(servers)
        .set({ lastCheckedAt: at, lastError: outcome.message, errorCode: outcome.code, errorSince: row.errorSince ?? at })
        .where(eq(servers.id, server.id));
      if (row.lastError !== outcome.message) log.warn(`Could not connect to ${server.name}`, { serverId: server.id, code: outcome.code, error: outcome.message });
    }
  } catch (error) {
    // Written again on the next attempt.
    written().delete(server.id);
    log.error('Could not record the connection state of a server', { serverId: server.id, error: redact(error) });
  }
}

/** A UUID, as the database generates them. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
