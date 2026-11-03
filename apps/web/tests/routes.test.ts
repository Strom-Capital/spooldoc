import { describe, expect, it } from 'vitest';
import type { Route, RouteCondition } from '@/lib/job-spec';
import { isSimpleDestination, routeLabel, routeNumberLabel, routeProblems, takesSpooledFile } from '@/lib/routes';
import type { RunDocument } from '@/lib/server/destinations';
import { checkCondition, checkRoutes, routeDocuments, routeNote, unroutedError } from '@/lib/server/routing';

const ID_A = '00000000-0000-4000-8000-00000000000a';
const ID_B = '00000000-0000-4000-8000-00000000000b';

const to = (destinationId: string) => ({ destinationId, email: null, webhook: null });
const route = (when: RouteCondition[], ...ids: string[]): Route => ({ when, destinations: ids.map(to) });

const data = { pg: { email: 'ap@example.com', blank: '  ', none: null, country: ' DK ', total: 1000, due: '2026-10-15' }, splf: { name: 'SPDINVOICE', number: 3 } };
const types = { 'pg.total': 'number', 'pg.due': 'date', 'splf.number': 'number' } as const;
const check = (condition: RouteCondition, whole = false) => checkCondition(condition, data, types, whole);

const document = (index: number | null, pg: Record<string, unknown>): RunDocument => ({
  pageGroupIndex: index,
  name: index === null ? 'spdinvoice' : `invoice-${index + 1}`,
  pages: index === null ? null : { first: index + 1, last: index + 1 },
  data: index === null ? { pgs: [], splf: { name: 'SPDINVOICE' } } : { pg, splf: { name: 'SPDINVOICE' } },
});

describe('a condition', () => {
  it('counts missing, null and blank as empty', () => {
    for (const field of ['pg.blank', 'pg.none', 'pg.gone']) expect(check({ field, op: 'empty' }).ok, field).toBe(true);
    expect(check({ field: 'pg.email', op: 'empty' })).toEqual({ ok: false, reason: 'pg.email is ap@example.com, not empty' });
    expect(check({ field: 'pg.email', op: 'notEmpty' }).ok).toBe(true);
    expect(check({ field: 'pg.blank', op: 'notEmpty' })).toEqual({ ok: false, reason: 'pg.blank is empty' });
    expect(check({ field: 'pg.gone', op: 'notEmpty' })).toEqual({ ok: false, reason: 'pg.gone is not in the data' });
  });

  it('compares text exactly, in the same case, after trimming', () => {
    expect(check({ field: 'pg.country', op: 'equals', value: 'DK' }).ok).toBe(true);
    expect(check({ field: 'pg.country', op: 'equals', value: ' DK' }).ok).toBe(true);
    expect(check({ field: 'pg.country', op: 'equals', value: 'dk' }).ok).toBe(false);
    expect(check({ field: 'pg.country', op: 'equals', value: 'SE' })).toEqual({ ok: false, reason: 'pg.country is DK, not SE' });
    expect(check({ field: 'pg.blank', op: 'equals', value: 'SE' })).toEqual({ ok: false, reason: 'pg.blank is empty, not SE' });
    expect(check({ field: 'pg.gone', op: 'equals', value: 'SE' })).toEqual({ ok: false, reason: 'pg.gone is not in the data' });
  });

  it('compares a number field as a number and a date field as a date, whatever the Formats print', () => {
    expect(check({ field: 'pg.total', op: 'equals', value: '1,000.00' }).ok).toBe(true);
    expect(check({ field: 'pg.total', op: 'equals', value: '1000' }).ok).toBe(true);
    expect(check({ field: 'pg.total', op: 'equals', value: '999' })).toEqual({ ok: false, reason: 'pg.total is 1000, not 999' });
    expect(check({ field: 'pg.due', op: 'equals', value: '15.10.2026' }).ok).toBe(true);
    expect(check({ field: 'pg.due', op: 'equals', value: '2026-10-15' }).ok).toBe(true);
    expect(check({ field: 'splf.number', op: 'oneOf', values: ['2', '3'] }).ok).toBe(true);
  });

  it('takes one of a list, and lists the values it is not', () => {
    expect(check({ field: 'pg.country', op: 'oneOf', values: ['SE', 'DK'] }).ok).toBe(true);
    expect(check({ field: 'pg.country', op: 'oneOf', values: ['SE', 'FI', 'NO'] })).toEqual({ ok: false, reason: 'pg.country is DK, not SE, FI or NO' });
    expect(check({ field: 'pg.country', op: 'oneOf', values: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] }).reason).toBe('pg.country is DK, not A, B, C, D, E or 2 more');
  });

  it('matches a regular expression', () => {
    expect(check({ field: 'pg.email', op: 'matches', pattern: '@example\\.com$' }).ok).toBe(true);
    expect(check({ field: 'pg.email', op: 'matches', pattern: '^AP' })).toEqual({ ok: false, reason: 'pg.email is ap@example.com, which does not match /^AP/' });
    expect(check({ field: 'pg.email', op: 'matches', pattern: '(' }).reason).toBe('/(/ is not a valid regular expression');
  });

  it('cuts a long value at 40 characters', () => {
    const long = { pg: { note: 'x'.repeat(60) } };
    expect(checkCondition({ field: 'pg.note', op: 'empty' }, long, {}, false).reason).toBe(`pg.note is ${'x'.repeat(39)}…, not empty`);
  });

  it('never matches without a field, though the whole document is at the empty path', () => {
    for (const op of ['empty', 'notEmpty'] as const) expect(check({ field: ' ', op })).toEqual({ ok: false, reason: 'a condition has no field yet: pick a field' });
    expect(checkRoutes([route([{ field: '', op: 'notEmpty' }], ID_A)], data, types, false).route).toBeNull();
  });

  it('never matches a page group field for the whole spooled file', () => {
    expect(check({ field: 'pg.email', op: 'notEmpty' }, true)).toEqual({ ok: false, reason: 'the whole spooled file has no page group fields, such as pg.email' });
    expect(check({ field: 'splf.name', op: 'equals', value: 'SPDINVOICE' }, true).ok).toBe(true);
  });
});

