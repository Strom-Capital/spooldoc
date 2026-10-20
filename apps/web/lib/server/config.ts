import 'server-only';

import { z } from 'zod';
import { LOG_LEVELS, type LogLevel } from './log';

/** Settings read from the environment. See .env.example. */
export interface AppConfig {
  /** Postgres connection string. Required by the app; tests use PGlite instead. */
  databaseUrl?: string;
  /** Signs the login session (Better Auth). */
  authSecret: string;
  /** Origin users reach this app at, when set. Origin checks also accept the request's own host. */
  appUrl?: URL;
  /** 32-byte key that encrypts the IBM i passwords of saved servers and the model keys. */
  secretKey: Buffer;
  /** Run the queue watcher in this process. */
  watcher: boolean;
  /** Code page used when a spooled file has no CHRID and the job CCSID is not supported. */
  defaultCcsid?: number;
  /** Lower-cased hosts the connect form may use. Empty means any host. */
  allowedHosts: string[];
  /** How much the server logs to stdout. */
  logLevel: LogLevel;
}

const optional = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

const url = (name: string) =>
  optional.pipe(
    z
      .string()
      .refine((value) => {
        try {
          const parsed = new URL(value);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      }, `${name} must be an http or https URL`)
      .optional(),
  );

const flag = (name: string) =>
  optional.pipe(z.enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'], { error: `${name} must be true or false` }).optional());

const isTrue = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : ['true', '1', 'yes', 'on'].includes(value);

const envSchema = z.object({
  DATABASE_URL: optional,
  BETTER_AUTH_SECRET: z
    .string({ error: 'BETTER_AUTH_SECRET is not set. Generate one with: openssl rand -base64 32' })
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 32'),
  SPOOLDOC_SECRET_KEY: z
    .string({ error: 'SPOOLDOC_SECRET_KEY is not set. Generate one with: openssl rand -base64 32' })
    .refine((value) => Buffer.from(value, 'base64').length === 32, 'SPOOLDOC_SECRET_KEY must be 32 bytes in base64. Generate one with: openssl rand -base64 32'),
  APP_URL: url('APP_URL'),
  SPOOLDOC_WATCHER: flag('SPOOLDOC_WATCHER'),
  SPOOLDOC_DEFAULT_CCSID: optional.pipe(
    z.string().regex(/^\d+$/, 'SPOOLDOC_DEFAULT_CCSID must be a number such as 273 or 37').optional(),
  ),
  SPOOLDOC_ALLOWED_HOSTS: optional,
  SPOOLDOC_LOG_LEVEL: optional.pipe(
    z
      .string()
      .transform((value) => value.toLowerCase())
      .pipe(z.enum(LOG_LEVELS, { error: `SPOOLDOC_LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}` }))
      .optional(),
  ),
});

let cached: AppConfig | undefined;

/**
 * Read and check the app's settings once.
 *
 * @returns The settings
 * @throws Error with one line per problem when a setting is missing or invalid
 */
export function getConfig(): AppConfig {
  if (cached) {
    return cached;
  }
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  - ${issue.message}`);
    throw new Error(`Spooldoc settings are not valid (see apps/web/.env.example):\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  cached = {
    databaseUrl: env.DATABASE_URL,
    authSecret: env.BETTER_AUTH_SECRET,
    appUrl: env.APP_URL ? new URL(new URL(env.APP_URL).origin) : undefined,
    secretKey: Buffer.from(env.SPOOLDOC_SECRET_KEY, 'base64'),
    watcher: isTrue(env.SPOOLDOC_WATCHER, true),
    defaultCcsid: env.SPOOLDOC_DEFAULT_CCSID ? Number(env.SPOOLDOC_DEFAULT_CCSID) : undefined,
    allowedHosts: (env.SPOOLDOC_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    logLevel: env.SPOOLDOC_LOG_LEVEL ?? 'info',
  };
  return cached;
}

/** Settings Spooldoc no longer reads, with where they went, by name. */
const RETIRED: Record<string, string> = {
  SPOOLDOC_MASK: 'SPOOLDOC_MASK is no longer read. Masking is set in the app, under Settings, Agent.',
};

/** What to say about settings in the environment that Spooldoc no longer reads, one message each. */
export function retiredSettings(env: Record<string, string | undefined> = process.env): string[] {
  return Object.entries(RETIRED)
    .filter(([name]) => env[name] !== undefined)
    .map(([, message]) => message);
}

/** Forget the cached settings. For tests. */
export function resetConfig(): void {
  cached = undefined;
}
