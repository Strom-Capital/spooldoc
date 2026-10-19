import 'server-only';

import { noAnswerError, withDeadline, type Connection, type ConnectionErrorCode, type Credentials, type SystemInfo } from '@spooldoc/ibmi';
import { errorResponse, json, redact } from './http';
import { getServerRow, serverCredentials, type ServerRow } from './servers';

type Jt400Module = typeof import('@spooldoc/ibmi/jt400');

// A failed IBM i sign-on is 422, so the browser does not take it for the app login (401).
const STATUS: Record<ConnectionErrorCode, number> = {
  auth: 422,
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
export function isConnectionError(error: unknown): error is Error & { code: ConnectionErrorCode; messageId?: string; detail?: string } {
  const code = (error as { code?: unknown } | null)?.code;
  return error instanceof Error && error.name === 'ConnectionError' && typeof code === 'string' && code in STATUS;
}

/**
 * The IBM i message ID and the system's own text of an error, redacted, for a response
 * or a log line. Empty for anything but a `ConnectionError`.
 */
export function ibmiFields(error: unknown, secrets: readonly string[] = []): { messageId?: string; detail?: string } {
  if (!isConnectionError(error)) return {};
  return {
    ...(error.messageId ? { messageId: error.messageId } : {}),
    ...(error.detail ? { detail: redact(new Error(error.detail), secrets) } : {}),
  };
}

/**
 * Turn an error from the IBM i into a JSON response with the password removed:
 * 422 sign-on, 502 host, 404 not found, 403 authority, 500 anything else. The body is
 * `{ error, code, messageId?, detail? }`: `error` says what to do, `detail` is the
 * system's own text.
 *
 * @param error - What the connection threw
 * @param secrets - Values to blank out of the message
 */
export function connectionErrorResponse(error: unknown, secrets: readonly string[]): Response {
  if (isConnectionError(error)) {
    return json({ error: redact(error, secrets), code: error.code, ...ibmiFields(error, secrets) }, { status: STATUS[error.code] });
  }
  return errorResponse(500, redact(error, secrets));
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

/** How long a sign-on (opening the connection and reading the system info) may take. */
export const SIGN_ON_TIMEOUT_MS = 60 * 1000;

/**
 * Sign on: open (or reuse) the cached connection and read the system info, within
 * `SIGN_ON_TIMEOUT_MS`. When the system does not answer in time the cached connection
 * is dropped, so the next attempt starts over, and a host error says so.
 *
 * @param creds - Host, user and password
 * @returns The system info; throws ConnectionError when the sign-on fails or times out
 */
export async function signOn(creds: Credentials): Promise<SystemInfo> {
  const { getConnection, closeConnection, connectionKey } = await jt400();
  const info = getConnection(creds).then((conn) => conn.describe());
  return withDeadline(info, SIGN_ON_TIMEOUT_MS, () => {
    void closeConnection(connectionKey(creds)).catch(() => undefined);
    return noAnswerError(creds.host, SIGN_ON_TIMEOUT_MS);
  });
}

/** Thrown when a server id is not in the database. */
export class ServerNotFoundError extends Error {
  constructor(id: string) {
    super(`Server ${id} not found.`);
    this.name = 'ServerNotFoundError';
  }
}

/** A saved server with its open connection. */
export interface ServerConnection {
  conn: Connection;
  server: ServerRow;
  /** The decrypted password, to blank out of error messages. */
  password: string;
}

/**
 * Open (or reuse) the cached connection of a saved server.
 *
 * @param serverId - The server's id
 * @throws ServerNotFoundError, ConnectionError, or Error when the password cannot be decrypted
 */
export async function connectServer(serverId: string): Promise<ServerConnection> {
  const server = await getServerRow(serverId);
  if (!server) {
    throw new ServerNotFoundError(serverId);
  }
  const creds = serverCredentials(server);
  return { conn: await openConnection(creds), server, password: creds.password };
}

/**
 * Run `fn` with a saved server's cached IBM i connection. An unknown server is 404; a
 * failed call is mapped by `connectionErrorResponse`.
 *
 * @param serverId - The server's id
 * @param fn - Gets the connection and the server, returns the response
 */
export async function withConnection(
  serverId: string,
  fn: (conn: Connection, server: ServerRow) => Promise<Response>,
): Promise<Response> {
  const server = await getServerRow(serverId);
  if (!server) {
    return errorResponse(404, 'Server not found.');
  }
  let creds: Credentials;
  try {
    creds = serverCredentials(server);
  } catch (error) {
    return errorResponse(500, redact(error));
  }
  try {
    const conn = await openConnection(creds);
    return await fn(conn, server);
  } catch (error) {
    return connectionErrorResponse(error, [creds.password]);
  }
}

/** Close the cached connection for these credentials, if there is one. */
export async function closeConnection(creds: Credentials): Promise<void> {
  const { closeConnection: close, connectionKey } = await jt400();
  await close(connectionKey(creds));
}
