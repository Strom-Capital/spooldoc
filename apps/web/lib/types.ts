// Shapes the API returns, shared by the server routes and the pages.

import type { SpooledFileAttributes, SpooledFileId } from '@spooldoc/core';
import type { AiProviderId, Effort } from './ai-providers';
import type { EmailConfig, HostKeyInfo, IfExists, IfsConfig, SftpConfigView, WebhookConfigView } from './destination-config';
import type { Formats } from './formats';
import type { Format, JobSpec } from './job-spec';
import type { MailSenderKind, SmtpSecurity } from './mail-config';

/**
 * Why a server cannot be used: `host` it cannot be reached (Spooldoc tries again by
 * itself), `auth` the sign-on failed (Spooldoc does not sign on again until the user acts).
 */
export type ServerErrorCode = 'host' | 'auth';

/** A saved IBM i server. Never carries the password. */
export interface ServerView {
  id: string;
  name: string;
  host: string;
  user: string;
  libraries: string[];
  /** The data queue Spooldoc reads; `owned` when Spooldoc created it. */
  dataQueue: { library: string; name: string; owned: boolean } | null;
  ccsid: number | null;
  vrm: string | null;
  /** When Spooldoc last reached the server or failed to; recorded at most once a minute while it works. */
  lastCheckedAt: string | null;
  /** Why the last attempt to reach the server failed, until one works again. */
  lastError: string | null;
  /** The class of `lastError`. */
  errorCode: ServerErrorCode | null;
  /** When the attempts first failed since the last one that worked. */
  errorSince: string | null;
  createdAt: string;
  /** Jobs that read from a queue of this server, in name order. Only the server list has them. */
  jobs?: QueueView['jobs'];
}

/** An output queue of a server. */
export interface QueueView {
  library: string;
  name: string;
  files: number;
  text: string;
  hidden: boolean;
  /** The data queue the output queue sends entries to, when it has one. */
  dataQueue: { library: string; name: string } | null;
  /** Jobs that read from this queue (the source of the active version, else the draft), in name order. */
  jobs: Pick<JobSummary, 'id' | 'name' | 'mode' | 'paused' | 'activeVersion'>[];
}

/** The files a job can pick up from an output queue: ready ones, and held ones when it takes them. */
export interface QueueCountView {
  library: string;
  name: string;
  ready: number;
  held: number;
}

/** Spooled files a queue listing shows at first and per Load more, and the most one listing shows. */
export const SPOOLED_FILE_LIST = { page: 200, max: 5000 } as const;

/** A spooled file in a queue listing. */
export interface SpooledFileView extends SpooledFileId {
  status: string;
  attributes: SpooledFileAttributes;
  /** The run of this job that already processed the file, when listed for a job. */
  processedBy?: { runId: string | null; seq: number | null } | null;
}

/** A destination. */
export type DestinationView = {
  id: string;
  name: string;
  builtin: boolean;
  /** The jobs whose draft or any version delivers here. */
  jobs: QueueView['jobs'];
} & ({ kind: 'spooldoc'; config: Record<string, never> } | { kind: 'ifs'; config: IfsConfig } | { kind: 'email'; config: EmailConfig } | { kind: 'webhook'; config: WebhookConfigView } | { kind: 'sftp'; config: SftpConfigView });

/** An uploaded image or font, without its bytes. */
export interface AssetView {
  id: string;
  name: string;
  kind: 'image' | 'font';
  contentType: string;
  size: number;
  updatedAt: string;
  /** Jobs whose draft or active version prints it with `{asset('name')}`. */
  jobs: { id: string; name: string }[];
}

/** A Word or Excel template file, uploaded or made by the agent, without its bytes. */
export interface TemplateFileView {
  id: string;
  /** The file's name. */
  name: string;
  size: number;
  createdAt: string;
  /** `assistant` for a file the agent wrote or edited. */
  madeBy: 'upload' | 'assistant';
  /** The file the template used before the agent made this one; null for an upload or the starter template. */
  previousId: string | null;
}

