'use client';

import { AlertTriangleIcon, CopyIcon, RadioIcon, Trash2Icon, ZapIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { ErrorNote } from '@/components/page';
import { ServerSelect } from '@/components/server-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { api, errorText } from '@/lib/client/api';
import { cn } from '@/lib/utils';
import type { FinishAction } from '@/lib/job-spec';
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Spooled file name contains" htmlFor="filter-splf" hint="Optional. Only these files are run and watched.">
          <Input
            id="filter-splf"
            value={source.filter.splf}
            onChange={(event) => set({ filter: { ...source.filter, splf: event.target.value.toUpperCase().slice(0, 10) } }, true)}
            disabled={readOnly}
            className="font-mono uppercase"
            spellCheck={false}
          />
        </Field>
        <Field label="User data contains" htmlFor="filter-userdata" hint="Optional.">
          <Input
            id="filter-userdata"
            value={source.filter.userData}
            onChange={(event) => set({ filter: { ...source.filter, userData: event.target.value.slice(0, 10) } }, true)}
            disabled={readOnly}
            className="font-mono"
            spellCheck={false}
          />
        </Field>
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
  const { queues } = useQueues(serverId);
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
        <Choice selected={!watching} disabled={readOnly} onSelect={() => updateDraft({ trigger: { mode: 'manual' } }, { debounce: false })} title="On demand">
          Runs only when you pick spooled files and press Run now.
        </Choice>
        <Choice selected={watching} disabled={readOnly} onSelect={() => updateDraft({ trigger: { mode: 'watch' } }, { debounce: false })} title="Watching">
          Runs on every new spooled file that is ready on the queue.
        </Choice>
      </div>
      {watching && (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          {activeSpec?.trigger.mode !== 'watch' && (
            <p className="flex items-start gap-2 text-amber-700 text-sm dark:text-amber-400">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
              Watching starts when you save a version with Watching and make it active. Files already on the queue are left
              for Run now.
            </p>
          )}
          {!info ? (
            <p className="text-muted-foreground text-sm">{library ? 'Checking the queue...' : 'Pick the source queue first.'}</p>
          ) : realtime ? (
            <p className="flex items-start gap-2 text-sm">
              <ZapIcon className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <span>
                <strong>Real-time.</strong> {library}/{queue} sends an entry to {server?.dataQueue?.library}/{server?.dataQueue?.name} when a
                spooled file is ready, and the job starts within seconds. As a safety net the queue is also checked every{' '}
                {settings ? seconds(settings.safetyCheckSeconds) : '5 min'}.
              </span>
            </p>
          ) : (
            <>
              <p className="flex items-start gap-2 text-sm">
                <RadioIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <strong>Polling every {settings ? seconds(settings.pollSeconds) : '30 s'}.</strong> Change the interval in{' '}
                  <Link href="/settings" className="text-primary hover:underline">
                    Settings
                  </Link>
                  .
                </span>
              </p>
              {otherDtaq ? (
                <div className="flex flex-col gap-2">
                  <p className="text-muted-foreground text-sm">
                    {library}/{queue} already sends entries to {info.dataQueue?.library}/{info.dataQueue?.name}. Another program probably
                    reads that data queue, so Spooldoc leaves it alone and keeps polling.
                  </p>
                  {!readOnly && !server?.dataQueue && (
                    <div>
                      <Button variant="ghost" size="sm" onClick={() => onSetup(true)} disabled={setup.busy}>
                        {setup.busy ? <Spinner /> : <ZapIcon />}
                        Let Spooldoc read {info.dataQueue?.library}/{info.dataQueue?.name}
                      </Button>
                      <p className="text-muted-foreground text-xs">Only when nothing else reads it: reading takes the entries off the data queue.</p>
                    </div>
                  )}
                </div>
              ) : (
                !readOnly && (
                  <div className="flex flex-col gap-2">
                    <p className="text-muted-foreground text-sm">
                      For real-time watching, Spooldoc can create a data queue and attach it to the output queue. That needs
                      authority to run CRTDTAQ and CHGOUTQ.
                    </p>
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
        </div>
      )}
      <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
        <div>
          <Label htmlFor="job-paused" className="font-medium">
            Paused
          </Label>
          <p className="text-muted-foreground text-xs">
            A paused job is not watched. Files that arrive meanwhile are left for Run now.
          </p>
        </div>
        <Switch id="job-paused" checked={job.paused} onCheckedChange={(paused) => void updateJob({ paused })} />
      </div>
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
            PDFs are kept in Spooldoc and can be downloaded from the Job log.
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
          Spooled files are deleted from the IBM i after their PDFs are delivered. Keep this only when the PDFs are the record.
        </p>
      )}
    </Panel>
  );
}
