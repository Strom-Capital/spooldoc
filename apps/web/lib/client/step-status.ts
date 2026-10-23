import type { ExtractResult } from '@spooldoc/core';
import { lookupUntested } from '@spooldoc/core/lookups';
import type { RenderResult } from '@/lib/client/render';
import { STEPS, type Step } from '@/lib/client/job-steps';
import type { JobSpec } from '@/lib/job-spec';
import type { JobDetail } from '@/lib/types';

/** How a step looks in the pipeline: not set yet, ready, worth a look, or a problem. */
export type StepStatus = 'unset' | 'ok' | 'warn' | 'error';

/** What the status of every step is worked out from. */
export interface StepStatusInput {
  spec: JobSpec;
  job: Pick<JobDetail, 'paused' | 'lastWatchError' | 'realtimeError'>;
  /** The last error of the source server, or null when it has none or is not known. */
  serverError: string | null;
  /** Whether a destination with the spec's id exists. */
  hasDestination: boolean;
  /** The latest workbench render, or null before there is one. */
  render: RenderResult | null;
  /** Whether Carbone is connected. */
  rendering: boolean;
}

/** How many fields the extraction did not find, each name once. */
export function missingFields(extract: ExtractResult): number {
  return new Set(extract.hits.filter((h) => h.status === 'missing').map((h) => h.name)).size;
}

/**
 * The status of the Lookups step: ready with no lookups; a problem when one is untested or
 * changed since its test, has a problem, or failed in the last preview; worth a look when
 * one found no row in the page group shown.
 */
export function lookupsStatus(spec: Pick<JobSpec, 'lookups'>, render: RenderResult | null): StepStatus {
  if (spec.lookups.length === 0) return 'ok';
  if (spec.lookups.some(lookupUntested)) return 'error';
  const preview = render?.lookups;
  if (preview?.error || (preview?.problems.length ?? 0) > 0) return 'error';
  if ((preview?.misses.length ?? 0) > 0) return 'warn';
  return 'ok';
}

/** The status of each step, as the pipeline shows it. */
export function stepStatuses({ spec, job, serverError, hasDestination, render, rendering }: StepStatusInput): Record<Step, StepStatus> {
  const hasSource = !!spec.source.serverId && !!spec.source.library && !!spec.source.queue;
  const extract = render?.extract;
  const watching = spec.trigger.mode === 'watch';
  const finish = spec.finish;
  return {
    source: hasSource ? (serverError ? 'warn' : 'ok') : 'unset',
    trigger: watching && (job.lastWatchError || job.realtimeError || job.paused) ? 'warn' : 'ok',
    extract: !spec.extract.definition.trim()
      ? 'unset'
      : render?.definition?.error
        ? 'error'
        : !extract
          ? 'unset'
          : extract.pageGroups.length === 0 || missingFields(extract) > 0
            ? 'warn'
            : 'ok',
    lookups: lookupsStatus(spec, render),
    render: !rendering || render?.carbone ? 'warn' : render?.template?.error ? 'error' : render?.html || render?.pdf ? 'ok' : 'unset',
    destination: hasDestination ? 'ok' : 'unset',
    finish: finish.action === 'move' && !finish.queue ? 'unset' : 'ok',
  };
}

/** Whether every step is ready. */
export function allReady(statuses: Record<Step, StepStatus>): boolean {
  return STEPS.every((step) => statuses[step] === 'ok');
}

/** The look of a button that moves the job forward: primary for the one thing to do next. */
export type ForwardVariant = 'default' | 'outline';

/**
 * Next, and Save version where it takes Next's place: primary when this step is ready and
 * the pipeline is not, so the user moves on to what is left. Once every step is ready,
 * Run now is the primary button instead.
 */
export function nextVariant(current: StepStatus, ready: boolean): ForwardVariant {
  return current === 'ok' && !ready ? 'default' : 'outline';
}

/** Run now: primary once every step is ready. */
export function runVariant(ready: boolean): ForwardVariant {
  return ready ? 'default' : 'outline';
}