/** A Word or Excel template file with the file it replaced, when that is still kept. */
export interface TemplateFileDetails extends TemplateFileView {
  previous: TemplateFileView | null;
}

export type RunStatus ='running' | 'success' | 'warning' | 'failed' | 'skipped';

/** A row of the jobs list. */
export interface JobSummary {
  id: string;
  name: string;
  source: { serverId: string | null; serverName: string | null; library: string; queue: string };
  mode: 'manual' | 'watch';
  /** What the active version (else the draft) does with a file after delivery. */
  finish: 'hold' | 'move' | 'delete' | 'none';
  paused: boolean;
  activeVersion: number | null;
  versions: number;
  lastWatchAt: string | null;
  lastWatchError: string | null;
  /** Why the job's active version or draft cannot be read, when it cannot. */
  broken: string | null;
  lastRun: { id: string; seq: number; status: RunStatus; startedAt: string } | null;
  updatedAt: string;
}

/** A job with its draft and version list, for the job builder. */
export interface JobDetail {
  id: string;
  name: string;
  description: string;
  draft: JobSpec;
  activeVersion: number | null;
  paused: boolean;
  lastWatchAt: string | null;
  lastWatchError: string | null;
  /** Why the source queue is polled although it sends to the server's data queue, and since when. */
  realtimeError: { error: string; since: string } | null;
  versions: { number: number; note: string; createdAt: string; createdBy: string | null }[];
  updatedAt: string;
}

/** One step of a run. */
export interface RunStepView {
  step: 'capture' | 'extract' | 'render' | 'deliver' | 'finish';
  ok: boolean;
  ms: number;
  error?: string;
  /** The system's own text behind `error`, such as Carbone's message. */
  detail?: string;
  note?: string;
}

/** A row of the job log. */
export interface RunView {
  id: string;
  seq: number;
  jobId: string;
  jobName: string;
  version: number;
  trigger: 'manual' | 'watch';
  splf: SpooledFileId;
  status: RunStatus;
  /** How many page groups the definition found. */
  pageGroups: number;
  error: string | null;
  steps: RunStepView[];
  /** The delivered files, with the name of the job template each was rendered with. */
  files: { id: string; name: string; size: number; contentType: string; template: string }[];
  /** The deliveries the run made or tried, one per document; empty when its destination records none. */
  deliveries: DeliveryView[];
  /** The kind of the run's job version destination when that kind records deliveries, such as `email`. */
  deliveryKind: DeliveryKind | null;
  startedAt: string;
  finishedAt: string | null;
}

/** The destination kinds that record a delivery per document. */
export type DeliveryKind = 'email' | 'webhook' | 'sftp';

/** One delivery of a run, for one document, such as one email. */
export interface DeliveryView {
  id: string;
  kind: DeliveryKind;
  document: string;
  /** Where the delivery went. For an email, the addresses it was for, as the job's To gave them. */
  to: string;
  /** Sent to the destination's test address instead of `to`. */
  test: boolean;
  status: 'sent' | 'failed' | 'already_sent';
  /** The run that sent it, for `already_sent`. */
  sentInRun: number | null;
  error: string | null;
  detail: string | null;
  /** For a webhook call: the receiver's HTTP status, the tries made and how long the last one took. */
  httpStatus: number | null;
  attempts: number | null;
  ms: number | null;
  /** For a webhook call: the start of the receiver's answer, at most 2 KB. */
  response: string | null;
  /** The answer was longer than `response`. */
  responseTruncated: boolean;
  /** For an upload: the size of the file in bytes. */
  size: number | null;
  sentAt: string;
}

/** One chat model provider's saved settings. The key itself is never sent. */
export interface AiProviderView {
  model: string | null;
  effort: Effort;
  baseUrl: string | null;
  hasKey: boolean;
}

