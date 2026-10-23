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
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { AI_PROVIDER_IDS, EFFORT_IDS } from '../../ai-providers';
import type { JobSpec } from '../../job-spec';
import type { CarboneCheck } from '../../types';

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
  /** Why the last attempt to reach the server failed, until one works again. */
  lastError: text('last_error'),
  /** The class of `lastError`: `host` (cannot reach) or `auth` (sign-on failed, and paused). */
  errorCode: text('error_code'),
  /** When the attempts first failed since the last one that worked. */
  errorSince: timestamp('error_since', { withTimezone: true }),
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

/**
 * Why a watched queue that sends to the server's data queue is polled instead of watched
 * in real time, and since when. The watcher writes the row when real time stops working
 * and clears the error when it works again.
 */
export const queueHealth = pgTable(
  'queue_health',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serverId: uuid('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    library: text('library').notNull(),
    name: text('name').notNull(),
    realtimeError: text('realtime_error'),
    /** When real-time watching of the queue stopped working. */
    realtimeErrorSince: timestamp('realtime_error_since', { withTimezone: true }),
    /** The error dismissed on Home; it shows again when the error changes or clears and comes back. */
    errorDismissed: text('error_dismissed'),
    ...timestamps,
  },
  (t) => [uniqueIndex('queue_health_queue_idx').on(t.serverId, t.library, t.name)],
);

