import { eq } from 'drizzle-orm';
import type { TestDb } from './db';
import type { Db } from '@/lib/server/db';
import { destinations, jobs, servers, user } from '@/lib/server/db/schema';
import { emptySpec, type JobSpec } from '@/lib/job-spec';

/** The database of the running test file (see tests/setup.ts). */
export function testDb(): TestDb {
  const value = (globalThis as { __testDb?: TestDb }).__testDb;
  if (!value) throw new Error('No test database');
  return value;
}

export const db = (): Db => testDb().db;

/** The seeded Spooldoc destination. */
export async function builtinDestination(): Promise<string> {
  const [row] = await db().select({ id: destinations.id }).from(destinations).where(eq(destinations.builtin, true));
  if (!row) throw new Error('No built-in destination');
  return row.id;
}

/** A server row with an encrypted password. */
export async function insertServer(values: Partial<typeof servers.$inferInsert> = {}): Promise<string> {
  const { encryptSecret } = await import('@/lib/server/secrets');
  const { GOOD_PASSWORD } = await import('./fake-connection');
  const [row] = await db()
    .insert(servers)
    .values({ name: 'Test system', host: 'ibmi.example.com', user: 'DEMOUSER', passwordEnc: encryptSecret(GOOD_PASSWORD), ...values })
    .returning({ id: servers.id });
  return row!.id;
}

/** A job row on the given server's MYLIB/EMAIL queue. */
export async function insertJob(serverId: string, spec: Partial<JobSpec> = {}): Promise<string> {
  const destinationId = await builtinDestination();
  const draft = { ...emptySpec({ serverId, library: 'MYLIB', queue: 'EMAIL', destinationId }), ...spec };
  const [row] = await db().insert(jobs).values({ name: 'Invoices', draft }).returning({ id: jobs.id });
  return row!.id;
}

/** A user row, for foreign keys. */
export async function insertUser(id = 'user-1'): Promise<string> {
  await db().insert(user).values({ id, name: 'Test', email: `${id}@example.com` });
  return id;
}
