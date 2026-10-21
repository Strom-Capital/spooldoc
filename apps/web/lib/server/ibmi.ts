import 'server-only';

import { ConnectionError, noAnswerError, withDeadline, type Connection, type ConnectionErrorCode, type Credentials, type SystemInfo } from '@spooldoc/ibmi';
import { errorResponse, json, redact } from './http';
import { getServerRow, recordServerState, serverCredentials, signOnPaused, signOnPausedMessage, type ServerOutcome, type ServerRow } from './servers';

type Jt400Module = typeof import('@spooldoc/ibmi/jt400');

// A failed IBM i sign-on is 422, so the browser does not take it for the app login (401).
const STATUS: Record<ConnectionErrorCode, number> = {
  auth: 422,
  host: 502,
  notfound: 404,
  authority: 403,
  exists: 409,
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
 * 422 sign-on, 502 host, 404 not found, 403 authority, 409 exists, 500 anything else. The body is
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
 * What a failed attempt to reach a server came to, for `recordServerState`: the error
 * class and the message without the password. Anything but a `ConnectionError` is `other`.
 */
export function failedOutcome(error: unknown, secrets: readonly string[]): ServerOutcome {
  return { ok: false, code: isConnectionError(error) ? error.code : 'other', message: redact(error, secrets) };
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
 * Sign on from scratch: close any cached connection for these credentials, open a new
 * one and read the system info, within `SIGN_ON_TIMEOUT_MS`. A connection that died
 * cannot pass for a working one. When the system does not answer in time the new
 * connection is dropped, so the next attempt starts over, and a host error says so.
 *
 * @param creds - Host, user and password
 * @returns The system info; throws ConnectionError when the sign-on fails or times out
 */
export async function signOn(creds: Credentials): Promise<SystemInfo> {
  const { reconnect, closeConnection, connectionKey } = await jt400();
  return withDeadline(reconnect(creds), SIGN_ON_TIMEOUT_MS, () => {
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

/**
 * Thrown instead of signing on to a server whose last sign-on failed (see
 * `signOnPaused`). A sign-on error, so it maps to 422 like the failure it stands for.
 */
export class SignOnPausedError extends ConnectionError {
  readonly paused = true;
  constructor(server: Pick<ServerRow, 'lastError'>) {
    super('auth', signOnPausedMessage(server));
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
 * Wraps a server's connection so every call records what it came to on the server (see
 * `recordServerState`): a call that works shows the server as connected, a host or
 * sign-on error shows why it is not.
 */
function recorded(conn: Connection, server: ServerRow, password: string): Connection {
  const note = async <T>(call: Promise<T>): Promise<T> => {
    let value: T;
    try {
      value = await call;
    } catch (error) {
      await recordServerState(server, failedOutcome(error, [password]));
      throw error;
    }
    await recordServerState(server, { ok: true });
    return value;
  };
  return {
    describe: () => note(conn.describe()),
    listOutputQueues: (filter) => note(conn.listOutputQueues(filter)),
    listSpooledFiles: (queue, filter) => note(conn.listSpooledFiles(queue, filter)),
    countSpooledFiles: (filter) => note(conn.countSpooledFiles(filter)),
    readSpooledFile: (id) => note(conn.readSpooledFile(id)),
    holdSpooledFile: (id) => note(conn.holdSpooledFile(id)),
    moveSpooledFile: (id, queue) => note(conn.moveSpooledFile(id, queue)),
    deleteSpooledFile: (id) => note(conn.deleteSpooledFile(id)),
    readDataQueue: (dtaq, wait) => note(conn.readDataQueue(dtaq, wait)),
    runCommand: (command) => note(conn.runCommand(command)),
    ifsStat: (path) => note(conn.ifsStat(path)),
    writeIfsFile: (path, bytes, options) => note(conn.writeIfsFile(path, bytes, options)),
    close: () => conn.close(),
  };
}

/**
 * Open (or reuse) the cached connection of a saved server. A server whose last sign-on
 * failed is not signed on to (see `signOnPaused`). What the opening and every later call
 * come to is recorded on the server.
 *
 * @param serverId - The server's id
 * @throws ServerNotFoundError, SignOnPausedError, ConnectionError, or Error when the password cannot be decrypted
 */
export async function connectServer(serverId: string): Promise<ServerConnection> {
  const server = await getServerRow(serverId);
  if (!server) {
    throw new ServerNotFoundError(serverId);
  }
  if (signOnPaused(server)) {
    throw new SignOnPausedError(server);
  }
  const creds = serverCredentials(server);
  let conn: Connection;
  try {
    conn = await openConnection(creds);
  } catch (error) {
    await recordServerState(server, failedOutcome(error, [creds.password]));
    throw error;
  }
  return { conn: recorded(conn, server, creds.password), server, password: creds.password };
}

/**
 * Run `fn` with a saved server's cached IBM i connection. An unknown server is 404; a
 * server whose last sign-on failed is 422 without signing on (see `signOnPaused`); a
 * failed call is mapped by `connectionErrorResponse`. What the opening and every call
 * come to is recorded on the server.
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
  if (signOnPaused(server)) {
    return connectionErrorResponse(new SignOnPausedError(server), []);
  }
  let creds: Credentials;
  try {
    creds = serverCredentials(server);
  } catch (error) {
    return errorResponse(500, redact(error));
  }
  let conn: Connection;
  try {
    conn = await openConnection(creds);
  } catch (error) {
    await recordServerState(server, failedOutcome(error, [creds.password]));
    return connectionErrorResponse(error, [creds.password]);
  }
  try {
    return await fn(recorded(conn, server, creds.password), server);
  } catch (error) {
    return connectionErrorResponse(error, [creds.password]);
  }
}

/** Close the cached connection for these credentials, if there is one. */
export async function closeConnection(creds: Credentials): Promise<void> {
  const { closeConnection: close, connectionKey } = await jt400();
  await close(connectionKey(creds));
}
