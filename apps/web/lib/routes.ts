import type { ConditionOp, DestinationSpec, Route, RouteCondition } from './job-spec';

/**
 * Routes, as the job builder and the server both read them: the words for each operator,
 * a route's label, and the checks of their structure. Matching a document is up to the
 * server (`lib/server/routing.ts`).
 */

/** How each operator reads in a condition: "pg.email is not empty". */
export const OP_LABELS: Record<ConditionOp, string> = {
  empty: 'is empty',
  notEmpty: 'is not empty',
  equals: 'equals',
  oneOf: 'is one of',
  matches: 'matches',
};

/** True for the last route of several when it has no conditions: it takes what the others leave. */
export function isOtherwise(routes: readonly Pick<Route, 'when'>[], index: number): boolean {
  return routes.length > 1 && index === routes.length - 1 && routes[index]!.when.length === 0;
}

/** "Route 2", or "Otherwise" for the last route of several when it has no conditions. */
export function routeLabel(routes: readonly Pick<Route, 'when'>[], index: number): string {
  return isOtherwise(routes, index) ? 'Otherwise' : `Route ${index + 1}`;
}

/**
 * True for a job with one route, no conditions and at most one destination. The
 * Destination step shows it as a plain pick of one destination.
 */
export function isSimpleDestination(destination: DestinationSpec): boolean {
  const [only, ...rest] = destination.routes;
  return !!only && rest.length === 0 && only.when.length === 0 && only.destinations.length <= 1;
}

/** Every destination the routes send to, in order, each once. */
export function routeDestinationIds(routes: readonly Pick<Route, 'destinations'>[]): string[] {
  return [...new Set(routes.flatMap((route) => route.destinations.map((entry) => entry.destinationId)))];
}

/** True for a field of the spooled file, such as `splf.name`, which the document of the whole spooled file has too. */
export const spooledFileField = (field: string): boolean => field.startsWith('splf.');

/**
 * True when the route can take the document of the whole spooled file: it has no
 * conditions, or reads only fields of the spooled file. That document has no page group,
 * so a condition on `pg` never matches it.
 */
export function takesSpooledFile(route: Pick<Route, 'when'>): boolean {
  return route.when.every((condition) => spooledFileField(condition.field));
}

/** Null when the text is a regular expression, else why not. */
export function patternProblem(pattern: string): string | null {
  try {
    new RegExp(pattern);
    return null;
  } catch {
    return 'the pattern is not a valid regular expression';
  }
}

/** What a condition still needs, or null when it is complete: "pick a field", "enter a value". */
export function conditionProblem(condition: RouteCondition): string | null {
  if (!condition.field.trim()) return 'pick a field';
  if (condition.op === 'equals' && !condition.value.trim()) return 'enter a value';
  if (condition.op === 'oneOf' && !condition.values.some((value) => value.trim())) return 'enter at least one value';
  if (condition.op === 'matches') return condition.pattern ? patternProblem(condition.pattern) : 'enter a pattern';
  return null;
}

/**
 * How a problem of a route starts: "Destination:" for a job with one route,
 * "Destination, route 2:" for one of several, with more parts after it, such as
 * "Destination, route 2, MYEMAIL:".
 */
export function routePrefix(routes: readonly unknown[], index: number, ...more: string[]): string {
  return `${['Destination', ...(routes.length > 1 ? [`route ${index + 1}`] : []), ...more].join(', ')}:`;
}

/**
 * What keeps routes from being saved in a version, one line each: a route with no
 * destination, a destination twice in one route, an incomplete condition, a route that
 * can never take a document, and, when a template makes a document of the whole spooled
 * file (`spooledFile`), no route that can take it.
 */
export function routeProblems(routes: readonly Route[], spooledFile: boolean): string[] {
  const problems: string[] = [];
  for (const [index, route] of routes.entries()) {
    if (route.destinations.length === 0) problems.push(`${routePrefix(routes, index)} pick a destination.`);
    const ids = route.destinations.map((entry) => entry.destinationId);
    if (new Set(ids).size < ids.length) problems.push(`${routePrefix(routes, index)} a destination is picked twice. Pick each destination once.`);
    for (const [at, condition] of route.when.entries()) {
      const problem = conditionProblem(condition);
      if (problem) problems.push(`${routePrefix(routes, index, `condition ${at + 1}`)} ${problem}.`);
    }
  }
  const open = routes.findIndex((route) => route.when.length === 0);
  if (open !== -1) {
    for (let later = open + 1; later < routes.length; later++) {
      problems.push(
        `Destination: route ${later + 1} can never take a document, since route ${open + 1} has no conditions and takes every document. Add a condition to route ${open + 1}, or move it last.`,
      );
    }
  }
  if (spooledFile && !routes.some(takesSpooledFile)) {
    problems.push(
      'Destination: no route can take the document of the whole spooled file, since it has no page group fields. Add a route without conditions, or one that reads only splf fields.',
    );
  }
  return problems;
}