/** The chat model: the chosen provider (null when the chat is off), masking and every provider's settings. */
export interface AiSettingsView {
  provider: AiProviderId | null;
  /** Values are masked before page text and tool results go to the model. */
  mask: boolean;
  providers: Record<AiProviderId, AiProviderView>;
}

/** The last check of the Carbone connection. */
export interface CarboneCheck {
  ok: boolean;
  /** ISO time of the check. */
  at: string;
  version?: string;
  /** From the probe on-prem; `cloud` for Carbone Cloud, which is not probed. */
  edition?: 'enterprise' | 'community' | 'cloud';
  /** What went wrong and what to do. */
  error?: string;
  /** Carbone's own text, for support. */
  detail?: string;
}

/** Where documents are rendered. Never carries the Cloud key or the private key. */
export interface RenderingView {
  mode: 'onprem' | 'cloud';
  /** The on-prem server's URL (the default when none is saved). */
  url: string;
  /** A Carbone Cloud key is saved. */
  hasApiKey: boolean;
  /** Spooldoc's public key, as CARBONE_AUTHENTICATION_PUBLIC_KEY needs it: one line, newlines written as \n. */
  publicKey: string;
  check: CarboneCheck | null;
}

/** The agent's tokens over some model steps, and their cost when every step's provider reported one. */
export interface UsageTotals {
  /** Model steps counted: each tool call and answer is one. */
  steps: number;
  inputTokens: number;
  outputTokens: number;
  /** Input tokens read from the provider's cache, part of `inputTokens`. */
  cachedInputTokens: number;
  /** Output tokens the model spent reasoning, part of `outputTokens`. */
  reasoningTokens: number;
  /** In US dollars. Null unless every step reported a cost: an unknown cost is not 0. */
  costUsd: number | null;
  /** Some steps reported a cost and some did not, so no total is shown. */
  costPartial: boolean;
}

/** The agent's usage of one provider and model in a month. */
export interface UsageLine extends UsageTotals {
  /** An `AiProviderId`, or the id of a provider Spooldoc no longer offers. */
  provider: string;
  model: string;
}

/** The agent's usage in a calendar month of the viewer's time zone. */
export interface UsageMonth {
  /** `YYYY-MM`. */
  month: string;
  lines: UsageLine[];
}

/** The agent's usage this month and last month, for Settings. */
export interface AgentUsageView {
  thisMonth: UsageMonth;
  lastMonth: UsageMonth;
}

/** App-wide watcher settings. */
export interface SettingsView {
  pollSeconds: number;
  safetyCheckSeconds: number;
  retentionDays: number;
  watching: { realtime: number; polled: number };
  /** The last cleanup of old runs by this server process, if it did one. */
  cleanup: { at: string; runs: number; samples: number; templateFiles: number; agentUsage: number; alerts: number; error?: string } | null;
  ai: AiSettingsView;
  rendering: RenderingView;
  mail: MailView;
  /** Where alerts go when a run fails or watching stops. */
  alerts: AlertsView;
  /** How numbers, amounts and dates print in documents and email fields. */
  formats: Formats;
}

/** How email destinations send, as Settings shows it. Never carries the password or the client secret. */
export interface MailView {
  /** Through the SMTP server, or through Microsoft 365. */
  sender: MailSenderKind;
  host: string;
  port: number;
  security: SmtpSecurity;
  user: string;
  hasPassword: boolean;
  /** The Microsoft 365 directory (tenant) ID and application (client) ID. */
  tenantId: string;
  clientId: string;
  hasClientSecret: boolean;
  /** The From address; with Microsoft 365, the mailbox it sends from. */
  from: string;
  fromName: string;
  /** The picked sender has what it needs (a host, or a tenant, client ID and secret) and a From address, so email can be sent. */
  configured: boolean;
}

/** Where alerts go, and how the last try to send one went, as Settings shows it. */
export interface AlertsView {
  /** The addresses, comma separated. Empty means alerts are off. */
  to: string;
  /** When the last alert email was sent. */
  sentAt: string | null;
  /** Why the last alert email could not be sent, with the mail server's own text, and when the next try is. */
  error: { message: string; detail: string | null; at: string; nextTryAt: string } | null;
}

