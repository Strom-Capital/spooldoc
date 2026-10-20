'use client';

import { Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ServerSelect } from '@/components/server-select';
import { ServerErrorNote } from '@/components/server-status';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { FinishAction, SourceFilter } from '@/lib/job-spec';
import { useJob } from './job-provider';
import { QueueSelect } from './queue-select';

/** A padded, scrollable inspector panel with a heading. */
export function Panel({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
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
export function SettingRow({ id, title, text, children }: { id: string; title: string; text: string; children: ReactNode }) {
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
export function Choice({
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
  const { spec, updateDraft, readOnly, servers, serversError, reloadServers } = useJob();
  const source = spec.source;
  const set = (change: Partial<typeof source>, debounce = false) => updateDraft({ source: { ...source, ...change } }, { debounce });
  return (
    <Panel title="Source" description="The output queue the job reads spooled files from.">
      {serversError ? (
        <ServerErrorNote error={serversError} server={null} onRetry={reloadServers} />
      ) : servers.length === 0 ? (
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
