import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import type { Db, LockProvider } from '@/lib/server/db';
import * as schema from '@/lib/server/db/schema';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Locks held in this process, so tests can check that a second holder is refused. */
export class MemoryLocks implements LockProvider {
  readonly held = new Set<string>();
  async tryLock(key: string) {
    if (this.held.has(key)) return null;
    this.held.add(key);
    return async () => {
      this.held.delete(key);
    };
  }
}

export interface TestDb {
  db: Db;
  locks: MemoryLocks;
  close(): Promise<void>;
}

/**
 * A freshly migrated database for one test file: PGlite in memory, or a throwaway
 * database on TEST_DATABASE_URL when that is set.
 */
export async function openTestDb(): Promise<TestDb> {
  const locks = new MemoryLocks();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const client = new PGlite();
    const db = drizzlePglite(client, { schema });
    await migratePglite(db, { migrationsFolder });
    return { db: db as unknown as Db, locks, close: () => client.close() };
  }
  const name = `spooldoc_test_${Math.random().toString(36).slice(2, 10)}`;
  const admin = postgres(url, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`create database ${name}`);
  const target = new URL(url);
  target.pathname = `/${name}`;
  const client = postgres(target.toString(), { max: 4, onnotice: () => undefined });
  const db = drizzlePostgres(client, { schema });
  await migratePostgres(db, { migrationsFolder });
  return {
    db: db as unknown as Db,
    locks,
    async close() {
      await client.end({ timeout: 5 });
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end({ timeout: 5 });
    },
  };
}

/** Empty every table the tests write to, keeping the seeded destination and settings. */
export async function resetTables(db: Db): Promise<void> {
  await db.execute(sql`truncate table "user", servers, jobs, samples, runs, run_outputs, watch_seen, queue_prefs, ai_providers, assets, template_files cascade`);
  await db.execute(sql`delete from destinations where builtin = false`);
  await db.execute(sql`
    update settings set poll_seconds = 30, safety_check_seconds = 300, retention_days = 90, ai_provider = null, ai_mask = false,
      carbone_mode = 'onprem', carbone_url = null, carbone_api_key_enc = null, carbone_key_enc = null, carbone_public_key = null, carbone_check = null
  `);
}
