// The database schema. Also read by drizzle-kit, so this module must not import
// `server-only` or anything that needs the Next.js runtime.

import type { SamplePage, SpooledFileAttributes, SpooledFileId } from '@spooldoc/core';
import type { UIMessage } from 'ai';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { AI_PROVIDER_IDS, EFFORT_IDS } from '../../ai-providers';
import type { JobSpec } from '../../job-spec';

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (value) => (Buffer.isBuffer(value) ? value : Buffer.from(value)),
});

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// Better Auth tables (email and password sign-in).

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  ...timestamps,
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    ...timestamps,
  },
  (t) => [index('account_user_idx').on(t.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

// Spooldoc tables.

/** An IBM i system. The password is encrypted with SPOOLDOC_SECRET_KEY (see secrets.ts). */
export const servers = pgTable('servers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  host: text('host').notNull(),
  user: text('user').notNull(),
  passwordEnc: text('password_enc').notNull(),
  /** Libraries whose output queues are listed. Empty means every library. */
  libraries: text('libraries').array().notNull().default(sql`'{}'::text[]`),
  /** The data queue output queues send entries to for real-time watching. */
  dtaqLibrary: text('dtaq_library'),
  dtaqName: text('dtaq_name'),
  /** Spooldoc created the data queue (Set up real-time), rather than using one that was there. */
  dtaqOwned: boolean('dtaq_owned').notNull().default(false),
  ccsid: integer('ccsid'),
  vrm: text('vrm'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  lastError: text('last_error'),
  /** The error dismissed on Home; it shows again when the error changes or clears and comes back. */
  errorDismissed: text('error_dismissed'),
  ...timestamps,
});

/** Per-queue display settings. */
export const queuePrefs = pgTable(
  'queue_prefs',
  {
    serverId: uuid('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    library: text('library').notNull(),
    name: text('name').notNull(),
    hidden: boolean('hidden').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.serverId, t.library, t.name] })],
);

/** Where a job delivers its documents. */
export const destinations = pgTable(
  'destinations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    builtin: boolean('builtin').notNull().default(false),
    ...timestamps,
  },
  (t) => [check('destinations_kind_check', sql`${t.kind} in ('spooldoc')`)],
);

/** A pipeline from an output queue to a destination. `draft` is the spec being edited. */
export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  draft: jsonb('draft').$type<JobSpec>().notNull(),
  activeVersion: integer('active_version'),
  paused: boolean('paused').notNull().default(false),
  /** Spooled files created before this are left alone by the watcher. */
  watchSince: timestamp('watch_since', { withTimezone: true }),
  lastWatchAt: timestamp('last_watch_at', { withTimezone: true }),
  lastWatchError: text('last_watch_error'),
  /** The watch error dismissed on Home; it shows again when the error changes or clears and comes back. */
  watchErrorDismissed: text('watch_error_dismissed'),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  ...timestamps,
});

/**
 * The AI assistant's conversation for a job: the UI message list as the chat panel shows
 * it, tool calls and their (masked) results included. One thread per job; New chat
 * deletes the row, and the row goes with the job.
 */
export const jobChats = pgTable('job_chats', {
  jobId: uuid('job_id')
    .primaryKey()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  messages: jsonb('messages').$type<UIMessage[]>().notNull().default([]),
  ...timestamps,
});

/** A saved, unchangeable copy of a job's spec. A trigger refuses updates and deletes. */
export const jobVersions = pgTable(
  'job_versions',
  {
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    spec: jsonb('spec').$type<JobSpec>().notNull(),
    note: text('note').notNull().default(''),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.number] }), check('job_versions_number_check', sql`${t.number} > 0`)],
);

/** A captured spooled file: raw bytes and parsed pages. */
export const samples = pgTable(
  'samples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serverId: uuid('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    /** Set for a sample captured by a run; null for a preview sample. */
    runId: uuid('run_id'),
    system: text('system').notNull(),
    splf: jsonb('splf').$type<SpooledFileId>().notNull(),
    /** `name/number/jobNumber/jobUser/jobName`, for the unique preview index. */
    splfKey: text('splf_key').notNull(),
    attributes: jsonb('attributes').$type<SpooledFileAttributes>().notNull(),
    codePage: integer('code_page').notNull(),
    warnings: jsonb('warnings').$type<string[]>().notNull().default([]),
    raw: bytea('raw').notNull(),
    pages: jsonb('pages').$type<SamplePage[]>().notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('samples_preview_idx')
      .on(t.serverId, t.splfKey)
      .where(sql`${t.runId} is null`),
  ],
);

