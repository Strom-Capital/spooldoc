import { lookupUntested, type Lookup, type LookupColumn } from '@spooldoc/core/lookups';

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
