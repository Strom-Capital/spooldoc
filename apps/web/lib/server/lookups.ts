import 'server-only';

import {
  applyLookups,
  isLookupError,
  lookupProblems,
  lookupUntested,
  type Definition,
  type Lookup,
  type LookupCache,
  type LookupMiss,
  type LookupProblem,
  type LookupQueryResult,
  type LookupsResult,
  type LookupTableData,
  type LookupTrace,
} from '@spooldoc/core';
import type { Connection } from '@spooldoc/ibmi';
import { redact } from './http';
import { connectServer, isConnectionError } from './ibmi';
import { loadLookupTables, lookupTableShapes } from './lookup-tables';
import type { PreviewLookupRunner } from './render';

/**
 * Run a job's lookups for page groups: the Db2 for i lookups on an open IBM i connection,
 * the table lookups on the lookup tables given. The one helper for the run and every
 * preview, so they give the same data.
 *
 * @param conn - The IBM i connection, or null when no lookup that runs reads Db2 for i
 * @throws LookupError naming the lookup when one stops (see `applyLookups`)
 */
export function runLookups(
  conn: Connection | null,
  lookups: readonly Lookup[],
  groups: readonly Record<string, unknown>[],
  options: { cache?: LookupCache; only?: readonly number[]; names?: readonly string[]; tables?: ReadonlyMap<string, LookupTableData> } = {},
): Promise<LookupsResult> {
  const { tables, ...rest } = options;
  return applyLookups(groups, lookups, { ...(conn ? { query: (sql, params, limits) => conn.query(sql, params, limits) } : {}), ...(tables ? { tables } : {}) }, rest);
}

/** The ids of the lookup tables that lookups read. */
export const lookupTableIds = (lookups: readonly Lookup[]): string[] => [...new Set(lookups.flatMap((l) => (l.source === 'table' && l.table ? [l.table] : [])))];

/** True when a lookup reads Db2 for i, so running them needs the IBM i. */
export const needsServer = (lookups: readonly Lookup[]): boolean => lookups.some((l) => l.source !== 'table');

/** How long the preview keeps a lookup's result, so typing in a template does not query the IBM i again. */
export const PREVIEW_CACHE_MS = 2 * 60 * 1000;
const MAX_PREVIEW_ENTRIES = 500;

const previewEntries = (): Map<string, { at: number; value: Promise<LookupQueryResult> }> => {
  const g = globalThis as { __spooldocLookupCache?: Map<string, { at: number; value: Promise<LookupQueryResult> }> };
  g.__spooldocLookupCache ??= new Map();
  return g.__spooldocLookupCache;
};

/** The preview's cache of lookup results on one server, kept `PREVIEW_CACHE_MS`. */
export function previewCache(serverId: string): LookupCache {
  const entries = previewEntries();
  const key = (k: string) => `${serverId}\n${k}`;
  return {
    get(k) {
      const entry = entries.get(key(k));
      if (!entry) return undefined;
      if (Date.now() - entry.at > PREVIEW_CACHE_MS) {
        entries.delete(key(k));
        return undefined;
      }
      return entry.value;
    },
    set(k, value) {
      const now = Date.now();
      for (const [old, entry] of entries) if (now - entry.at > PREVIEW_CACHE_MS) entries.delete(old);
      while (entries.size >= MAX_PREVIEW_ENTRIES) entries.delete(entries.keys().next().value!);
      entries.set(key(k), { at: now, value });
    },
    delete(k) {
      entries.delete(key(k));
    },
  };
}

/** Forget every cached lookup result, for tests. */
export function clearPreviewCache(): void {
  previewEntries().clear();
}

/** Why the lookups did not run in a preview: what to do, the lookup when one stopped, and the system's own text. */
export interface LookupsPreviewError {
  message: string;
  lookup?: string;
  code?: string;
  detail?: string;
}