/** One step of a run, as stored in `runs.steps`. */
export interface RunStep {
  step: 'capture' | 'extract' | 'render' | 'deliver' | 'finish';
  ok: boolean;
  ms: number;
  error?: string;
  note?: string;
}

/** One processing of one spooled file by a job version. */
export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Increasing number shown in the log ("Run #12"). */
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    sampleId: uuid('sample_id').references(() => samples.id, { onDelete: 'set null' }),
    trigger: text('trigger').notNull(),
    splf: jsonb('splf').$type<SpooledFileId>().notNull(),
    status: text('status').notNull().default('running'),
    documents: integer('documents').notNull().default(0),
    error: text('error'),
    steps: jsonb('steps').$type<RunStep[]>().notNull().default([]),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** When a failed run was dismissed from Needs attention on Home. */
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (t) => [
    index('runs_job_started_idx').on(t.jobId, t.startedAt),
    index('runs_status_started_idx').on(t.status, t.startedAt),
    index('runs_finished_idx').on(t.finishedAt),
    check('runs_trigger_check', sql`${t.trigger} in ('manual', 'watch')`),
    check('runs_status_check', sql`${t.status} in ('running', 'success', 'warning', 'failed', 'skipped')`),
  ],
);

/** A file a run delivered to the Spooldoc destination. */
export const runOutputs = pgTable(
  'run_outputs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    documentIndex: integer('document_index').notNull(),
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    content: bytea('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('run_outputs_name_idx').on(t.runId, t.name)],
);

const providerList = sql.raw(AI_PROVIDER_IDS.map((id) => `'${id}'`).join(', '));

/** App-wide settings: a single row with id 1. */
export const settings = pgTable(
  'settings',
  {
    id: integer('id').primaryKey().default(1),
    pollSeconds: integer('poll_seconds').notNull().default(30),
    safetyCheckSeconds: integer('safety_check_seconds').notNull().default(300),
    /** Runs, their files and unused preview samples older than this are deleted. */
    retentionDays: integer('retention_days').notNull().default(90),
    /** The provider the chat uses. Null turns the chat off. */
    aiProvider: text('ai_provider'),
    ...timestamps,
  },
  (t) => [
    check('settings_single_row', sql`${t.id} = 1`),
    check('settings_ai_provider_check', sql`${t.aiProvider} in (${providerList})`),
    check('settings_poll_check', sql`${t.pollSeconds} between 5 and 3600`),
    check('settings_safety_check', sql`${t.safetyCheckSeconds} between 60 and 86400`),
    check('settings_retention_check', sql`${t.retentionDays} between 1 and 3650`),
  ],
);

/** Each chat model provider's key (encrypted with SPOOLDOC_SECRET_KEY, see secrets.ts), model and effort. */
export const aiProviders = pgTable(
  'ai_providers',
  {
    provider: text('provider').primaryKey(),
    apiKeyEnc: text('api_key_enc'),
    model: text('model'),
    effort: text('effort').notNull().default('provider-default'),
    /** The OpenAI-compatible endpoint of a local model. */
    baseUrl: text('base_url'),
    ...timestamps,
  },
  (t) => [
    check('ai_providers_provider_check', sql`${t.provider} in (${providerList})`),
    check('ai_providers_effort_check', sql`${t.effort} in (${sql.raw(EFFORT_IDS.map((id) => `'${id}'`).join(', '))})`),
  ],
);

/** An image or font that templates print with `asset('name')`, as a data URI. */
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    content: bytea('content').notNull(),
    ...timestamps,
  },
  (t) => [check('assets_name_check', sql`${t.name} ~ '^[a-z0-9][a-z0-9_-]{0,63}$'`)],
);

/** Spooled files a job has processed, so none is processed twice. */
export const watchSeen = pgTable(
  'watch_seen',
  {
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    splfKey: text('splf_key').notNull(),
    runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.splfKey] })],
);