/** A value an email field reads, and whether it has one: as the extraction report colors fields. */
export type EmailValueState = 'found' | 'empty' | 'missing';

/** A piece of an email field after its tags are filled in: plain text, or a tag with its value. */
export interface EmailSegment {
  text: string;
  /** The tag, such as `{d.pg.email}`, when this piece is one. */
  tag?: string;
  state?: EmailValueState;
}

/** The email of one document of the preview spooled file, as the job's destination step shows it. Nothing is sent. */
export interface EmailPreviewView {
  /** The page group shown, 0-based, or null for the email of the whole spooled file; and how many page groups there are. */
  pageGroup: number | null;
  pageGroups: number;
  /** Whether the run sends an email per page group, and one of the whole spooled file. */
  pageGroupEmails: boolean;
  spooledFileEmail: boolean;
  /** The document's file name without extension. */
  document: string;
  /** The From of every email, from Settings; null when no mail server is set. */
  from: { address: string; name: string | null } | null;
  to: EmailSegment[];
  cc: EmailSegment[];
  bcc: EmailSegment[];
  replyTo: EmailSegment[];
  subject: EmailSegment[];
  /** The message as HTML, as it will be sent. */
  html: string;
  /** The files that go with it, by name and format. */
  attachments: { name: string; format: Format }[];
  /** Why the message template could not be shown, such as Carbone not being connected. */
  bodyError: string | null;
  /** The destination's test address, while it is set. */
  testAddress: string | null;
  /** Why this email would not be sent, such as an empty address. */
  problems: string[];
  /** What to know about this email that is not a problem, such as page groups getting no email. */
  notices: string[];
  /** Tags of any field that are not fields of the definition, with a hint. */
  unknownTags: string[];
  /** The fields an email can read, such as `pg.invoiceNo`, with their value in this page group, for Insert field. */
  fields: { path: string; value: string }[];
}

/** The webhook call of one document of the preview spooled file, as Send test would make it. Nothing is sent. */
export interface WebhookPreviewView {
  /** The page group shown, 0-based, and how many there are. */
  pageGroup: number;
  pageGroups: number;
  document: string;
  method: 'POST';
  /** The URL the call goes to: the test URL while one is set. */
  url: string;
  /** The destination has a test URL, so calls go there without the custom headers. */
  testMode: boolean;
  /** The headers in order; custom header values are masked. */
  headers: { name: string; value: string }[];
  /** The body as pretty JSON, each file's base64 replaced by its size. */
  body: string;
  /** The size of the body as it is sent, with the files in base64. */
  bodyBytes: number;
}

/** What the receiver answered a Send test. `error` is set when the call failed. */
export interface WebhookTestView {
  /** Null when the receiver never answered. */
  status: number | null;
  statusText: string;
  ms: number;
  /** The start of the answer, at most 2 KB. */
  body: string;
  truncated: boolean;
  error?: string;
  detail?: string;
}

/** A key Spooldoc made for an SFTP destination: the public line to add to the server, and the private key sealed so only the server can open it. */
export interface SftpKeyView {
  publicKey: string;
  key: HostKeyInfo;
  /** The private key, encrypted with Spooldoc's secret key. The page hands it back on check and save. */
  sealed: string;
}

/** One line of Check connection. */
export interface SftpCheckStage {
  stage: 'reach' | 'hostKey' | 'signIn' | 'folder' | 'testFolder';
  /** `new` and `changed` are a host key Spooldoc does not trust; the check stops there. */
  status: 'ok' | 'failed' | 'new' | 'changed';
  text: string;
  ms?: number;
  /** The server's own text, for a failed line. */
  detail?: string;
}

