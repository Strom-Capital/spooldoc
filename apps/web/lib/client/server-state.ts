import type { ShownError } from './api';
import type { ServerView } from '@/lib/types';

/** What the latest call to a server came to, as the page saw it: no error, or the error. */
export interface LatestCall {
  error: ShownError | null;
  /** ISO time of the answer. */
  at: string;
}

type StateFields = Pick<ServerView, 'lastError' | 'errorCode' | 'errorSince' | 'lastCheckedAt'>;

/**
 * A server as the page should show it after a call to it: the server records every call,
 * but the list on the page was loaded before. A host or sign-on error shows as the
 * server's state at once, and a call that worked shows it as connected. Any other error
 * is about one object, not the server, and changes nothing.
 *
 * @param server - The server as it was loaded
 * @param call - The latest call to it since then, if any
 */
export function withLatestCall<T extends StateFields>(server: T, call: LatestCall | null | undefined): T {
  if (!call) return server;
  if (!call.error) {
    return server.lastError ? { ...server, lastError: null, errorCode: null, errorSince: null, lastCheckedAt: call.at } : server;
  }
  const code = call.error.code;
  if (code !== 'host' && code !== 'auth') return server;
  if (server.lastError === call.error.message && server.errorCode === code) return server;
  return { ...server, lastError: call.error.message, errorCode: code, errorSince: (server.lastError && server.errorSince) || call.at, lastCheckedAt: call.at };
}
