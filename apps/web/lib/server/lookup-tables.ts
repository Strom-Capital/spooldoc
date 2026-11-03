import 'server-only';

import type { LookupTableCell, LookupTableColumn, LookupTableData } from '@spooldoc/core';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { LookupTableSummary, LookupTableView } from '@/lib/types';
import { getDb } from './db';
import { errorResponse } from './http';
import { lookupTables } from './db/schema';

/** What a name must be, as the API says it. */
export const TABLE_NAME_RULE = 'Name the table with lowercase letters, digits, dashes and underscores, at most 64, starting with a letter or digit.';

/** A 400 for columns or rows that `lookupTableContentSchema` refused, with its first message. */
export function contentError(error: { issues: { message: string }[] }): Response {
  return errorResponse(400, error.issues[0]?.message ?? 'The table is not valid.');
}

type LookupTableRow = typeof lookupTables.$inferSelect;

/** A lookup table with its rows, without the jobs that read it. */
export type LookupTableRecord = Omit<LookupTableView, 'jobs' | 'keyJobs'>;

const view = (row: LookupTableRow): LookupTableRecord => ({
  id: row.id,
  name: row.name,
  columns: row.columns,
  rows: row.rows,
  revision: row.revision,
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * Every lookup table without its rows, by name, with its row count and the jobs that read it.
 *
 * @param jobsByTable - The jobs that read each table, from `lookupTableJobs`
 */
export async function listLookupTables(jobsByTable: ReadonlyMap<string, LookupTableSummary['jobs']>): Promise<LookupTableSummary[]> {
  const rows = await getDb()
    .select({
      id: lookupTables.id,
      name: lookupTables.name,
      columns: lookupTables.columns,
      rows: sql<number>`jsonb_array_length(${lookupTables.rows})::int`,
      revision: lookupTables.revision,
      updatedAt: lookupTables.updatedAt,
    })
    .from(lookupTables)
    .orderBy(asc(lookupTables.name));
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString(), jobs: jobsByTable.get(row.id) ?? [] }));
}

/** One lookup table with its rows, or undefined. */
export async function getLookupTable(id: string): Promise<LookupTableRecord | undefined> {
  const [row] = await getDb().select().from(lookupTables).where(eq(lookupTables.id, id));
  return row ? view(row) : undefined;
}

/**
 * Creates a lookup table.
 *
 * @returns The table, or null when the name is taken
 */
export async function createLookupTable(input: { name: string; columns: LookupTableColumn[]; rows: LookupTableCell[][] }): Promise<LookupTableRecord | null> {
  const [row] = await getDb().insert(lookupTables).values(input).onConflictDoNothing({ target: lookupTables.name }).returning();
  return row ? view(row) : null;
}

/** Why an update was refused. */
export type UpdateRefusal = 'not-found' | 'changed' | 'name-taken';

/**
 * Saves a lookup table's name, columns or rows, and raises its revision by one. The save
 * is refused when the table changed since `expectedRevision`, so one person's save never
 * overwrites another's without them seeing it.
 */
export async function updateLookupTable(
  id: string,
  changes: { name?: string; columns?: LookupTableColumn[]; rows?: LookupTableCell[][] },
  expectedRevision: number,
): Promise<LookupTableRecord | UpdateRefusal> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ revision: lookupTables.revision }).from(lookupTables).where(eq(lookupTables.id, id)).for('update');
    if (!current) return 'not-found';
    if (current.revision !== expectedRevision) return 'changed';
    if (changes.name !== undefined) {
      const [taken] = await tx.select({ id: lookupTables.id }).from(lookupTables).where(eq(lookupTables.name, changes.name));
      if (taken && taken.id !== id) return 'name-taken';
    }
    const [row] = await tx
      .update(lookupTables)
      .set({ ...changes, revision: current.revision + 1 })
      .where(eq(lookupTables.id, id))
      .returning();
    return view(row!);
  });
}

/** Deletes a lookup table. Returns false when there was none. */
export async function deleteLookupTable(id: string): Promise<boolean> {
  const rows = await getDb().delete(lookupTables).where(eq(lookupTables.id, id)).returning({ id: lookupTables.id });
  return rows.length > 0;
}

/**
 * The lookup tables with these ids, as they are now, for a run, the preview or a Test.
 * A table that was deleted is not in the map.
 */
export async function loadLookupTables(ids: Iterable<string>): Promise<Map<string, LookupTableData>> {
  const wanted = [...new Set(ids)].filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  if (wanted.length === 0) return new Map();
  const rows = await getDb().select().from(lookupTables).where(inArray(lookupTables.id, wanted));
  return new Map(rows.map((row) => [row.id, { id: row.id, name: row.name, revision: row.revision, columns: row.columns, rows: row.rows }]));
}

/** The names and columns of every lookup table, by id, to check lookups against. */
export async function lookupTableShapes(): Promise<Map<string, Pick<LookupTableData, 'name' | 'columns'>>> {
  const rows = await getDb().select({ id: lookupTables.id, name: lookupTables.name, columns: lookupTables.columns }).from(lookupTables);
  return new Map(rows.map((row) => [row.id, { name: row.name, columns: row.columns }]));
}