/** A host key the check saw, with the token that trusts it. */
export interface SftpSeenHostKey extends HostKeyInfo {
  /** Signed by Spooldoc for this host and port. Check with `trust` set to it, and save with it, to trust the key. */
  token: string;
}

/** What Check connection found, line by line. It writes nothing. */
export interface SftpCheckView {
  stages: SftpCheckStage[];
  /** A host key Spooldoc does not trust yet: new, or not the one it trusts. */
  hostKey?: SftpSeenHostKey & { state: 'new' | 'changed'; trustedFingerprint?: string };
  /** The host key the check verified, with the token to save it with. */
  trusted?: SftpSeenHostKey;
  /** The command that prints the key's fingerprint on the server, to compare by eye. */
  compare?: string;
}

/** What a run will do to one file of the page group in the folder. */
export type SftpOutcome =
  | { kind: 'new' }
  | { kind: 'replaces'; mtime: string | null }
  | { kind: 'becomes'; name: string }
  | { kind: 'fails' };

/** A file already in the folder on the server. */
export interface SftpEntryView {
  name: string;
  size: number;
  /** When it was last changed; null when the server does not say. */
  mtime: string | null;
  folder: boolean;
}

/** The folder of an SFTP destination, with one page group's files placed in it. */
export interface SftpFolderView {
  /** `MYUSER@sftp.example.com:/in/invoices`, the folder runs write to: the test folder in test mode. */
  target: string;
  folder: string;
  testMode: boolean;
  ifExists: IfExists;
  pageGroup: number;
  pageGroups: number;
  /** The page group's files, as a run names them, with what a run does to each. */
  files: { name: string; outcome: SftpOutcome; whole?: boolean }[];
  /** The files in the folder, sorted by name; at most `SFTP_LIST_LIMIT`. */
  entries: SftpEntryView[];
  /** The folder holds more entries than were read. */
  truncated: boolean;
  readAt: string;
}

/** What Upload test did with each file of the page group. */
export interface SftpUploadTestView {
  folder: string;
  ms: number;
  /** `whole` is a file of the whole spooled file, such as an Excel workbook of every page group. */
  files: { name: string; finalName: string; size: number; ms: number; error?: string; detail?: string; whole?: boolean }[];
}

/** An item of Needs attention on Home, to dismiss or bring back. */
export interface AttentionItem {
  kind: 'server' | 'job' | 'queue' | 'run';
  id: string;
}

/** The time range of the Home page's runs chart. */
export type DashboardRange = '24h' | '7d' | '30d' | '90d';

/** Runs of one hour or day by status. `at` is the bucket's local start, `YYYY-MM-DDTHH:00`. */
export interface RunBucket {
  at: string;
  success: number;
  warning: number;
  failed: number;
  skipped: number;
}

/** The Home page: setup progress, what is configured, and runs over the chosen range. */
export interface DashboardView {
  /** Which getting-started steps are done. */
  setup: { server: boolean; ai: boolean; job: boolean; run: boolean };
  servers: { total: number; failing: number };
  /** Output queues jobs read from: watched in real time (through a data queue) or by polling, and read only on demand. */
  outputQueues: { total: number; realtime: number; polled: number; unwatched: number };
  jobs: { total: number; watching: number; paused: number };
  /** Runs in the range by status, and every run still in the log. */
  runs: { success: number; warning: number; failed: number; skipped: number; logged: number };
  series: RunBucket[];
  attention: {
    /** Servers that cannot be used, with why, the class of error and since when. */
    servers: { id: string; name: string; error: string; errorCode: ServerErrorCode | null; since: string | null }[];
    jobs: { id: string; name: string; error: string }[];
    /** Queues that should be watched in real time but are polled, with why and since when. */
    queues: { id: string; serverId: string; serverName: string; library: string; name: string; error: string; since: string }[];
    /** Failed runs, and warning runs (delivered, but the finish step failed). */
    runs: { id: string; seq: number; jobId: string; jobName: string; status: 'failed' | 'warning'; error: string | null; startedAt: string }[];
  };
}