/** What the preview shows of the lookups of one page group. Mirrored in lib/client/render.ts. */
export interface LookupsPreview {
  /** Each time a lookup ran for the page group shown. */
  traces: LookupTrace[];
  /** Lookups that found no row in it and warn. */
  misses: LookupMiss[];
  /** What is wrong with the lookups, checked without the IBM i. */
  problems: LookupProblem[];
  /** The lookups that ran: the ones before the first that is untested. */
  ran: string[];
  /** The page group shown, with the lookups' values. */
  pageGroup?: Record<string, unknown>;
  error?: LookupsPreviewError;
}

/**
 * Run a draft's lookups for a preview, with the job's source server and the preview's
 * cache. Only tested lookups without problems run, up to the first one that is not, so a lookup's SQL
 * runs on the IBM i only after the user tested it. The IBM i is connected only when a
 * lookup that runs reads Db2 for i: table lookups need no server. When the lookups cannot
 * run, the page groups come back as they are and `preview.error` says why; nothing is thrown.
 *
 * @param only - The page groups to look up; the preview shows `only[0]`
 * @returns Null when the job has no lookups
 */
export async function previewLookups(
  serverId: string | null,
  lookups: readonly Lookup[],
  def: Definition,
  groups: Record<string, unknown>[],
  only: readonly number[],
  names: readonly string[],
): Promise<{ groups: Record<string, unknown>[]; preview: LookupsPreview } | null> {
  if (lookups.length === 0) return null;
  const shown = only[0] ?? 0;
  let shapes: Awaited<ReturnType<typeof lookupTableShapes>> | undefined;
  try {
    // The lookup tables are read only for a job that has a table lookup.
    shapes = lookups.some((l) => l.source === 'table') ? await lookupTableShapes() : undefined;
  } catch (error) {
    return { groups, preview: { traces: [], misses: [], problems: [], ran: [], error: { message: `Could not read the lookup tables: ${redact(error)}` } } };
  }
  const problems = lookupProblems(def, lookups, shapes);
  // Later lookups can read earlier ones, so the first that is untested or has a problem stops the rest.
  const blocked = lookups.findIndex((lookup, index) => lookupUntested(lookup) || problems.some((p) => p.index === index));
  const ran = blocked === -1 ? lookups : lookups.slice(0, blocked);
  const preview: LookupsPreview = { traces: [], misses: [], problems, ran: ran.map((l) => l.name) };
  if (ran.length === 0) return { groups, preview };
  const db2 = needsServer(ran);
  if (db2 && !serverId) {
    preview.ran = [];
    preview.error = { message: 'Pick a server in the Source step to run the lookups.' };
    return { groups, preview };
  }
  let secrets: string[] = [];
  try {
    let conn: Connection | null = null;
    if (db2 && serverId) {
      const connected = await connectServer(serverId);
      conn = connected.conn;
      secrets = [connected.password];
    }
    const tables = await loadLookupTables(lookupTableIds(ran));
    const result = await runLookups(conn, ran, groups, { cache: previewCache(serverId ?? ''), only, names, tables });
    preview.traces = result.traces.filter((t) => t.pageGroup === shown);
    preview.misses = result.misses.filter((m) => m.pageGroup === shown);
    preview.pageGroup = result.groups[shown];
    return { groups: result.groups, preview };
  } catch (error) {
    preview.ran = [];
    preview.error = {
      message: isLookupError(error) ? redact(error, secrets) : `Could not run the lookups: ${redact(error, secrets)}`,
      ...(isLookupError(error) ? { lookup: error.lookup } : {}),
      ...(isLookupError(error) && error.detail ? { detail: redact(new Error(error.detail), secrets) } : {}),
      ...(isConnectionError(error) ? { code: error.code, ...(error.detail ? { detail: redact(new Error(error.detail), secrets) } : {}) } : {}),
      ...(isLookupError(error) && isConnectionError(error.cause) ? { code: error.cause.code } : {}),
    };
    return { groups, preview };
  }
}

/** A draft's lookups for `renderSample`: their list for the template check, and how the preview runs them. */
export function previewLookupRunner(serverId: string | null, lookups: readonly Lookup[]): { list: readonly Lookup[]; run: PreviewLookupRunner } {
  return { list: lookups, run: (def, groups, only, names) => previewLookups(serverId, lookups, def, groups, only, names) };
}
