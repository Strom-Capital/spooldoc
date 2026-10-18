import 'server-only';

import type { Sample, SpooledFileId } from '@spooldoc/core';
import { captureSample, type Connection } from '@spooldoc/ibmi';
import { eq, sql } from 'drizzle-orm';
import { splfKey } from '@/lib/job-spec';
import { getConfig } from './config';
import { getDb, type Db, type Tx } from './db';
import { samples } from './db/schema';
import { UUID } from './servers';

type SampleRow = typeof samples.$inferSelect;

/** The in-memory `Sample` of a row. */
export function sampleFromRow(row: SampleRow): Sample {
  return {
    id: row.id,
    version: 1,
    capturedAt: row.capturedAt.toISOString(),
    system: row.system,
    splf: row.splf,
    attributes: row.attributes,
    codePage: row.codePage,
    rawBase64: row.raw.toString('base64'),
    pages: row.pages,
  };
}

/** A sample by id, or null. */
export async function getSample(id: string, db: Db | Tx = getDb()): Promise<Sample | null> {
  if (!UUID.test(id)) {
    return null;
  }
  const [row] = await db.select().from(samples).where(eq(samples.id, id));
  return row ? sampleFromRow(row) : null;
}

/** Warnings stored with a sample. */
export async function sampleWarnings(id: string): Promise<string[]> {
  const [row] = await getDb().select({ warnings: samples.warnings }).from(samples).where(eq(samples.id, id));
  return row?.warnings ?? [];
}

/**
 * Read a spooled file from the IBM i. Uses SPOOLDOC_DEFAULT_CCSID when the file has no
 * usable CHRID or job CCSID.
 *
 * @throws ConnectionError, or UnsupportedCodePageError for a code page Spooldoc cannot decode
 */
export async function capture(conn: Connection, host: string, splf: SpooledFileId): Promise<{ sample: Sample; warnings: string[] }> {
  return captureSample(conn, splf, { system: host, fallbackCodePage: getConfig().defaultCcsid });
}

/**
 * Store a captured spooled file. A preview sample (no `runId`) replaces the earlier
 * capture of the same file on that server; a run keeps its own copy.
 *
 * @returns The stored sample, with the database id
 */
export async function storeSample(
  serverId: string,
  captured: { sample: Sample; warnings: string[] },
  runId: string | null = null,
  db: Db | Tx = getDb(),
): Promise<Sample> {
  const { sample, warnings } = captured;
  const values = {
    serverId,
    runId,
    system: sample.system,
    splf: sample.splf,
    splfKey: splfKey(sample.splf),
    attributes: sample.attributes,
    codePage: sample.codePage,
    warnings,
    raw: Buffer.from(sample.rawBase64, 'base64'),
    pages: sample.pages,
    capturedAt: new Date(sample.capturedAt),
  };
  const insert = db.insert(samples).values(values);
  const [row] = runId
    ? await insert.returning()
    : await insert
        .onConflictDoUpdate({
          target: [samples.serverId, samples.splfKey],
          targetWhere: sql`${samples.runId} is null`,
          set: {
            system: values.system,
            attributes: values.attributes,
            codePage: values.codePage,
            warnings: values.warnings,
            raw: values.raw,
            pages: values.pages,
            capturedAt: values.capturedAt,
          },
        })
        .returning();
  return sampleFromRow(row!);
}
