'use client';

import { AlertTriangleIcon, CopyIcon, RadioIcon, UsersIcon, ZapIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Hint } from '@/components/hint';
import { ErrorNote } from '@/components/page';
import { ServerErrorNote } from '@/components/server-status';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { api, errorText } from '@/lib/client/api';
import { ago } from '@/lib/client/format';
import { sameQueueJobs, type SameQueueJobs } from '@/lib/client/jobs';
import type { JobSummary, SettingsView } from '@/lib/types';
import { Choice, Panel, SettingRow } from './inspectors';
import { useJob } from './job-provider';
import { useQueues } from './queue-select';

/** Watcher settings, for the intervals in the texts. */
function useSettings(): SettingsView | null {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  useEffect(() => {
    api<SettingsView>('/api/settings').then(setSettings, () => undefined);
  }, []);
  return settings;
}

/** The other jobs that run files from the same queue, watching or on demand. */
function useSameQueueJobs(jobId: string, source: { serverId: string | null; library: string; queue: string }): SameQueueJobs {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  useEffect(() => {
    api<{ jobs: JobSummary[] }>('/api/jobs').then((data) => setJobs(data.jobs), () => undefined);
  }, []);
  return sameQueueJobs(jobs, jobId, source);
}

function seconds(value: number): string {
  return value % 60 === 0 ? `${value / 60} min` : `${value} s`;
}

const FINISH_TEXT: Record<JobSummary['finish'], string> = {
  hold: 'holds the files after delivery',
  move: 'moves the files after delivery',
  delete: 'deletes the files after delivery',
  none: 'leaves the files as they are',
};

/** The other jobs on the source queue, and what each does with a file. */
function SameQueueNotice({ label, others, watching }: { label: string; others: SameQueueJobs; watching: boolean }) {
  const list = [
    ...others.watching.map((other) => ({ job: other, how: 'watching' })),
    ...others.onDemand.map((other) => ({ job: other, how: 'on demand' })),
  ];
  if (list.length === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <UsersIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <div>
        <p>
          {label} is also the source of{' '}
          {list.map(({ job, how }, index) => (
            <span key={job.id}>
              {index > 0 && (index === list.length - 1 ? ' and ' : ', ')}
              <Link href={`/jobs/${job.id}`} className="font-medium text-primary hover:underline">
                {job.name}
              </Link>{' '}
              ({how}, it {FINISH_TEXT[job.finish]})
            </span>
          ))}
          .
        </p>
        <p className="mt-1 text-muted-foreground text-xs">
          A file that matches the filters of more than one job can be run by each, and each finish action applies to it.
          {!watching &&
            others.watching.length > 0 &&
            ' A watching job runs a file as soon as it is ready, so its finish action may apply before you pick the file in Run now.'}{' '}
          Use the filters on the Source step to keep them apart.
        </p>
      </div>
    </div>
  );
}

/** The result of a set-up or switch call: an error, and commands for an operator. */
interface Outcome {
  busy: boolean;
  error: string | null;
  commands: string[] | null;
}

const IDLE: Outcome = { busy: false, error: null, commands: null };

/** POST to a queue action and turn the answer into an Outcome; reloads the page when it worked. */
async function queueAction(url: string, body: unknown): Promise<Outcome> {
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; commands?: string[] };
    if (response.ok && result.ok === true) {
      // The server and queue lists change: start over with fresh ones.
      window.location.reload();
      return IDLE;
    }
    return { busy: false, error: result.error ?? `The change failed (HTTP ${response.status}).`, commands: result.commands ?? null };
  } catch (err) {
    return { busy: false, error: errorText(err), commands: null };
  }
}

/**
 * Trigger: on demand or watching; which files Run now lists or the watcher runs; how
 * the queue is watched (real-time or polling, with set-up and switching back); other
 * jobs on the same queue; and pause and resume.
 */
