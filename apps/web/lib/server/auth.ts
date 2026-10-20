import 'server-only';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { count } from 'drizzle-orm';
import { headers } from 'next/headers';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/account';
import { getConfig } from './config';
import { getDb } from './db';
import * as schema from './db/schema';
import { checkFetchSite, checkOrigin, errorResponse } from './http';
import { log } from './log';

function createAuth() {
  const config = getConfig();
  return betterAuth({
    secret: config.authSecret,
    baseURL: config.appUrl?.origin,
    trustedOrigins: config.appUrl ? [config.appUrl.origin] : [],
    database: drizzleAdapter(getDb(), {
      provider: 'pg',
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: MIN_PASSWORD_LENGTH, maxPasswordLength: MAX_PASSWORD_LENGTH, autoSignIn: true },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    telemetry: { enabled: false },
    // Better Auth's warnings and errors go to the server log, as JSON lines like the rest.
    logger: {
      level: 'warn',
      log: (level, message, ...args) => log[level](`Auth: ${message}`, args.length ? { details: args.map((arg) => (arg instanceof Error ? arg.message : arg)) } : undefined),
    },
    hooks: {
      // Anyone may create the first account; after that sign-up is closed.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-up/email' && (await userCount()) > 0) {
          throw new APIError('FORBIDDEN', { message: 'Sign-up is closed: this Spooldoc has one account, created when it was set up. Sign in with that account.' });
        }
      }),
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
let cached: Auth | undefined;

/** The Better Auth instance. */
export function getAuth(): Auth {
  cached ??= createAuth();
  return cached;
}

/** Forget the instance, for tests that change the database or settings. */
export function resetAuth(): void {
  cached = undefined;
}

/** How many accounts exist. Zero means the login page offers to create the first one. */
export async function userCount(): Promise<number> {
  const [row] = await getDb().select({ n: count() }).from(schema.user);
  return row?.n ?? 0;
}

/** The signed-in user. */
export interface AppUser {
  id: string;
  email: string;
  name: string;
}

/**
 * The signed-in user of a request, or null.
 *
 * @param source - The request, or nothing in a server component (reads next/headers)
 */
export async function currentUser(source?: Request): Promise<AppUser | null> {
  const result = await getAuth()
    .api.getSession({ headers: source ? source.headers : await headers() })
    .catch(() => null);
  if (!result) {
    return null;
  }
  return { id: result.user.id, email: result.user.email, name: result.user.name };
}

/**
 * The signed-in user, or a 401 response for an API route.
 *
 * @param request - The incoming request
 */
export async function requireUser(request: Request): Promise<AppUser | Response> {
  return (await currentUser(request)) ?? errorResponse(401, 'Sign in first.');
}

/**
 * The checks every API route starts with: same-origin for writes, not cross-site for
 * reads, and a signed-in user.
 *
 * @param request - The incoming request
 * @returns The user, or the response to send instead
 */
export async function guard(request: Request): Promise<{ user: AppUser } | { response: Response }> {
  const refused = checkOrigin(request) ?? checkFetchSite(request);
  if (refused) {
    return { response: refused };
  }
  const user = await requireUser(request);
  return user instanceof Response ? { response: user } : { user };
}
