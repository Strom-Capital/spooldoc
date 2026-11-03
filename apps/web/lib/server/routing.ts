import 'server-only';

import { valueAt, type ValueType } from '@spooldoc/core';
import { parseDate, parseNumber } from '@spooldoc/core/values';
import type { Route, RouteCondition } from '@/lib/job-spec';
import { routeLabel, spooledFileField } from '@/lib/routes';
import type { DeliveryTarget } from './deliver';
import type { RunDocument } from './destinations';

/** The most characters of a value a reason prints. */
const SHOWN_MAX = 40;

/** The most values of "is one of" a reason lists before it says how many more there are. */
const LISTED_MAX = 5;

/** One condition, checked against one document: whether it matches, and why not. */
export interface ConditionCheck {
  ok: boolean;
  /** Why it does not match, such as `pg.country is DK, not SE`; null when it matches. */
  reason: string | null;
}

/** One route, checked against one document: each of its conditions, and whether all match. */
export interface RouteCheck {
  ok: boolean;
  conditions: ConditionCheck[];
}

/** A document no route took, with why each route did not. */
export interface Unrouted {
  /** The page group; null for the document of the whole spooled file. */
  pageGroup: number | null;
  document: string;
  reasons: string[];
}

/** A value as a reason prints it: trimmed, cut at 40 characters. */
function shown(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
  return text.length > SHOWN_MAX ? `${text.slice(0, SHOWN_MAX - 1)}…` : text;
}

