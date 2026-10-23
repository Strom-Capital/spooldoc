import { lookupUntested, type Lookup, type LookupColumn } from '@spooldoc/core/lookups';
import type { LookupsPreview, RenderResult } from '@/lib/client/render';

/** A lookup's columns from its last Test, or none when its SQL changed since. */
export function testedColumns(lookup: Pick<Lookup, 'sql' | 'checked'>): LookupColumn[] {
  return lookupUntested(lookup) ? [] : (lookup.checked?.columns ?? []);
}

/**
 * The columns the Test pane shows as the lookup's: those of a Test in this session of
 * the SQL the lookup has now, else those its last Test kept, if that was of this SQL.
 * None after the SQL changed, so no tag of the old columns shows as current.
 */
export function currentColumns<C extends LookupColumn>(
  lookup: Pick<Lookup, 'sql' | 'checked'>,
  outcome?: { sql: string; view?: { columns: C[] } },
): (C | LookupColumn)[] {
  if (outcome?.view && outcome.sql === lookup.sql) return outcome.view.columns;
  return testedColumns(lookup);
}

/**
 * The lookups of the preview for the page group shown, or undefined while the render
 * shown is of another page group (one is on its way). A render of another page group
 * never speaks for this one.
 */
export function previewFor(render: Pick<RenderResult, 'lookups' | 'pageGroup'> | null | undefined, pageGroup: number): LookupsPreview | undefined {
  return render && render.pageGroup === pageGroup ? render.lookups : undefined;
}

/** What one lookup did in the page group shown, from the preview's traces. */
export interface LookupSummary {
  /** Times it ran, or came from the cache: once for a page group lookup, once per row of its table for a row lookup. */
  ran: number;
  /** Of those, the ones that found at least one row. */
  found: number;
  /** Rows found, in all. */
  rows: number;
  /** Times it found no row. */
  none: number;
  /** Times it did not run, since the earlier lookup it reads found no row; and that lookup. */
  skipped: number;
  skippedFor?: string;
  /** The bound parameters of its first run. */
  parameters: { name: string; value: string | number | null }[];
}

/** Sums up one lookup's traces in the preview. */
export function lookupSummary(lookup: Pick<Lookup, 'name'>, preview: LookupsPreview | undefined): LookupSummary {
  const traces = (preview?.traces ?? []).filter((t) => t.lookup === lookup.name);
  const run = traces.filter((t) => !t.skippedFor);
  const skipped = traces.filter((t) => t.skippedFor);
  return {
    ran: run.length,
    found: run.filter((t) => t.rows > 0).length,
    rows: run.reduce((sum, t) => sum + t.rows, 0),
    none: run.filter((t) => t.rows === 0).length,
    skipped: skipped.length,
    ...(skipped[0]?.skippedFor ? { skippedFor: skipped[0].skippedFor } : {}),
    parameters: run[0]?.parameters ?? [],
  };
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * The sub line of the Lookups node: what to do or what went wrong first, else what the
 * lookups found in the page group shown.
 */
export function lookupsSub(lookups: readonly Lookup[], preview: LookupsPreview | undefined): string | undefined {
  if (lookups.length === 0) return undefined;
  const untested = lookups.find(lookupUntested);
  if (untested) return `Test ${untested.name.trim() || 'the lookup'}`;
  if (preview?.problems[0]) return preview.problems[0].message;
  if (preview?.error) return preview.error.message;
  if (preview?.misses[0]) return preview.misses[0].text;
  if (!preview || preview.traces.length === 0) return undefined;
  if (lookups.length > 1) return 'Every lookup found its rows in this page group';
  const only = lookups[0]!;
  if (only.for) return `Once per row of ${only.for}`;
  return `${plural(lookupSummary(only, preview).rows, 'row')} in this page group`;
}

/** What the Test pane says one lookup did in the page group shown, as plain sentences. */
export function summaryText(lookup: Pick<Lookup, 'name' | 'for'>, summary: LookupSummary): string | undefined {
  const { ran, found, rows, none, skipped, skippedFor } = summary;
  if (ran === 0 && skipped === 0) return undefined;
  const sentences: string[] = [];
  if (ran > 0) {
    sentences.push(
      lookup.for
        ? `In this page group, ${lookup.name} ran for ${plural(ran, `row of ${lookup.for}`, `rows of ${lookup.for}`)}: ${found} found a row${none > 0 ? ` and ${none} found none` : ''}.`
        : `In this page group, ${lookup.name} found ${rows === 0 ? 'no row' : plural(rows, 'row')}.`,
    );
  }
  if (skipped > 0) {
    const where = lookup.for ? ` for ${plural(skipped, `row of ${lookup.for}`, `rows of ${lookup.for}`)}` : '';
    sentences.push(`${skippedFor} found no row, so ${lookup.name} did not run${where} and is left empty.`);
  }
  return sentences.join(' ');
}