describe('routes', () => {
  const routes = [route([{ field: 'pg.email', op: 'notEmpty' }], ID_A), route([], ID_B)];

  it('label the last route without conditions Otherwise', () => {
    expect(routes.map((_, index) => routeLabel(routes, index))).toEqual(['Route 1', 'Otherwise']);
    expect(routeLabel([route([])], 0)).toBe('Route 1');
    expect(routeLabel([route([]), route([{ field: 'pg.x', op: 'empty' }])], 1)).toBe('Route 2');
    // The job log knows only how many routes there were, and whether the last is Otherwise.
    expect([1, 2].map((n) => routeNumberLabel(n, 2, true))).toEqual(['Route 1', 'Otherwise']);
    expect(routeNumberLabel(2, 2, false, true)).toBe('route 2');
    expect(routeNumberLabel(1, 1, true)).toBe('Route 1');
  });

  it('take the first that matches', () => {
    expect(checkRoutes(routes, data, types, false).route).toBe(0);
    expect(checkRoutes(routes, { pg: { email: '' } }, types, false)).toEqual({
      route: 1,
      checks: [
        { ok: false, conditions: [{ ok: false, reason: 'pg.email is empty' }] },
        { ok: true, conditions: [] },
      ],
    });
  });

  it('make one target per destination of each route that took documents, in order, and list the documents no route took', () => {
    const two = [route([{ field: 'pg.email', op: 'notEmpty' }], ID_A, ID_B), route([{ field: 'pg.country', op: 'equals', value: 'SE' }], ID_B)];
    const documents = [document(0, { email: 'a@example.com' }), document(1, { country: 'DK' }), document(2, { country: 'SE' })];
    const { targets, unrouted, taken } = routeDocuments(two, documents, {});
    expect(targets.map((target) => [target.route, target.destinationId, target.documents.map((d) => d.pageGroupIndex)])).toEqual([
      [1, ID_A, [0]],
      [1, ID_B, [0]],
      [2, ID_B, [2]],
    ]);
    expect(taken).toEqual([0, null, 1]);
    expect(unrouted).toEqual([{ pageGroup: 1, document: 'invoice-2', reasons: ['Route 1: pg.email is not in the data', 'Route 2: pg.country is DK, not SE'] }]);
    expect(routeNote(two, documents, taken)).toBe('Route 1: 1 page group, route 2: 1, no route: 1');
    expect(unroutedError([unrouted[0]!, unrouted[0]!, unrouted[0]!], 3, true)).toMatch(/^0 of 3 documents took a route\. /);
    expect(unroutedError(unrouted, 3, true)).toBe(
      '2 of 3 documents took a route. Page group 2 (invoice-2) matched no route: Route 1: pg.email is not in the data; Route 2: pg.country is DK, not SE. The Route step lists each one.',
    );
  });

  it('make no target for a route that took no document', () => {
    const { targets } = routeDocuments(routes, [document(0, { email: 'a@example.com' })], {});
    expect(targets.map((target) => target.destinationId)).toEqual([ID_A]);
  });

  it('give the whole spooled file to the first route that reads only splf fields, or has none', () => {
    const documents = [document(0, { email: 'a@example.com' }), document(null, {})];
    const { taken, unrouted } = routeDocuments(routes, documents, {});
    expect(taken).toEqual([0, 1]);
    expect(unrouted).toEqual([]);
    expect(routeNote(routes, documents, taken)).toBe('Route 1: 1 page group, otherwise: 0, whole spooled file: otherwise');
    const only = [route([{ field: 'pg.email', op: 'notEmpty' }], ID_A)];
    const missed = routeDocuments(only, documents, {}).unrouted;
    expect(missed).toEqual([{ pageGroup: null, document: 'spdinvoice', reasons: ['the whole spooled file has no page group fields, such as pg.email'] }]);
    expect(unroutedError([...missed, ...missed], 2, false)).toBe(
      'The whole spooled file (spdinvoice) matched no route: the whole spooled file has no page group fields, such as pg.email. 1 more document matched no route. The Route step lists each one.',
    );
  });

  it('are the simple case with one route, no conditions and at most one destination', () => {
    expect(isSimpleDestination({ routes: [route([], ID_A)] })).toBe(true);
    expect(isSimpleDestination({ routes: [route([])] })).toBe(true);
    expect(isSimpleDestination({ routes: [route([], ID_A, ID_B)] })).toBe(false);
    expect(isSimpleDestination({ routes: [route([{ field: 'pg.x', op: 'empty' }], ID_A)] })).toBe(false);
    expect(isSimpleDestination({ routes })).toBe(false);
    expect(takesSpooledFile(route([{ field: 'splf.name', op: 'equals', value: 'X' }]))).toBe(true);
  });
});