/** Missing, null and blank are empty. */
function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/** "SE", "SE or FI", "SE, FI or NO", "SE, FI, NO, DK, IS or 2 more". */
function orList(values: readonly string[]): string {
  const items = values.map(shown);
  if (items.length <= 1) return items[0] ?? '';
  if (items.length > LISTED_MAX) return `${items.slice(0, LISTED_MAX).join(', ')} or ${items.length - LISTED_MAX} more`;
  return `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;
}

/**
 * True when the field's value equals the text of a condition. A number field compares as a
 * number and a date field as a date, so `1,000.00` equals 1000. Text is trimmed and
 * compared exactly, in the same case, like the `match` rules of a definition.
 */
function equalsValue(value: unknown, text: string, type: ValueType | undefined): boolean {
  if (type === 'number' && typeof value === 'number') {
    const number = parseNumber(text);
    if (number !== null) return number === value;
  }
  if (type === 'date' && typeof value === 'string') {
    const date = parseDate(text);
    if (date !== null) return date === value.trim();
  }
  return shownText(value) === text.trim();
}

/** The raw value as the text a condition compares: trimmed strings, numbers as written by JSON. */
const shownText = (value: unknown): string => (typeof value === 'string' ? value.trim() : typeof value === 'object' ? JSON.stringify(value) : String(value));

/**
 * Check one condition against a document's data. It compares the value in the JSON, not
 * the printed text, so the Formats of Settings never change where a document goes. The
 * document of the whole spooled file (`spooledFile`) has no page group, so a condition on
 * `pg` never matches it.
 */
export function checkCondition(condition: RouteCondition, data: unknown, types: Readonly<Record<string, ValueType>>, spooledFile: boolean): ConditionCheck {
  const { field } = condition;
  const fail = (reason: string): ConditionCheck => ({ ok: false, reason });
  if (spooledFile && !spooledFileField(field)) return fail(`the whole spooled file has no page group fields, such as ${field}`);
  const value = valueAt(data, field);
  const missing = value === undefined;
  const empty = isEmpty(value);
  switch (condition.op) {
    case 'empty':
      return empty ? { ok: true, reason: null } : fail(`${field} is ${shown(value)}, not empty`);
    case 'notEmpty':
      return !empty ? { ok: true, reason: null } : fail(missing ? `${field} is not in the data` : `${field} is empty`);
    case 'equals': {
      if (!empty && equalsValue(value, condition.value, types[field])) return { ok: true, reason: null };
      return fail(missing ? `${field} is not in the data` : `${field} is ${empty ? 'empty' : shown(value)}, not ${shown(condition.value)}`);
    }
    case 'oneOf': {
      const values = condition.values.filter((text) => text.trim());
      if (!empty && values.some((text) => equalsValue(value, text, types[field]))) return { ok: true, reason: null };
      return fail(missing ? `${field} is not in the data` : `${field} is ${empty ? 'empty' : shown(value)}, not ${orList(values)}`);
    }
    case 'matches': {
      let pattern: RegExp;
      try {
        pattern = new RegExp(condition.pattern);
      } catch {
        return fail(`/${condition.pattern}/ is not a valid regular expression`);
      }
      if (!missing && pattern.test(value === null ? '' : shownText(value))) return { ok: true, reason: null };
      return fail(missing ? `${field} is not in the data` : `${field} is ${empty ? 'empty' : shown(value)}, which does not match /${shown(condition.pattern)}/`);
    }
  }
}

/** Check every route against a document. The document takes the first that matches: `route`, or null for none. */
export function checkRoutes(
  routes: readonly Route[],
  data: unknown,
  types: Readonly<Record<string, ValueType>>,
  spooledFile: boolean,
): { route: number | null; checks: RouteCheck[] } {
  const checks = routes.map((route) => {
    const conditions = route.when.map((condition) => checkCondition(condition, data, types, spooledFile));
    return { ok: conditions.every((check) => check.ok), conditions };
  });
  const index = checks.findIndex((check) => check.ok);
  return { route: index === -1 ? null : index, checks };
}

/**
 * Why a document took none of the routes, one line per route: its conditions that do not
 * match, joined by "; ". With several routes each line starts with the route, as in
 * "Route 1: pg.email is empty".
 */
export function unroutedReasons(routes: readonly Route[], checks: readonly RouteCheck[]): string[] {
  return checks.map((check, index) => {
    const text = check.conditions.flatMap((condition) => (condition.reason ? [condition.reason] : [])).join('; ');
    return routes.length > 1 ? `${routeLabel(routes, index)}: ${text}` : text;
  });
}

/**
 * Where each document of a run goes: one target per destination of each route, in route
 * order and then destination order, with the documents that took the route. A route that
 * took no document makes no target. The documents that took no route come back in
 * `unrouted`, and `counts` says how many page groups took each route.
 */
export function routeDocuments(
  routes: readonly Route[],
  documents: readonly RunDocument[],
  types: Readonly<Record<string, ValueType>>,
): { targets: DeliveryTarget[]; unrouted: Unrouted[]; taken: (number | null)[] } {
  const byRoute = routes.map((): RunDocument[] => []);
  const unrouted: Unrouted[] = [];
  const taken: (number | null)[] = [];
  for (const document of documents) {
    const whole = document.pageGroupIndex === null;
    const { route, checks } = checkRoutes(routes, document.data, types, whole);
    taken.push(route);
    if (route === null) unrouted.push({ pageGroup: document.pageGroupIndex, document: document.name, reasons: unroutedReasons(routes, checks) });
    else byRoute[route]!.push(document);
  }
  const targets = routes.flatMap((route, index) =>
    byRoute[index]!.length === 0
      ? []
      : route.destinations.map((entry) => ({
          route: index + 1,
          destinationId: entry.destinationId,
          email: entry.email,
          webhook: entry.webhook,
          documents: byRoute[index]!,
        })),
  );
  return { targets, unrouted, taken };
}

/** "page group 3 (invoice-1003)", "the whole spooled file (spdinvoice)". */
export function unroutedName(item: Pick<Unrouted, 'pageGroup' | 'document'>): string {
  return item.pageGroup === null ? `the whole spooled file (${item.document})` : `page group ${item.pageGroup + 1} (${item.document})`;
}

/**
 * The Route step's note: how many page groups took each route, and how many took none,
 * as in "Route 1: 9 page groups, otherwise: 2, no route: 1". The document of the whole
 * spooled file comes last: "whole spooled file: route 1".
 */
export function routeNote(routes: readonly Route[], documents: readonly Pick<RunDocument, 'pageGroupIndex'>[], taken: readonly (number | null)[]): string {
  const counts = routes.map(() => 0);
  let none = 0;
  let whole: string | null = null;
  for (const [at, document] of documents.entries()) {
    const route = taken[at] ?? null;
    if (document.pageGroupIndex === null) whole = route === null ? 'no route' : routeLabel(routes, route).toLowerCase();
    else if (route === null) none++;
    else counts[route]!++;
  }
  const parts = counts.map((count, index) => `${index === 0 ? routeLabel(routes, index) : routeLabel(routes, index).toLowerCase()}: ${count}`);
  if (parts.length > 0) parts[0] = `${parts[0]} ${counts[0] === 1 ? 'page group' : 'page groups'}`;
  if (none > 0) parts.push(`no route: ${none}`);
  if (whole) parts.push(`whole spooled file: ${whole}`);
  return parts.join(', ');
}

/**
 * The run's error when documents took no route: what was delivered, the first one and
 * why, and how many more. "Delivered 11 of 12 documents. Page group 3 (invoice-1003)
 * matched no route: pg.country is DK, not SE. The Route step lists each one."
 */
export function unroutedError(unrouted: readonly Unrouted[], total: number, delivered: boolean): string {
  const first = unrouted[0]!;
  const name = unroutedName(first);
  const lead = delivered ? `Delivered ${total - unrouted.length} of ${total} ${total === 1 ? 'document' : 'documents'}. ` : '';
  const more = unrouted.length > 1 ? ` ${unrouted.length - 1} more ${unrouted.length === 2 ? 'document' : 'documents'} matched no route.` : '';
  return `${lead}${name[0]!.toUpperCase()}${name.slice(1)} matched no route: ${first.reasons.join('; ')}.${more} The Route step lists each one.`;
}