export function TriggerInspector() {
  const { spec, updateDraft, readOnly, job, updateJob, servers, reloadServers, activeSpec } = useJob();
  const settings = useSettings();
  const { serverId, library, queue } = spec.source;
  const { queues, error: queuesError, reload: reloadQueues } = useQueues(serverId);
  const others = useSameQueueJobs(job.id, spec.source);
  const server = servers.find((s) => s.id === serverId) ?? null;
  const info = queues?.find((q) => q.library === library && q.name === queue) ?? null;
  const [outcome, setOutcome] = useState<Outcome>(IDLE);
  const [confirmPolling, setConfirmPolling] = useState(false);
  const trigger = spec.trigger;
  const watching = trigger.mode === 'watch';
  const realtime = !!(info?.dataQueue && server?.dataQueue && info.dataQueue.library === server.dataQueue.library && info.dataQueue.name === server.dataQueue.name);
  const otherDtaq = !!info?.dataQueue && !realtime;
  const queueUrl = `/api/servers/${serverId}/queues/${encodeURIComponent(library)}/${encodeURIComponent(queue)}`;
  const setTrigger = (change: Partial<typeof trigger>) => updateDraft({ trigger: { ...trigger, ...change } }, { debounce: false });

  async function run(action: 'realtime' | 'polling', body: unknown = {}) {
    setOutcome({ ...IDLE, busy: true });
    setOutcome(await queueAction(`${queueUrl}/${action}`, body));
  }

  const statuses = trigger.includeHeld ? 'ready or held' : 'ready';
  const summary = trigger.backlog
    ? `Runs every ${statuses} file: the new ones, and those already waiting when watching starts.`
    : `Runs the new ${statuses} files. Files already waiting when watching starts are left for Run now.`;

  const statusChoice = (
    <div className="flex flex-col gap-2">
      <p className="text-sm">Status</p>
      <div role="radiogroup" aria-label="Status" className="grid gap-2 sm:grid-cols-2">
        <Choice selected={!trigger.includeHeld} disabled={readOnly} onSelect={() => setTrigger({ includeHeld: false })} title="Ready files">
          The usual case: files waiting to be printed.
        </Choice>
        <Choice selected={trigger.includeHeld} disabled={readOnly} onSelect={() => setTrigger({ includeHeld: true })} title="Ready and held files">
          For programs that print with HOLD(*YES).
          {watching && realtime && ' Held files are picked up by the safety check, as the data queue only reports ready ones.'}
        </Choice>
      </div>
    </div>
  );

  return (
    <Panel title="Trigger" description="When the job runs. You can always run it by hand with Run now.">
      <div role="radiogroup" aria-label="Trigger" className="grid gap-3 sm:grid-cols-2">
        <Choice selected={!watching} disabled={readOnly} onSelect={() => setTrigger({ mode: 'manual' })} title="On demand">
          Runs only when you pick spooled files and press Run now.
        </Choice>
        <Choice selected={watching} disabled={readOnly} onSelect={() => setTrigger({ mode: 'watch' })} title="Watching">
          Runs on every new spooled file that is {statuses} on the queue.
        </Choice>
      </div>

      {watching && activeSpec?.trigger.mode !== 'watch' && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-800 text-sm dark:text-amber-300">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          Watching starts when you save a version with Watching and make it active.
        </p>
      )}

      {library && <SameQueueNotice label={`${library}/${queue}`} others={others} watching={watching} />}

      {!watching && (
        <section aria-labelledby="run-now-files" className="flex flex-col gap-4 rounded-lg border p-4">
          <div>
            <h3 id="run-now-files" className="font-medium text-sm">
              Which files Run now lists
            </h3>
            <p className="mt-0.5 text-muted-foreground text-xs">
              Run now lists the {statuses} files this job has not processed. A switch there shows the rest.
            </p>
          </div>
          {statusChoice}
        </section>
      )}

      {watching && (
        <section aria-labelledby="watch-files" className="flex flex-col gap-4 rounded-lg border p-4">
          <div>
            <h3 id="watch-files" className="font-medium text-sm">
              Which files the watcher runs
            </h3>
            <p className="mt-0.5 text-muted-foreground text-xs">{summary}</p>
          </div>
          {statusChoice}
          <div className="flex flex-col gap-2">
            <p className="text-sm">Files already on the queue when watching starts or resumes</p>
            <div role="radiogroup" aria-label="Files already on the queue" className="grid gap-2 sm:grid-cols-2">
              <Choice selected={!trigger.backlog} disabled={readOnly} onSelect={() => setTrigger({ backlog: false })} title="Leave them for Run now">
                Only files that arrive later are run.
              </Choice>
              <Choice selected={trigger.backlog} disabled={readOnly} onSelect={() => setTrigger({ backlog: true })} title="Run them too">
                The {statuses} files already waiting are run as well.
              </Choice>
            </div>
          </div>
        </section>
      )}

      {watching && (
        <section aria-labelledby="watch-method" className="flex flex-col gap-4 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="watch-method" className="font-medium text-sm">
              How the queue is watched
            </h3>
            {!library ? null : queues === null && !queuesError ? (
              <Skeleton className="h-5 w-24 rounded-full" />
            ) : realtime ? (
              <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-emerald-950">
                <ZapIcon />
                Real-time
              </Badge>
            ) : info ? (
              <Badge variant="secondary" className="gap-1">
                <RadioIcon />
                Polling
              </Badge>
            ) : null}
          </div>
          {!library ? (
            <p className="text-muted-foreground text-sm">Pick the source queue first.</p>
          ) : queuesError ? (
            <ServerErrorNote
              error={queuesError}
              server={server}
              onRetry={() => {
                reloadServers();
                reloadQueues();
              }}
            />
          ) : queues === null ? (
            <div className="flex flex-col gap-2" aria-label="Checking the queue" aria-busy>
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          ) : !info ? (
            <p className="text-muted-foreground text-sm">
              Spooldoc cannot see {library}/{queue} right now. It may be hidden on the Queues page or gone from the IBM i.
            </p>
          ) : realtime ? (
            <>
              {job.realtimeError && (
                <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-800 text-sm dark:text-amber-300">
                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Real-time watching stopped {ago(job.realtimeError.since)}. Until it works again, Spooldoc checks the queue every{' '}
                    {settings ? seconds(settings.pollSeconds) : '30 s'} and keeps trying to reconnect.
                    <span className="mt-1 block text-xs">{job.realtimeError.error}</span>
                  </span>
                </p>
              )}
              <p className="text-sm">
                {library}/{queue} sends an entry to {server?.dataQueue?.library}/{server?.dataQueue?.name} when a spooled file is ready, and
                the job starts within seconds. As a safety net the queue is also checked every{' '}
                {settings ? seconds(settings.safetyCheckSeconds) : '5 min'}.
              </p>
              {!readOnly && (
                <div>
                  <Button variant="outline" size="sm" onClick={() => setConfirmPolling(true)} disabled={outcome.busy}>
                    {outcome.busy ? <Spinner /> : <RadioIcon />}
                    Switch to polling
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-sm">
                Spooldoc checks the queue for new files every {settings ? seconds(settings.pollSeconds) : '30 s'}. Change the interval in{' '}
                <Link href="/settings" className="text-primary hover:underline">
                  Settings
                </Link>
                .
              </p>
              {otherDtaq ? (
                <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
                  <div>
                    <p className="font-medium text-sm">This queue already has a data queue</p>
                    <p className="text-muted-foreground text-sm">
                      {library}/{queue} sends its entries to {info.dataQueue?.library}/{info.dataQueue?.name}. Another program probably reads
                      that data queue, so Spooldoc leaves it alone and polls instead.
                    </p>
                  </div>
                  {!readOnly && !server?.dataQueue && (
                    <div className="flex flex-col items-start gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => run('realtime', { adopt: true })} disabled={outcome.busy}>
                        {outcome.busy ? <Spinner /> : <ZapIcon />}
                        Use {info.dataQueue?.library}/{info.dataQueue?.name} for real-time
                      </Button>
                      <p className="flex items-start gap-1.5 text-muted-foreground text-xs">
                        <AlertTriangleIcon className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                        Only when nothing else reads it: Spooldoc takes the entries off the data queue as it reads them.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                !readOnly && (
                  <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
                    <div>
                      <p className="font-medium text-sm">Get real-time watching</p>
                      <p className="text-muted-foreground text-sm">
                        Spooldoc can create a data queue and attach it to the output queue, so jobs start within seconds of a file being
                        ready. It needs authority to run CRTDTAQ and CHGOUTQ; without it you get the commands for an operator.
                      </p>
                    </div>
                    <div>
                      <Hint
                        text={
                          server?.dataQueue
                            ? `Attaches ${library}/${queue} to the data queue ${server.dataQueue.library}/${server.dataQueue.name} with CHGOUTQ. Switch to polling detaches it again.`
                            : `Creates the data queue ${library}/SPOOLDOC with CRTDTAQ and attaches ${library}/${queue} to it with CHGOUTQ. Switch to polling detaches it again.`
                        }
                      >
                        <Button variant="outline" size="sm" onClick={() => run('realtime')} disabled={outcome.busy}>
                          {outcome.busy ? <Spinner /> : <ZapIcon />}
                          Set up real-time
                        </Button>
                      </Hint>
                    </div>
                  </div>
                )
              )}
            </>
          )}
          {outcome.error && <ErrorNote>{outcome.error}</ErrorNote>}
          {outcome.commands && (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm">Ask an operator to run {outcome.commands.length === 1 ? 'this command' : 'these commands'} on the IBM i:</p>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{outcome.commands.join('\n')}</pre>
              <div>
                <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(outcome.commands!.join('\n'))}>
                  <CopyIcon />
                  Copy
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      <SettingRow id="job-paused" title="Paused" text="A paused job is not watched. Files that arrive meanwhile are left for Run now.">
        <Switch id="job-paused" checked={job.paused} onCheckedChange={(paused) =>
            void updateJob({ paused }).then(
              () => toast.success(paused ? `Paused ${job.name}` : `Resumed ${job.name}`),
              (err) => toast.error(paused ? `Could not pause ${job.name}` : `Could not resume ${job.name}`, { description: errorText(err) }),
            )
          } />
      </SettingRow>

      <AlertDialog open={confirmPolling} onOpenChange={setConfirmPolling}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch {library}/{queue} to polling?</AlertDialogTitle>
            <AlertDialogDescription>
              {server?.dataQueue?.owned
                ? `Spooldoc detaches ${library}/${queue} from its data queue ${server.dataQueue.library}/${server.dataQueue.name} (CHGOUTQ DTAQ(*NONE)) and checks the queue every ${settings ? seconds(settings.pollSeconds) : '30 s'} instead. Other queues that send to that data queue stay real-time.`
                : `Spooldoc stops reading ${server?.dataQueue?.library}/${server?.dataQueue?.name}, which was there before Spooldoc. The output queue keeps sending to it, for whatever else reads it. Every queue of ${server?.name ?? 'this server'} is polled then.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmPolling(false);
                void run('polling');
              }}
            >
              Switch to polling
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}