describe('route problems', () => {
  it('ask for a destination, in the simple case without a route number', () => {
    expect(routeProblems([route([])], false)).toEqual(['Destination: pick a destination.']);
    expect(routeProblems([route([{ field: 'pg.x', op: 'empty' }], ID_A), route([])], false)).toEqual(['Destination, route 2: pick a destination.']);
  });

  it('refuse a destination twice in one route', () => {
    expect(routeProblems([route([], ID_A, ID_A)], false)).toEqual(['Destination: a destination is picked twice. Pick each destination once.']);
  });

  it('name each incomplete condition and an invalid pattern', () => {
    const problems = routeProblems(
      [
        route(
          [
            { field: '', op: 'empty' },
            { field: 'pg.a', op: 'equals', value: ' ' },
            { field: 'pg.a', op: 'oneOf', values: [] },
            { field: 'pg.a', op: 'matches', pattern: '' },
            { field: 'pg.a', op: 'matches', pattern: '[' },
          ],
          ID_A,
        ),
        route([], ID_B),
      ],
      false,
    );
    expect(problems).toEqual([
      'Destination, route 1, condition 1: pick a field.',
      'Destination, route 1, condition 2: enter a value.',
      'Destination, route 1, condition 3: enter at least one value.',
      'Destination, route 1, condition 4: enter a pattern.',
      'Destination, route 1, condition 5: the pattern is not a valid regular expression.',
    ]);
  });

  it('say when a route can never take a document', () => {
    expect(routeProblems([route([], ID_A), route([{ field: 'pg.a', op: 'empty' }], ID_B), route([], ID_B)], false)).toEqual([
      'Destination: route 2 can never take a document, since route 1 has no conditions and takes every document. Add a condition to route 1, or move it last.',
      'Destination: route 3 can never take a document, since route 1 has no conditions and takes every document. Add a condition to route 1, or move it last.',
    ]);
  });

  it('say when no route can take the document of the whole spooled file, only when a template makes one', () => {
    const routes = [route([{ field: 'pg.email', op: 'notEmpty' }], ID_A)];
    expect(routeProblems(routes, false)).toEqual([]);
    expect(routeProblems(routes, true)).toEqual([
      'Destination: no route can take the document of the whole spooled file, since it has no page group fields. Add a route without conditions, or one that reads only splf fields.',
    ]);
    expect(routeProblems([...routes, route([{ field: 'splf.name', op: 'equals', value: 'X' }], ID_B)], true)).toEqual([]);
  });
});
