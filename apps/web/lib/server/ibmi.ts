import 'server-only';

import type { Connection, ConnectionErrorCode, Credentials } from '@spooldoc/ibmi';
import { errorResponse, redact } from './http';
import { getSession, type IbmiSession } from './session';

type Jt400Module = typeof import('@spooldoc/ibmi/jt400');

const STATUS: Record<ConnectionErrorCode, number> = {
  auth: 401,
  host: 502,
  notfound: 404,
  authority: 403,
  other: 500,
};

/**
 * The jt400 driver, imported on first use. It starts a JVM through the native `java`
 * addon, so this is the only module that loads it, and only at request time. The
 * bundler leaves the import to Node: a linked workspace package is bundled even when
 * it is in `serverExternalPackages`, and the bridge needs its real file location.
 */
async function jt400(): Promise<Jt400Module> {
  return (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ '@spooldoc/ibmi/jt400')) as Jt400Module;
}

/**
 * True for a `ConnectionError` from `@spooldoc/ibmi`. Checked by shape, since the
 * driver is loaded by Node and the bundled copy of the class is a different object.
 */
export function isConnectionError(error: unknown): error is Error & { code: ConnectionErrorCode } {
  const code = (error as { code?: unknown } | null)?.code;
  return error instanceof Error && error.name === 'ConnectionError' && typeof code === 'string' && code in STATUS;
}

/**
 * Turn an error from the IBM i into a JSON response with the password removed:
 * 401 sign-on, 502 host, 404 not found, 403 authority, 500 anything else.
 *
 * @param error - What the connection threw
 * @param secrets - Values to blank out of the message
 */
export function connectionErrorResponse(error: unknown, secrets: readonly string[]): Response {
  if (isConnectionError(error)) {
    return errorResponse(STATUS[error.code], redact(error, secrets));
  }
  return errorResponse(500, redact(error, secrets));
}

/** Credentials for the jt400 cache from the session sign-on. */
function credentials(ibmi: IbmiSession): Credentials {
  return { host: ibmi.host, user: ibmi.user, password: ibmi.password };
}

/**
 * Open (or reuse) the cached connection for these credentials.
 *
 * @param creds - Host, user and password
 * @returns The connection; throws ConnectionError when the sign-on fails
 */
export async function openConnection(creds: Credentials): Promise<Connection> {
  const { getConnection } = await jt400();
  return getConnection(creds);
}

/**
 * Run `fn` with the session's cached IBM i connection. Without a sign-on the answer is
 * 401; a failed call is mapped by `connectionErrorResponse`.
 *
 * @param fn - Gets the connection and the session sign-on, returns the response
 */
export async function withConnection(
  fn: (conn: Connection, ibmi: IbmiSession) => Promise<Response>,
): Promise<Response> {
  const session = await getSession();
  const ibmi = session.ibmi;
  if (!ibmi) {
    return errorResponse(401, 'Not connected. Connect to an IBM i first.');
  }
  try {
    const conn = await openConnection(credentials(ibmi));
    return await fn(conn, ibmi);
  } catch (error) {
    return connectionErrorResponse(error, [ibmi.password]);
  }
}

/** Close the cached connection of the current session's sign-on, if there is one. */
export async function closeSessionConnection(): Promise<void> {
  const session = await getSession();
  if (!session.ibmi) {
    return;
  }
  const { closeConnection, connectionKey } = await jt400();
  await closeConnection(connectionKey(credentials(session.ibmi)));
}
