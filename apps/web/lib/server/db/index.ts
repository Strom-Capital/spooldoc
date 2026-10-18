import 'server-only';

import path from 'node:path';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { getConfig } from '../config';
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
    // Session-level advisory locks belong to one connection, so each holder reserves one.
    locks: {
      async tryLock(key) {
        const reserved = await client.reserve();
        try {
          const [row] = await reserved<{ ok: boolean }[]>`select pg_try_advisory_lock(hashtext(${key})) as ok`;
          if (!row?.ok) {
            reserved.release();
            return null;
          }
        } catch (error) {
          reserved.release();
          throw error;
        }
        return async () => {
          try {
            await reserved`select pg_advisory_unlock(hashtext(${key}))`;
          } finally {
            reserved.release();
          }
        };
      },
    },
    close: () => client.end({ timeout: 5 }),
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
