'use client';

import { AlertTriangleIcon, CopyIcon, RadioIcon, Trash2Icon, ZapIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { ErrorNote } from '@/components/page';
import { ServerSelect } from '@/components/server-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { api, errorText } from '@/lib/client/api';
import { cn } from '@/lib/utils';
import type { FinishAction, SourceFilter } from '@/lib/job-spec';
import type { SettingsView } from '@/lib/types';
import { useJob } from './job-provider';
import { QueueSelect, useQueues } from './queue-select';

/** A padded, scrollable inspector panel with a heading. */
function Panel({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-5 sm:px-6">
        <div>
          <h2 className="font-semibold text-lg">{title}</h2>
          <p className="mt-0.5 text-muted-foreground text-sm">{description}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

/** A bordered row with a title, a line of text and a control (a switch) on the right. */
function SettingRow({ id, title, text, children }: { id: string; title: string; text: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div>
        <Label htmlFor={id} className="font-medium">
          {title}
        </Label>
        <p className="mt-0.5 text-muted-foreground text-xs">{text}</p>
      </div>
      {children}
    </div>
  );
}

/** A choice card for a radio group. */
function Choice({
  selected,
  disabled,
  onSelect,
  title,
  children,
  tone,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect(): void;
  title: string;
  children: ReactNode;
  tone?: 'danger';
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-60',
        selected && (tone === 'danger' ? 'border-destructive ring-2 ring-destructive/20' : 'border-primary ring-2 ring-primary/20'),
      )}
    >
      <span className="font-medium text-sm">{title}</span>
      <span className="text-muted-foreground text-xs">{children}</span>
    </button>
  );
}

const FILTERS: { key: keyof SourceFilter; label: string; hint?: string; placeholder: string; upper: boolean }[] = [
  { key: 'splf', label: 'Spooled file name', placeholder: 'QSYSPRT', upper: true },
  { key: 'userData', label: 'User data', placeholder: 'INVOICE', upper: false },
  { key: 'formType', label: 'Form type', placeholder: '*STD', upper: true },
  { key: 'jobName', label: 'Job name', hint: 'The program or job that printed the file.', placeholder: 'INVPRT', upper: true },
  { key: 'jobUser', label: 'Job user', hint: 'The user the job ran under.', placeholder: 'BATCHUSER', upper: true },
];

/** Source: the server, the output queue and optional filters. */
export function SourceInspector() {
  const { spec, updateDraft, readOnly, servers } = useJob();
  const source = spec.source;
  const set = (change: Partial<typeof source>, debounce = false) => updateDraft({ source: { ...source, ...change } }, { debounce });
  return (
    <Panel title="Source" description="The output queue the job reads spooled files from.">
      {servers.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No servers yet. <Link href="/servers" className="text-primary hover:underline">Add one on the Servers page.</Link>
        </p>
      ) : (
        <>
          <Field label="Server" htmlFor="source-server">
            <ServerSelect
              id="source-server"
              servers={servers}
              value={source.serverId}
              onChange={(serverId) => serverId !== source.serverId && set({ serverId, library: '', queue: '' })}
              className="w-full sm:w-72"
            />
          </Field>
          <Field label="Output queue" htmlFor="source-queue" hint="Hidden queues are not offered. Unhide them on the Queues page.">
            <QueueSelect
              id="source-queue"
              serverId={source.serverId}
              value={source.library ? { library: source.library, name: source.queue } : null}
              onChange={(queue) => set({ library: queue.library, queue: queue.name })}
              disabled={readOnly}
            />
          </Field>
        </>
      )}
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="font-medium text-sm">Filters</h3>
          <p className="text-muted-foreground text-xs">
            Optional. Only the spooled files that match every filter are run and watched. Each is a &quot;contains&quot; match.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FILTERS.map((item) => (
            <Field key={item.key} label={item.label} htmlFor={`filter-${item.key}`} hint={item.hint}>
              <Input
                id={`filter-${item.key}`}
                value={source.filter[item.key]}
                onChange={(event) => {
                  const text = event.target.value.slice(0, 10);
                  set({ filter: { ...source.filter, [item.key]: item.upper ? text.toUpperCase() : text } }, true);
                }}
                disabled={readOnly}
                placeholder={`Any, e.g. ${item.placeholder}`}
                className={cn('font-mono placeholder:font-sans', item.upper && 'uppercase placeholder:normal-case')}
                spellCheck={false}
              />
            </Field>
          ))}
        </div>
      </div>
    </Panel>
  );
}

