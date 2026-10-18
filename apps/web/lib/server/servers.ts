import 'server-only';

import type { Credentials } from '@spooldoc/ibmi';
import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { servers } from './db/schema';
import type { ServerView } from '@/lib/types';
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
    createdAt: row.createdAt.toISOString(),
  };
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

/** A UUID, as the database generates them. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
