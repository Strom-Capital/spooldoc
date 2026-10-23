import 'server-only';

import path from 'node:path';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { getConfig } from '../config';
import { redact } from '../http';
import { log } from '../log';
import * as schema from './schema';

/** The database, whichever driver is behind it (postgres.js in the app, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** A transaction handle, as passed to `db.transaction(fn)`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Cross-instance locks. `tryLock` returns a release function, or null when another
 * holder has the lock.
 */
export interface LockProvider {
  tryLock(key: string): Promise<(() => Promise<void>) | null>;
}

interface DbState {
  db: Db;
  locks: LockProvider;
  close(): Promise<void>;
}

const KEY = Symbol.for('spooldoc.db');
type Holder = typeof globalThis & { [KEY]?: DbState };
const holder = globalThis as Holder;

/** The folder with the drizzle-kit migrations. */
export function migrationsFolder(): string {
  return path.join(/* turbopackIgnore: true */ process.cwd(), 'drizzle');
}

function open(): DbState {
  const url = getConfig().databaseUrl;
  if (!url) {
    throw new Error('DATABASE_URL is not set. See apps/web/.env.example.');
  }
  const client = postgres(url, { max: 10, onnotice: () => undefined });
  const db = drizzle(client, { schema }) as unknown as Db;
  return {
    db,
    locks: sessionLocks(client),
    close: () => client.end({ timeout: 5 }),
  };
}

/**
 * Advisory locks held on one reserved connection for the whole process, so holders
 * never take connections from the pool: a reader that keeps its lock for good, or a
 * run that holds a job lock while it queries, cannot starve the pool. A session may
 * take its own advisory lock again, so keys this process holds are refused here first.
 */
export function sessionLocks(client: postgres.Sql): LockProvider {
  const held = new Set<string>();
  let session: Promise<postgres.ReservedSql> | null = null;
  const connection = () => (session ??= client.reserve());
  /**
   * After a failed query, start over on a new connection with the next call. The old one
   * may still be alive and hold locks, so it goes back to the pool only once it holds none;
   * if even that fails, it is closed, and its locks go with it. Either way every lock of
   * this process is gone, as when the connection is lost.
   */
  const drop = () => {
    const lost = session;
    session = null;
    void lost
      ?.then(async (reserved) => {
        try {
          await reserved`select pg_advisory_unlock_all()`;
        } catch {
          await reserved`select pg_terminate_backend(pg_backend_pid())`.catch(() => undefined);
          return;
        }
        reserved.release();
      })
      .catch(() => undefined);
  };
  return {
    async tryLock(key) {
      if (held.has(key)) return null;
      held.add(key);
      try {
        const reserved = await connection();
        const [row] = await reserved<{ ok: boolean }[]>`select pg_try_advisory_lock(hashtext(${key})) as ok`;
        if (!row?.ok) {
          held.delete(key);
          return null;
        }
      } catch (error) {
        held.delete(key);
        drop();
        throw error;
      }
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          // The handle in its own statement: Next's compiler drops the parentheses of (await f())`...`.
          const reserved = await connection();
          await reserved`select pg_advisory_unlock(hashtext(${key}))`;
        } catch (error) {
          log.warn('Could not release a database lock', { lock: key, error: redact(error) });
          drop();
        } finally {
          held.delete(key);
        }
      };
    },
  };
}

function state(): DbState {
  holder[KEY] ??= open();
  return holder[KEY];
}

/** The app database. Opened on first use from DATABASE_URL. */
export function getDb(): Db {
  return state().db;
}

/** Locks shared by every instance that uses the same database. */
export function getLocks(): LockProvider {
  return state().locks;
}

/** Use another database, for tests. */
export function setDb(next: DbState | undefined): void {
  holder[KEY] = next;
}

/** Apply the migrations in `drizzle/` to the DATABASE_URL database. */
export async function runMigrations(): Promise<void> {
  const url = getConfig().databaseUrl;
  if (!url) {
    throw new Error('DATABASE_URL is not set. See apps/web/.env.example.');
  }
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(client), { migrationsFolder: migrationsFolder() });
  } finally {
    await client.end({ timeout: 5 });
  }
}

export { schema };
