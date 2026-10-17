import 'server-only';

import { getIronSession, type IronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';
import { getConfig } from './config';

/** The IBM i sign-on kept in the encrypted session cookie. */
export interface IbmiSession {
  host: string;
  user: string;
  password: string;
  /** Default library filter for the queue list. */
  library?: string;
  /** ISO timestamp of the sign-on. */
  connectedAt: string;
}

/** What the encrypted session cookie holds. */
export interface SessionData {
  ibmi?: IbmiSession;
}

export type AppSession = IronSession<SessionData>;

export const SESSION_COOKIE = 'spooldoc';

/** Twelve hours, in seconds. */
export const SESSION_TTL = 12 * 60 * 60;

/**
 * Session cookie options: encrypted with SESSION_SECRET, httpOnly so scripts cannot
 * read it, SameSite=Lax, and secure when APP_URL is https.
 */
export function sessionOptions(): SessionOptions {
  const config = getConfig();
  return {
    password: config.sessionSecret,
    cookieName: SESSION_COOKIE,
    ttl: SESSION_TTL,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.appUrl?.protocol === 'https:',
      path: '/',
    },
  };
}

/**
 * The current browser's session, read from its cookie.
 *
 * @returns The session; call `save()` after changing it
 */
export async function getSession(): Promise<AppSession> {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}
