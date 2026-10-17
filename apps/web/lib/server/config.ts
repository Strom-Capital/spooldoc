import 'server-only';

import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/** Settings read from the environment. See .env.example. */
export interface AppConfig {
  sessionSecret: string;
  /** Origin users reach this app at, when set. Origin checks also accept the request's own host. */
  appUrl?: URL;
  /** Absolute path of the workspace folder (samples, definitions, templates). */
  workspace: string;
  anthropicApiKey?: string;
  /** Anthropic model ID. */
  model: string;
  openaiCompatible?: { baseUrl: string; apiKey?: string; model?: string };
  /** Mask values before page text goes to a model. */
  mask: boolean;
  /** Code page used when a spooled file has no CHRID and the job CCSID is not supported. */
  defaultCcsid?: number;
  chromiumPath?: string;
  /** Lower-cased hosts the connect form may use. Empty means any host. */
  allowedHosts: string[];
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

const envSchema = z.object({
  SESSION_SECRET: z
    .string({ error: 'SESSION_SECRET is not set. Generate one with: openssl rand -base64 32' })
    .min(32, 'SESSION_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 32'),
  APP_URL: url('APP_URL'),
  SPOOLDOC_WORKSPACE: optional,
  ANTHROPIC_API_KEY: optional,
  SPOOLDOC_MODEL: optional,
  OPENAI_COMPATIBLE_BASE_URL: url('OPENAI_COMPATIBLE_BASE_URL'),
  OPENAI_COMPATIBLE_API_KEY: optional,
  OPENAI_COMPATIBLE_MODEL: optional,
  SPOOLDOC_MASK: optional.pipe(
    z
      .enum(['true', 'false', '1', '0', 'yes', 'no'], { error: 'SPOOLDOC_MASK must be true or false' })
      .optional(),
  ),
  SPOOLDOC_DEFAULT_CCSID: optional.pipe(
    z.string().regex(/^\d+$/, 'SPOOLDOC_DEFAULT_CCSID must be a number such as 273 or 37').optional(),
  ),
  SPOOLDOC_CHROMIUM_PATH: optional,
  SPOOLDOC_ALLOWED_HOSTS: optional,
});

/** Default Anthropic model when SPOOLDOC_MODEL is not set. */
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

let cached: AppConfig | undefined;

/**
 * The repository root: the nearest folder above the working directory that holds
 * pnpm-workspace.yaml, or the working directory when there is none.
 */
export function repoRoot(cwd = process.cwd()): string {
  // The ignore comments keep the bundler from tracing the whole project for these paths.
  let dir = path.resolve(/* turbopackIgnore: true */ cwd);
  for (;;) {
    if (existsSync(path.join(/* turbopackIgnore: true */ dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.resolve(/* turbopackIgnore: true */ cwd);
    }
    dir = parent;
  }
}

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
  const root = repoRoot();
  const workspace = env.SPOOLDOC_WORKSPACE
    ? path.resolve(/* turbopackIgnore: true */ root, env.SPOOLDOC_WORKSPACE)
    : path.join(/* turbopackIgnore: true */ root, 'workspace');
  cached = {
    sessionSecret: env.SESSION_SECRET,
    appUrl: env.APP_URL ? new URL(new URL(env.APP_URL).origin) : undefined,
    workspace,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    model: env.SPOOLDOC_MODEL ?? DEFAULT_MODEL,
    openaiCompatible: env.OPENAI_COMPATIBLE_BASE_URL
      ? {
          baseUrl: env.OPENAI_COMPATIBLE_BASE_URL.replace(/\/+$/, ''),
          apiKey: env.OPENAI_COMPATIBLE_API_KEY,
          model: env.OPENAI_COMPATIBLE_MODEL,
        }
      : undefined,
    mask: env.SPOOLDOC_MASK === undefined ? true : ['true', '1', 'yes'].includes(env.SPOOLDOC_MASK),
    defaultCcsid: env.SPOOLDOC_DEFAULT_CCSID ? Number(env.SPOOLDOC_DEFAULT_CCSID) : undefined,
    chromiumPath: env.SPOOLDOC_CHROMIUM_PATH,
    allowedHosts: (env.SPOOLDOC_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  };
  return cached;
}

/** Forget the cached settings. For tests. */
export function resetConfig(): void {
  cached = undefined;
}
