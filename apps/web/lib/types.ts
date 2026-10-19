// Shapes the API returns, shared by the server routes and the pages.

import type { SpooledFileAttributes, SpooledFileId } from '@spooldoc/core';
import type { AiProviderId, Effort } from './ai-providers';
import type { JobSpec } from './job-spec';

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
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  hiddenQueues?: number;
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
}

/** A spooled file in a queue listing. */
export interface SpooledFileView extends SpooledFileId {
  status: string;
  attributes: SpooledFileAttributes;
  /** The run of this job that already processed the file, when listed for a job. */
  processedBy?: { runId: string | null; seq: number | null } | null;
}

/** A destination. */
export interface DestinationView {
  id: string;
  kind: 'spooldoc';
  name: string;
  builtin: boolean;
  jobs: { id: string; name: string }[];
}

/** An uploaded image or font, without its bytes. */
export interface AssetView {
  id: string;
  name: string;
  kind: 'image' | 'font';
  contentType: string;
  size: number;
  updatedAt: string;
  /** Jobs whose draft or active version prints it with `asset('name')`. */
  jobs: { id: string; name: string }[];
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
  documents: number;
  error: string | null;
  steps: RunStepView[];
  outputs: { id: string; name: string; size: number; contentType: string }[];
  startedAt: string;
  finishedAt: string | null;
}

/** One chat model provider's saved settings. The key itself is never sent. */
export interface AiProviderView {
  model: string | null;
  effort: Effort;
  baseUrl: string | null;
  hasKey: boolean;
}

/** The chat model: the chosen provider (null when the chat is off) and every provider's settings. */
export interface AiSettingsView {
  provider: AiProviderId | null;
  providers: Record<AiProviderId, AiProviderView>;
}

/** App-wide watcher settings. */
export interface SettingsView {
  pollSeconds: number;
  safetyCheckSeconds: number;
  retentionDays: number;
  watching: { realtime: number; polled: number };
  /** The last cleanup of old runs by this server process, if it did one. */
  cleanup: { at: string; runs: number; samples: number; error?: string } | null;
  ai: AiSettingsView;
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
    servers: { id: string; name: string; error: string }[];
    jobs: { id: string; name: string; error: string }[];
    /** Queues that should be watched in real time but are polled, with why and since when. */
    queues: { id: string; serverId: string; serverName: string; library: string; name: string; error: string; since: string }[];
    /** Failed runs, and warning runs (delivered, but the finish step failed). */
    runs: { id: string; seq: number; jobId: string; jobName: string; status: 'failed' | 'warning'; error: string | null; startedAt: string }[];
  };
}