/** Watcher settings, for the poll interval in the texts. */
function useSettings(): SettingsView | null {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  useEffect(() => {
    api<SettingsView>('/api/settings').then(setSettings, () => undefined);
  }, []);
  return settings;
}

function seconds(value: number): string {
  return value % 60 === 0 ? `${value / 60} min` : `${value} s`;
}

/** Trigger: on demand or watching, with how the queue is watched and pause and resume. */
export function TriggerInspector() {
  const { spec, updateDraft, readOnly, job, updateJob, servers, activeSpec } = useJob();
  const settings = useSettings();
  const { serverId, library, queue } = spec.source;
  const { queues, error: queuesError } = useQueues(serverId);
  const server = servers.find((s) => s.id === serverId) ?? null;
  const info = queues?.find((q) => q.library === library && q.name === queue) ?? null;
  const [setup, setSetup] = useState<{ busy: boolean; error: string | null; commands: string[] | null; done: boolean }>({
    busy: false,
    error: null,
    commands: null,
    done: false,
  });
  const watching = spec.trigger.mode === 'watch';
  const realtime = !!(info?.dataQueue && server?.dataQueue && info.dataQueue.library === server.dataQueue.library && info.dataQueue.name === server.dataQueue.name);
  const otherDtaq = !!info?.dataQueue && !realtime;

  async function onSetup(adopt = false) {
    if (!serverId) return;
    setSetup({ busy: true, error: null, commands: null, done: false });
    try {
      const response = await fetch(`/api/servers/${serverId}/queues/${encodeURIComponent(library)}/${encodeURIComponent(queue)}/realtime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adopt }),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; commands?: string[] };
      const ok = response.ok && result.ok === true;
      setSetup({ busy: false, error: ok ? null : (result.error ?? `Set-up failed (HTTP ${response.status}).`), commands: result.commands ?? null, done: ok });
      // The server and queue lists now know the data queue.
      if (ok) window.location.reload();
    } catch (err) {
      setSetup({ busy: false, error: errorText(err), commands: null, done: false });
    }
  }

  return (
    <Panel title="Trigger" description="When the job runs. You can always run it by hand with Run now.">
      <div role="radiogroup" aria-label="Trigger" className="grid gap-3 sm:grid-cols-2">
        <Choice selected={!watching} disabled={readOnly} onSelect={() => updateDraft({ trigger: { ...spec.trigger, mode: 'manual' } }, { debounce: false })} title="On demand">
          Runs only when you pick spooled files and press Run now.
        </Choice>
        <Choice selected={watching} disabled={readOnly} onSelect={() => updateDraft({ trigger: { ...spec.trigger, mode: 'watch' } }, { debounce: false })} title="Watching">
          Runs on every new spooled file that is ready on the queue.
        </Choice>
      </div>
      {watching && activeSpec?.trigger.mode !== 'watch' && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-800 text-sm dark:text-amber-300">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <span>
            Watching starts when you save a version with Watching and make it active.{' '}
            {spec.trigger.backlog ? 'The ready files already on the queue are run then too.' : 'Files already on the queue are left for Run now.'}
          </span>
        </p>
      )}
      {watching && (
        <SettingRow
          id="trigger-backlog"
          title="Also process the files already on the queue"
          text="When watching starts or resumes, run the ready files that are already waiting, not only new ones. Held files are never run by the watcher: release them on the IBM i or use Run now."
        >
          <Switch
            id="trigger-backlog"
            checked={spec.trigger.backlog}
            disabled={readOnly}
            onCheckedChange={(backlog) => updateDraft({ trigger: { ...spec.trigger, backlog } }, { debounce: false })}
          />
        </SettingRow>
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
              <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
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
            <ErrorNote>{queuesError}</ErrorNote>
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
            <p className="text-sm">
              {library}/{queue} sends an entry to {server?.dataQueue?.library}/{server?.dataQueue?.name} when a spooled file is ready, and
              the job starts within seconds. As a safety net the queue is also checked every{' '}
              {settings ? seconds(settings.safetyCheckSeconds) : '5 min'}.
            </p>
          ) : (
            <>
              <p className="text-sm">
                Spooldoc checks the queue for new ready files every {settings ? seconds(settings.pollSeconds) : '30 s'}. Change the
                interval in{' '}
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
                      <Button variant="outline" size="sm" onClick={() => onSetup(true)} disabled={setup.busy}>
                        {setup.busy ? <Spinner /> : <ZapIcon />}
                        Use {info.dataQueue?.library}/{info.dataQueue?.name} for real-time
                      </Button>
                      <p className="flex items-start gap-1.5 text-muted-foreground text-xs">
                        <AlertTriangleIcon className="mt-px size-3.5 shrink-0 text-amber-600" />
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
                      <Button variant="outline" size="sm" onClick={() => onSetup()} disabled={setup.busy}>
                        {setup.busy ? <Spinner /> : <ZapIcon />}
                        Set up real-time
                      </Button>
                    </div>
                  </div>
                )
              )}
              {setup.error && <ErrorNote>{setup.error}</ErrorNote>}
              {setup.commands && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-sm">Ask an operator to run these commands on the IBM i:</p>
                  <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{setup.commands.join('\n')}</pre>
                  <div>
                    <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(setup.commands!.join('\n'))}>
                      <CopyIcon />
                      Copy
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}
      <SettingRow id="job-paused" title="Paused" text="A paused job is not watched. Files that arrive meanwhile are left for Run now.">
        <Switch id="job-paused" checked={job.paused} onCheckedChange={(paused) => void updateJob({ paused })} />
      </SettingRow>
    </Panel>
  );
}

/** Destination: where the documents go. */
export function DestinationInspector() {
  const { spec, updateDraft, readOnly, destinations } = useJob();
  return (
    <Panel title="Destination" description="Where the job delivers its documents.">
      <div role="radiogroup" aria-label="Destination" className="grid gap-3 sm:grid-cols-2">
        {destinations.map((destination) => (
          <Choice
            key={destination.id}
            selected={spec.destination.destinationId === destination.id}
            disabled={readOnly}
            onSelect={() => updateDraft({ destination: { destinationId: destination.id } }, { debounce: false })}
            title={destination.name}
          >
            Files (PDF and HTML) are kept in Spooldoc and can be downloaded from the Job log.
          </Choice>
        ))}
      </div>
      <p className="text-muted-foreground text-sm">
        SFTP, S3, IFS, email and webhooks are coming later. See{' '}
        <Link href="/destinations" className="text-primary hover:underline">
          Destinations
        </Link>
        .
      </p>
    </Panel>
  );
}

/** Finish: what happens to the spooled file after delivery. */
export function FinishInspector() {
  const { spec, updateDraft, readOnly } = useJob();
  const finish = spec.finish;
  const handled = finish.action !== 'none';
  const set = (action: FinishAction, queue = finish.queue) => updateDraft({ finish: { action, queue } }, { debounce: false });
  return (
    <Panel
      title="Finish"
      description="What happens to the spooled file after every document was delivered. A failed run leaves the file untouched so it can be run again, and previews never touch it."
    >
      <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
        <div>
          <Label htmlFor="finish-handle" className="font-medium">
            Handle the spooled file after delivery
          </Label>
          <p className="text-muted-foreground text-xs">
            Off leaves it as it is (still ready). Spooldoc still remembers it, so the watcher does not process it twice.
          </p>
        </div>
        <Switch id="finish-handle" checked={handled} disabled={readOnly} onCheckedChange={(on) => set(on ? 'hold' : 'none')} />
      </div>
      {handled && (
        <div role="radiogroup" aria-label="Finish action" className="grid gap-3 sm:grid-cols-3">
          <Choice selected={finish.action === 'hold'} disabled={readOnly} onSelect={() => set('hold')} title="Hold">
            The file stays on the queue as held. Release it on the IBM i to undo.
          </Choice>
          <Choice selected={finish.action === 'move'} disabled={readOnly} onSelect={() => set('move')} title="Move">
            Move it to another output queue, such as an archive queue.
          </Choice>
          <Choice selected={finish.action === 'delete'} disabled={readOnly} onSelect={() => set('delete')} title="Delete" tone="danger">
            Delete it from the IBM i. This cannot be undone.
          </Choice>
        </div>
      )}
      {finish.action === 'move' && (
        <Field label="Move to" htmlFor="finish-queue" hint="An output queue on the same server.">
          <QueueSelect
            id="finish-queue"
            serverId={spec.source.serverId}
            value={finish.queue}
            onChange={(queue) => set('move', { library: queue.library, name: queue.name })}
            disabled={readOnly}
          />
        </Field>
      )}
      {finish.action === 'delete' && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive text-sm">
          <Trash2Icon className="mt-0.5 size-4 shrink-0" />
          Spooled files are deleted from the IBM i after their documents are delivered. Keep this only when the delivered files are the record.
        </p>
      )}
    </Panel>
  );
}
