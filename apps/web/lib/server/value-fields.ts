import 'server-only';

import { templatePaths, type Definition, type Lookup } from '@spooldoc/core';

/**
 * The single values a document has, which an email field shows and a route's condition
 * reads: the page group's fields and the spooled file's, with the columns of a lookup of
 * one row per page group, and without tables and records. The document of the whole
 * spooled file has no page group (`spooledFile`), so it has the spooled file's fields only.
 */
export function valueFields(def: Definition, lookups: readonly Lookup[], spooledFile: boolean): string[] {
  const paths = [...templatePaths(def, lookups)];
  const lists = new Set(paths.filter((path) => path.includes('[]')).map((path) => path.slice(0, path.indexOf('[]'))));
  // A lookup of one row per page group is a row, not a value: its columns are the values.
  const rows = new Set(lookups.filter((l) => l.for === undefined && l.result === 'one').map((l) => `pg.${l.name}`));
  const single = spooledFile ? /^splf\.[^.[\]]+$/ : /^(pg|splf)\.[^.[\]]+$/;
  const column = /^(pg\.[^.[\]]+)\.[^.[\]]+$/;
  return paths.filter((path) => (single.test(path) && !lists.has(path) && !rows.has(path)) || (!spooledFile && rows.has(column.exec(path)?.[1] ?? '')));
}

/** True when the field is one a lookup adds, such as `pg.customer.EMAIL`. */
export function readsLookup(field: string, lookups: readonly Lookup[]): boolean {
  return lookups.some((lookup) => field === `pg.${lookup.name}` || field.startsWith(`pg.${lookup.name}.`));
}
