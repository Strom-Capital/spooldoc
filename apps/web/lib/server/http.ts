import 'server-only';

import { redact as redactSecrets } from '@spooldoc/ibmi';
import { getConfig } from './config';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function originOf(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

/**
 * Refuse a state-changing request that does not come from this app's own pages.
 * The Origin header, or else the Referer, must match APP_URL or the request's own host.
 * The session cookie is SameSite=Lax as well; this covers same-site hosts.
 *
 * @param request - The incoming request
 * @returns A 403 response, or undefined when the request may go on
 */
export function checkOrigin(request: Request): Response | undefined {
  if (!STATE_CHANGING.has(request.method.toUpperCase())) {
    return undefined;
  }
  const origin = originOf(request.headers.get('origin')) ?? originOf(request.headers.get('referer'));
  if (origin) {
    const appUrl = getConfig().appUrl?.origin;
    const host = request.headers.get('host');
    if (origin === appUrl || (host && new URL(origin).host === host)) {
      return undefined;
    }
  }
  return errorResponse(403, 'Cross-origin request refused.');
}

/**
 * Refuse a read that another site started. GET API routes reach the IBM i and the
 * workspace, so `Sec-Fetch-Site: cross-site` is refused. Requests without the header
 * (curl, older browsers) pass.
 *
 * @param request - The incoming request
 * @returns A 403 response, or undefined when the request may go on
 */
export function checkFetchSite(request: Request): Response | undefined {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return errorResponse(403, 'Cross-site request refused.');
  }
  return undefined;
}

/**
 * A JSON error response: `{ error }` with the status.
 *
 * @param status - HTTP status
 * @param message - Text the page can show
 */
export function errorResponse(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * A JSON response that is never cached.
 *
 * @param data - The body
 * @param init - Status and headers
 */
export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  return Response.json(data, { ...init, headers });
}

/**
 * A safe one-line message for an error, with every secret replaced by `***`.
 *
 * @param error - Anything thrown
 * @param secrets - Values to blank out, such as the session password
 * @returns The first line of the message, or a generic text
 */
export function redact(error: unknown, secrets: readonly string[] = []): string {
  const message = error instanceof Error && error.message ? error.message : 'Request failed';
  const line = message.split('\n')[0] ?? 'Request failed';
  return redactSecrets(line, secrets.filter((secret) => secret.length > 0));
}

/**
 * Parse a JSON request body against a schema.
 *
 * @param request - The incoming request
 * @param schema - Anything with zod's `safeParse`
 * @returns The data, or a 400 response with the first problem
 */
export async function readJson<T>(
  request: Request,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string; path: PropertyKey[] }[] } } },
): Promise<{ data: T } | { response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { response: errorResponse(400, 'The request body is not JSON.') };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { response: invalidResponse(issue?.message ?? 'Invalid request.', issue?.path ?? []) };
  }
  return { data: parsed.data };
}

// zod's own messages, which do not say which field they are about.
const GENERIC = /^(Invalid|Too (big|small)|Unrecognized|Expected|Required)\b/;

/**
 * A 400 for a value that is not valid: `{ error, field }`. A message the schema wrote for
 * people ("Enter the password") is shown as a sentence; one of zod's own keeps the field
 * name in front, since it does not say which field it is about.
 *
 * @param message - The issue's message
 * @param path - Where in the body the issue is
 */
export function invalidResponse(message: string, path: readonly PropertyKey[]): Response {
  const field = path.length > 0 ? path.map(String).join('.') : undefined;
  const sentence = /[.!?]$/.test(message) ? message : `${message}.`;
  const error = GENERIC.test(message) && field ? `${field}: ${sentence}` : sentence;
  return json(field ? { error, field } : { error }, { status: 400 });
}

/** The seconds a Retry-After header asks for: a number of seconds, or a date. */
export function retryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}
