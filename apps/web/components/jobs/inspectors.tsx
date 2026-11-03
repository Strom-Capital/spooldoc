'use client';

import { Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Hint } from '@/components/hint';
import { ServerSelect } from '@/components/server-select';
import { ErrorNote } from '@/components/page';
import { ServerErrorNote } from '@/components/server-status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { PageGroupSelect } from '@/components/workbench/position-select';
import { cn } from '@/lib/utils';
import { destinationText } from '@/lib/destination-config';
import type { FinishAction, Route, SourceFilter } from '@/lib/job-spec';
import { isSimpleDestination } from '@/lib/routes';
import { addRoute, DestinationPart, DestinationRoutes, hasPart, newEntry, routeName, RouteStatus, useRoutesPreview, type OpenPart } from './destination-routes';
import { useJob } from './job-provider';
import { newCondition } from './route-conditions';
import { QueueSelect } from './queue-select';
import { StepFooter, useFocusOnArrival } from './step-nav';

/** A padded, scrollable inspector panel with a heading, and Back and Next at the end. */
export function Panel({ title, description, wide, children }: { title: string; description: ReactNode; wide?: boolean; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(heading);
  return (
    <div className="h-full overflow-auto">
      <div className={cn('mx-auto flex flex-col gap-5 px-4 py-5 sm:px-6', wide ? 'max-w-6xl' : 'max-w-3xl')}>
        <div>
          <h2 ref={heading} tabIndex={-1} className="font-semibold text-lg outline-none">
            {title}
          </h2>
          <p className="mt-0.5 text-muted-foreground text-sm">{description}</p>
        </div>
        {children}
        <StepFooter />
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

/**
 * Destination: where the documents go. A job with one route, no conditions and one
 * destination picks it from the destinations, as the reduced form of the routes; adding a
 * condition or a route shows every route as a card.
 */
export function DestinationInspector() {
  const { spec, updateDraft, readOnly, destinations, destinationsError } = useJob();
  const { routes } = spec.destination;
  const simple = isSimpleDestination(spec.destination);
  const routing = useRoutesPreview(routes, !simple);
  const [open, setOpen] = useState<OpenPart | null>({ route: 0, entry: 0 });

  // Every change is made to the latest routes, so quick edits in a row never undo each other.
  const latest = useRef(routes);
  useEffect(() => {
    latest.current = routes;
  }, [routes]);
  const change = (update: (current: Route[]) => Route[], debounce = false) => {
    const next = update(latest.current);
    latest.current = next;
    updateDraft({ destination: { routes: next } }, { debounce });
  };

  const route = routes[0]!;
  const entry = simple ? route.destinations[0] : undefined;
  const picked = entry ? destinations.find((destination) => destination.id === entry.destinationId) : undefined;
  const suffix = (index: number) => {
    const taken = routing.preview?.taken[index];
    return taken === undefined ? '' : `, ${taken === null ? 'no route' : routeName(routes, taken).toLowerCase()}`;
  };
  return (
    <Panel title="Destination" description="Where the job delivers its documents." wide={!simple || hasPart(picked)}>
      {destinationsError && <ErrorNote>Could not load the destinations. {destinationsError}</ErrorNote>}
      <div className="flex flex-col gap-2">
        <PageGroupSelect suffix={simple ? undefined : suffix} />
        {!simple && <RouteStatus routes={routes} {...routing} />}
      </div>
      {simple ? (
        <>
          <div role="radiogroup" aria-label="Destination" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {destinations.map((destination) => (
              <Choice
                key={destination.id}
                selected={entry?.destinationId === destination.id}
                disabled={readOnly}
                onSelect={() => change((current) => [{ ...current[0]!, destinations: [newEntry(destination, current[0]!.destinations[0])] }])}
                title={destination.name}
              >
                {Object.values(destinationText(destination)).join(' ')}
              </Choice>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">
            Add a folder in the IFS, an email, a webhook or an SFTP destination, or change one, on the{' '}
            <Link href="/destinations" className="text-primary hover:underline">
              Destinations
            </Link>{' '}
            page.
          </p>
          {!readOnly && (
            <p className="flex flex-wrap items-center gap-x-1 text-muted-foreground text-xs">
              To send some documents elsewhere by their fields:
              <Hint text="Sends only the documents that match it to this destination. A route can have several conditions.">
                <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => change((current) => [{ ...current[0]!, when: [newCondition()] }])}>
                  Add a condition
                </Button>
              </Hint>
              or
              <Hint text="Adds a route before this one. Each document takes the first route it matches, and this one takes the rest.">
                <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => change(addRoute)}>
                  Add a route
                </Button>
              </Hint>
            </p>
          )}
          {picked && entry && (
            <DestinationPart
              destination={picked}
              entry={entry}
              onChange={(part, debounce) => change((current) => [{ ...current[0]!, destinations: current[0]!.destinations.map((e, i) => (i === 0 ? { ...e, ...part } : e)) }], debounce)}
            />
          )}
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            Each document takes the first route whose conditions it all matches, and goes to every destination of that route. A document that takes no route fails the run.{' '}
            <Link href="/docs/destinations#routes" className="text-primary hover:underline">
              How routes work
            </Link>
          </p>
          <DestinationRoutes routes={routes} preview={routing.preview} open={open} onOpen={setOpen} change={change} />
          <p className="text-muted-foreground text-xs">
            Add a destination, or change one, on the{' '}
            <Link href="/destinations" className="text-primary hover:underline">
              Destinations
            </Link>{' '}
            page.
          </p>
        </>
      )}
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
