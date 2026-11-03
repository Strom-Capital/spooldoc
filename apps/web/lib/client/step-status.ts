import type { ExtractResult } from '@spooldoc/core';
import { lookupUntested } from '@spooldoc/core/lookups';
import type { RenderResult } from '@/lib/client/render';
import { STEPS, type Step } from '@/lib/client/job-steps';
import { previewFor } from '@/lib/client/lookups';
import { perSpooledFile, type JobSpec } from '@/lib/job-spec';
import { isSimpleDestination, routeDestinationIds, routeProblems } from '@/lib/routes';
import type { DestinationView, JobDetail } from '@/lib/types';

/** How a step looks in the pipeline: not set yet, ready, worth a look, or a problem. */
export type StepStatus = 'unset' | 'ok' | 'warn' | 'error';

/** What the status of every step is worked out from. */
export interface StepStatusInput {
  spec: JobSpec;
  job: Pick<JobDetail, 'paused' | 'lastWatchError' | 'realtimeError'>;
  /** The last error of the source server, or null when it has none or is not known. */
  serverError: string | null;
  /** Whether the Destination step is set (`destinationReady`). */
  hasDestination: boolean;
  /** The latest workbench render, or null before there is one. */
  render: RenderResult | null;
  /** Whether Carbone is connected. */
  rendering: boolean;
  /** The page group shown. The lookups of a render of another page group do not count. */
  pageGroup?: number;
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
export function lookupsStatus(spec: Pick<JobSpec, 'lookups'>, render: RenderResult | null, pageGroup = render?.pageGroup ?? 0): StepStatus {
  if (spec.lookups.length === 0) return 'ok';
  if (spec.lookups.some(lookupUntested)) return 'error';
  const preview = previewFor(render, pageGroup);
  if (preview?.error || (preview?.problems.length ?? 0) > 0) return 'error';
  if ((preview?.misses.length ?? 0) > 0) return 'warn';
  return 'ok';
}

/** The status of each step, as the pipeline shows it. */
export function stepStatuses({ spec, job, serverError, hasDestination, render, rendering, pageGroup }: StepStatusInput): Record<Step, StepStatus> {
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
    lookups: lookupsStatus(spec, render, pageGroup),
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

/**
 * True when the Destination step is set: the routes have no problems (`routeProblems`),
 * and every destination of every route exists and has what it needs. An email destination
 * needs To; a webhook sends no files, or files a template makes; an SFTP destination needs
 * its host key trusted.
 */
export function destinationReady(spec: Pick<JobSpec, 'destination' | 'render'>, destinations: readonly DestinationView[]): boolean {
  const { routes } = spec.destination;
  const templates = spec.render.templates;
  if (routeProblems(routes, templates.some(perSpooledFile)).length > 0) return false;
  return routes.every((route) =>
    route.destinations.every((entry) => {
      const destination = destinations.find((d) => d.id === entry.destinationId);
      if (!destination) return false;
      if (destination.kind === 'email') return !!entry.email?.to.trim();
      if (destination.kind === 'webhook') {
        const attach = entry.webhook?.attach;
        return !attach || attach.length === 0 || templates.some((template) => template.formats.some((format) => attach.includes(format)));
      }
      if (destination.kind === 'sftp') return destination.config.hostKey !== null;
      return true;
    }),
  );
}

/**
 * The Destination step's line in the pipeline, from the destinations that still exist: the
 * name of a job's one destination, with "(test)" in test mode, or how many routes and
 * destinations, such as "3 routes, 4 destinations, 1 in test". "Pick a destination" when
 * none of them exists.
 */
export function destinationDetail(destination: JobSpec['destination'], destinations: readonly DestinationView[]): string {
  const { routes } = destination;
  const used = routeDestinationIds(routes).flatMap((id) => destinations.filter((d) => d.id === id));
  if (used.length === 0) return 'Pick a destination';
  // A destination in test mode says so, since its documents go to the test address, URL or folder.
  const inTest = used.filter(
    (d) => (d.kind === 'email' && !!d.config.testAddress) || (d.kind === 'webhook' && !!d.config.testUrl) || (d.kind === 'sftp' && !!d.config.testFolder),
  ).length;
  if (isSimpleDestination(destination)) return inTest > 0 ? `${used[0]!.name} (test)` : used[0]!.name;
  const n = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`;
  return `${n(routes.length, 'route')}, ${n(used.length, 'destination')}${inTest > 0 ? `, ${inTest} in test` : ''}`;
}