/** Where a job delivers its documents. */
export const destinations = pgTable(
  'destinations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    /**
     * Secrets of the destination, encrypted with `encryptSecret`, never sent to the page.
     * For a webhook: JSON `{ signingSecret, headers: { [name]: value } }`. For SFTP: JSON
     * `{ privateKey, passphrase, password }`.
     */
    secretsEnc: text('secrets_enc'),
    builtin: boolean('builtin').notNull().default(false),
    ...timestamps,
  },
  (t) => [check('destinations_kind_check', sql`${t.kind} in ('spooldoc', 'ifs', 'email', 'webhook', 'sftp')`)],
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
 * The agent's conversation for a job: the UI message list as the chat panel shows
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
  step: 'capture' | 'extract' | 'lookup' | 'render' | 'deliver' | 'finish';
  ok: boolean;
  ms: number;
  error?: string;
  /** The system's own text behind `error`, such as Carbone's message, kept for support. */
  detail?: string;
  note?: string;
  /** What went wrong without stopping the run, such as a lookup that found no row. */
  warnings?: string[];
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
    /** How many page groups the definition found in the spooled file. */
    pageGroups: integer('page_groups').notNull().default(0),
    error: text('error'),
    steps: jsonb('steps').$type<RunStep[]>().notNull().default([]),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    /** Touched while the run is running; a running run whose heartbeat stopped was cut off. */
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).notNull().defaultNow(),
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
export const runFiles = pgTable(
  'run_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    /** The page group the file is the document of; null for a file of the whole spooled file, from an Excel template. */
    pageGroupIndex: integer('page_group_index'),
    /** The name of the job template the file was rendered with. */
    template: text('template').notNull(),
    /** The template's place in the job version's templates, to list files in that order. */
    templateIndex: integer('template_index').notNull().default(0),
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    content: bytea('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('run_files_name_idx').on(t.runId, t.name)],
);

/**
 * One document a run delivered, or tried to deliver, to a destination that records each
 * delivery, such as one email. Retry reads the deliveries of the same job and spooled file,
 * so a document already delivered is not delivered again. Deleted with its run.
 */
export const runDeliveries = pgTable(
  'run_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    /** The spooled file, as `splfKey` in `lib/job-spec` writes it. */
    splfKey: text('splf_key').notNull(),
    destinationId: uuid('destination_id').references(() => destinations.id, { onDelete: 'set null' }),
    /** The destination kind that delivered it, such as `email`. */
    kind: text('kind').notNull().default('email'),
    /** The page group of the document; null for the document of the whole spooled file. */
    pageGroupIndex: integer('page_group_index'),
    /** The document's file name without extension, such as `invoice-260101`. */
    document: text('document').notNull(),
    /**
     * The spooled file's creation time, as `YYYY-MM-DDTHH:MM:SS` or "" when the IBM i did not
     * give it. With the pages, it tells a spooled file apart from an earlier one that had the
     * same job number. Null on rows written before it was recorded.
     */
    splfCreated: text('splf_created'),
    /** The first and last page of the document's page group; null for the document of the whole spooled file. */
    firstPage: integer('first_page'),
    lastPage: integer('last_page'),
    /**
     * Where the delivery went. For an email, the addresses it was for, as the job's To field
     * gave them, comma separated.
     */
    to: text('to').notNull().default(''),
    /** Sent to the destination's test address instead of `to`. */
    test: boolean('test').notNull().default(false),
    /** `sent`, `failed`, or `already_sent` when an earlier run delivered it. */
    status: text('status').notNull(),
    /** The run that sent it, for `already_sent`. */
    sentInRun: bigint('sent_in_run', { mode: 'number' }),
    messageId: text('message_id'),
    error: text('error'),
    /** The mail server's own text behind `error`, or the receiver's answer for a webhook call. */
    detail: text('detail'),
    /** For a webhook call: the receiver's HTTP status, the tries made and how long the last took. For an upload, `ms` is how long it took. */
    httpStatus: integer('http_status'),
    attempts: integer('attempts'),
    ms: integer('ms'),
    /** For a webhook call: the start of the receiver's answer, at most 2 KB and one more character to tell it was cut. */
    response: text('response'),
    /** For an upload: the size of the file in bytes. */
    size: integer('size'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('run_deliveries_document_idx').on(t.jobId, t.splfKey, t.document),
    index('run_deliveries_run_idx').on(t.runId),
    check('run_deliveries_status_check', sql`${t.status} in ('sent', 'failed', 'already_sent')`),
  ],
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
    /** Mask values (digits to 9, letters to X or x) before page text and tool results go to the model. */
    aiMask: boolean('ai_mask').notNull().default(false),
    /** Where documents are rendered: a Carbone server of the user's own (`onprem`) or Carbone Cloud. */
    carboneMode: text('carbone_mode').notNull().default('onprem'),
    /** The on-prem Carbone server. Null is the Compose service, http://carbone:4000. */
    carboneUrl: text('carbone_url'),
    /** The Carbone Cloud API key, encrypted with SPOOLDOC_SECRET_KEY. */
    carboneApiKeyEnc: text('carbone_api_key_enc'),
    /** Spooldoc's ES512 private key for Carbone tokens, encrypted. Made on first use. */
    carboneKeyEnc: text('carbone_key_enc'),
    /** The public key Carbone checks the tokens with, as PEM. */
    carbonePublicKey: text('carbone_public_key'),
    /** The last connection check: version, edition, or what went wrong. */
    carboneCheck: jsonb('carbone_check').$type<CarboneCheck>(),
    /** How email destinations send: through the SMTP server (`smtp`) or Microsoft 365 through Microsoft Graph (`m365`). */
    mailSender: text('mail_sender').notNull().default('smtp'),
    /** The SMTP server email destinations send through. Null host: no mail server set. */
    smtpHost: text('smtp_host'),
    smtpPort: integer('smtp_port'),
    /** `tls` (implicit TLS, usually port 465), `starttls` (usually 587) or `none`. */
    smtpSecurity: text('smtp_security').notNull().default('starttls'),
    smtpUser: text('smtp_user'),
    /** The SMTP password, encrypted with SPOOLDOC_SECRET_KEY. */
    smtpPasswordEnc: text('smtp_password_enc'),
    /** The Microsoft Entra ID tenant (a GUID or a domain) and the application (client) ID Spooldoc signs in to Microsoft 365 with. */
    m365TenantId: text('m365_tenant_id'),
    m365ClientId: text('m365_client_id'),
    /** The application's client secret, encrypted with SPOOLDOC_SECRET_KEY. */
    m365SecretEnc: text('m365_secret_enc'),
    /** The From address and name of every email. With Microsoft 365, the address is the mailbox it sends from. */
    mailFrom: text('mail_from'),
    mailFromName: text('mail_from_name'),
    /** The Carbone `lang` of numbers, amounts and month names, such as `en-us`. */
    numberFormat: text('number_format').notNull().default('en-us'),
    /** The pattern of a date in an email field without `formatD`, such as `YYYY-MM-DD`. */
    dateFormat: text('date_format').notNull().default('YYYY-MM-DD'),
    /** The ISO 4217 code `formatC` prints; null is the number format's own, as Carbone does without one. */
    currency: text('currency'),
    /** Where alerts go: email addresses separated by commas. Null turns alerts off. */
    alertTo: text('alert_to'),
    /** When alerts were turned on: only runs that finish after it alert. */
    alertsSince: timestamp('alerts_since', { withTimezone: true }),
    /** When the last alert email was sent. */
    alertSentAt: timestamp('alert_sent_at', { withTimezone: true }),
    /** Why the last alert email could not be sent, and when; cleared when one is sent. */
    alertError: text('alert_error'),
    /** The mail server's own text behind `alertError`. */
    alertErrorDetail: text('alert_error_detail'),
    alertErrorAt: timestamp('alert_error_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check('settings_single_row', sql`${t.id} = 1`),
    check('settings_carbone_mode_check', sql`${t.carboneMode} in ('onprem', 'cloud')`),
    check('settings_smtp_security_check', sql`${t.smtpSecurity} in ('tls', 'starttls', 'none')`),
    check('settings_mail_sender_check', sql`${t.mailSender} in ('smtp', 'm365')`),
    check('settings_smtp_port_check', sql`${t.smtpPort} between 1 and 65535`),
    check('settings_currency_check', sql`${t.currency} ~ '^[A-Z]{3}$'`),
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

/** An image or font that templates print with `{asset('name')}`, as a data URI. */
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

/**
 * A Word or Excel template file, uploaded or made by the agent. A row never changes (a
 * trigger refuses updates): uploading again, or a change by the agent, adds a row,
 * so a job version keeps the exact file it ran with. Templates point at it with
 * `{ kind: 'docx', fileId }` or `{ kind: 'xlsx', fileId }`; a file no draft or version
 * points at is deleted after the retention, unless a file a draft uses names it as its
 * previous one.
 */
export const templateFiles = pgTable(
  'template_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The file's name, such as `invoice.docx` or `invoice-lines.xlsx`. */
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    content: bytea('content').notNull(),
    /** `upload`, or `assistant` for a file the agent wrote or edited. */
    madeBy: text('made_by', { enum: ['upload', 'assistant'] }).notNull().default('upload'),
    /** The file the template used before the agent made this one; null for an upload or the starter template. Not a foreign key: the cleanup may delete it. */
    previousId: uuid('previous_id'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('template_files_made_by_check', sql`${t.madeBy} in ('upload', 'assistant')`)],
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

/**
 * The tokens of one model step of the agent, and its cost when the provider reported
 * one. A token count is null when the provider did not report it, and the cost is null
 * when the provider reports none: only OpenRouter and the Vercel AI Gateway do. Kept
 * when the job or the user is deleted, and deleted with the retention, like runs.
 */
export const agentUsage = pgTable(
  'agent_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cachedInputTokens: integer('cached_input_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    /** US dollars, as the provider reported it. */
    costUsd: numeric('cost_usd', { precision: 18, scale: 10, mode: 'number' }),
  },
  (t) => [index('agent_usage_created_idx').on(t.createdAt), index('agent_usage_job_created_idx').on(t.jobId, t.createdAt)],
);

/** How an alert closed, for its note in the email. */
export type AlertResolution =
  | { kind: 'fixed' }
  | { kind: 'deleted' }
  /** A run alert closed by a run that succeeded. */
  | { kind: 'success'; seq: number; at: string };

/**
 * A problem that Needs attention lists, as alerts see it: opened when it shows up, closed
 * when it is gone. The alerts check (see alerts.ts) sends one email when it opens and one
 * when it closes. `key` is `run:<jobId>`, `server:<id>`, `job:<id>` or `queue:<id>`, and only
 * one row per key is open. Not a foreign key to what it is about: a deleted job closes its
 * alert, and the closing still says so. Closed rows are deleted after the retention.
 */
export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    kind: text('kind').notNull(),
    /** What the alert is about: the job (of a run or job alert), the server, or the queue_health row. */
    subjectId: uuid('subject_id').notNull(),
    /** What it is about, as the email names it: the job, the server, or `MYLIB/MYOUTQ on MYSERVER`. */
    title: text('title').notNull(),
    error: text('error'),
    /** The app page about it, such as `/jobs/<id>`. */
    path: text('path').notNull(),
    /** When the problem started: the first failed run, or when the error was first seen. */
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: jsonb('resolution').$type<AlertResolution>(),
    openSentAt: timestamp('open_sent_at', { withTimezone: true }),
    resolveSentAt: timestamp('resolve_sent_at', { withTimezone: true }),
    /** For a run alert: the latest failed or warning run. Not a foreign key, so the retention can delete it. */
    runId: uuid('run_id'),
    /** For a run alert: how many runs failed or ended with a warning since it opened. */
    runs: integer('runs').notNull().default(0),
  },
  (t) => [
    uniqueIndex('alerts_open_key_idx')
      .on(t.key)
      .where(sql`${t.resolvedAt} is null`),
    index('alerts_resolved_idx').on(t.resolvedAt),
    check('alerts_kind_check', sql`${t.kind} in ('run', 'server', 'job', 'queue')`),
  ],
);
