'use client';

import { ArrowDownIcon, ArrowUpIcon, InfoIcon, PlusIcon, SettingsIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Hint } from '@/components/hint';
import { ErrorNote } from '@/components/page';
import { RowMenu } from '@/components/row-actions';
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
import { Button } from '@/components/ui/button';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useWorkbench } from '@/components/workbench/workbench-provider';
import { api, errorText } from '@/lib/client/api';
import { destinationText } from '@/lib/destination-config';
import { emptyEmailSpec, emptyWebhookSpec, ROUTE_LIMITS, type EmailSpec, type Route, type RouteDestination, type WebhookSpec } from '@/lib/job-spec';
import { isOtherwise, routeLabel } from '@/lib/routes';
import type { DestinationView, RouteCheckView, RoutesPreviewView } from '@/lib/types';
import { cn } from '@/lib/utils';
import { EmailStep } from './email-step';
import { useJob } from './job-provider';
import { newCondition, RouteConditions } from './route-conditions';
import { SftpStep } from './sftp-step';
import { WebhookStep } from './webhook-step';

/** How long the routes preview waits after a change before it asks again. */
const PREVIEW_DELAY_MS = 400;

/** "route 2", or "Otherwise", as it reads inside a sentence. */
export const routeName = (routes: readonly Pick<Route, 'when'>[], index: number): string => (isOtherwise(routes, index) ? 'Otherwise' : `route ${index + 1}`);

/** The destination entry for a newly picked destination: with an empty email or webhook part when it needs one. */
export function newEntry(destination: DestinationView, before?: RouteDestination): RouteDestination {
  return {
    destinationId: destination.id,
    // An email or webhook destination needs its part; another destination keeps it, for coming back.
    email: before?.email ?? (destination.kind === 'email' ? emptyEmailSpec() : null),
    webhook: before?.webhook ?? (destination.kind === 'webhook' ? emptyWebhookSpec() : null),
  };
}

/**
 * The routes with one more: before the last route when it has no conditions, so it stays
 * the one that takes what the others leave, else at the end. A route put before another
 * starts with one condition to fill in, since a route without one would take every document.
 */
export function addRoute(routes: readonly Route[]): Route[] {
  const last = routes.at(-1);
  if (last && last.when.length === 0) return [...routes.slice(0, -1), { when: [newCondition()], destinations: [] }, last];
  return [...routes, { when: [], destinations: [] }];
}

/**
 * Where the page groups of the preview spooled file go with the routes as the editor has
 * them, asked for again after a pause when they change, or at once for another page group.
 * Nothing is asked for while `enabled` is false.
 */
export function useRoutesPreview(routes: Route[], enabled: boolean) {
  const { job, spec } = useJob();
  const { sampleId, pageGroupIndex } = useWorkbench();
  const [state, setState] = useState<{ preview: RoutesPreviewView | null; error: string | null; loading: boolean }>({ preview: null, error: null, loading: false });
  // The definition, the lookups and the templates are part of the key: the server reads them from the draft.
  const body = useMemo(
    () => JSON.stringify({ request: { routes, pageGroup: pageGroupIndex, sampleId: sampleId ?? undefined }, definition: spec.extract.definition, lookups: spec.lookups, templates: spec.render.templates }),
    [routes, pageGroupIndex, sampleId, spec.extract.definition, spec.lookups, spec.render.templates],
  );
  const lastGroup = useRef(pageGroupIndex);
  useEffect(() => {
    if (!enabled || !sampleId) return;
    let cancelled = false;
    const delay = lastGroup.current !== pageGroupIndex ? 0 : PREVIEW_DELAY_MS;
    lastGroup.current = pageGroupIndex;
    const timer = setTimeout(() => {
      setState((current) => ({ ...current, loading: true }));
      const { request } = JSON.parse(body) as { request: Record<string, unknown> };
      api<RoutesPreviewView>(`/api/jobs/${job.id}/routes-preview`, { method: 'POST', body: request }).then(
        (preview) => !cancelled && setState({ preview, error: null, loading: false }),
        (err: unknown) => !cancelled && setState((current) => ({ ...current, error: errorText(err), loading: false })),
      );
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [body, enabled, job.id, pageGroupIndex, sampleId]);
  return enabled && sampleId ? state : { preview: null, error: null, loading: false };
}

/** Why each route takes the document or not, one line per route, for the Why popover. */
function RouteReasons({ routes, checks, taken }: { routes: Route[]; checks: RouteCheckView[]; taken: number | null }) {
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {checks.map((check, index) => {
        const reasons = check.conditions.flatMap((condition) => (condition.reason ? [condition.reason] : []));
        return (
          <li key={index} className={cn(taken !== null && index > taken && 'text-muted-foreground')}>
            <span className="font-medium">{routeLabel(routes, index)}:</span>{' '}
            {taken !== null && index > taken
              ? 'not checked, an earlier route takes it.'
              : check.ok
                ? check.conditions.length === 0
                  ? 'takes every document.'
                  : 'every condition matches.'
                : `${reasons.join('; ')}.`}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Which route the page group shown takes, and the document of the whole spooled file when a
 * template makes one, with a Why popover that says why each route takes it or not.
 */
export function RouteStatus({ routes, preview, error, loading }: { routes: Route[]; preview: RoutesPreviewView | null; error: string | null; loading: boolean }) {
  const { sampleId } = useWorkbench();
  if (!sampleId) return <p className="text-muted-foreground text-sm">Pick a sample spooled file to see which route each page group takes.</p>;
  if (error && !preview) return <ErrorNote>Could not check the routes. {error}</ErrorNote>;
  if (!preview) {
    return (
      <p className="flex items-center gap-2 text-muted-foreground text-sm" role="status">
        <Spinner aria-hidden />
        Checking the routes...
      </p>
    );
  }
  const line = (what: string, taken: number | null, checks: RouteCheckView[]) => (
    <p className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-sm', taken === null && 'text-destructive')}>
      <span>{taken === null ? `${what} matches no route. A run fails until a route takes it.` : `${what} takes ${routeName(routes, taken)}.`}</span>
      <Popover>
        <Hint text="Why each route takes it or not.">
          <PopoverTrigger asChild>
            <Button type="button" variant="link" size="sm" className="h-auto px-0">
              <InfoIcon />
              Why
            </Button>
          </PopoverTrigger>
        </Hint>
        <PopoverContent align="start" className="w-96">
          <RouteReasons routes={routes} checks={checks} taken={taken} />
        </PopoverContent>
      </Popover>
    </p>
  );
  return (
    <div className="flex flex-col gap-1" aria-live="polite">
      {line(`Page group ${preview.pageGroup + 1}`, preview.route, preview.checks)}
      {preview.spooledFile && line('The whole spooled file', preview.spooledFile.route, preview.spooledFile.checks)}
      {preview.lookupError && <p className="text-amber-700 text-xs dark:text-amber-400">The lookups did not run, so their fields are not in the data: {preview.lookupError}</p>}
      {error && <p className="text-destructive text-xs">Could not check the routes again. {error}</p>}
      {loading && <span className="sr-only">Checking the routes...</span>}
    </div>
  );
}

/** A note above a preview of a destination of one route, when the page group shown takes another route. */
function OtherRouteNotice({ routes, route, preview }: { routes: Route[]; route: number; preview: RoutesPreviewView | null }) {
  if (!preview || preview.route === route || routes.length === 1) return null;
  const taken = preview.route === null ? 'no route' : routeName(routes, preview.route);
  return (
    <p className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
      <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      Page group {preview.pageGroup + 1} takes {taken}, not this one. This is what it would get here.
    </p>
  );
}

/**
 * The settings of one destination of a route, below the routes: the email for an email
 * destination, the files of each call for a webhook, the folder for SFTP. Other kinds have
 * none here.
 */
export function DestinationPart({
  destination,
  entry,
  onChange,
  notice,
}: {
  destination: DestinationView;
  entry: RouteDestination;
  onChange(change: Partial<RouteDestination>, debounce: boolean): void;
  notice?: ReactNode;
}) {
  if (destination.kind === 'email') {
    return (
      <EmailStep
        destination={destination}
        part={entry.email}
        notice={notice}
        onChange={(change: Partial<EmailSpec>, debounce) => onChange({ email: { ...(entry.email ?? emptyEmailSpec()), ...change } }, debounce)}
      />
    );
  }
  if (destination.kind === 'webhook') {
    return (
      <WebhookStep
        destination={destination}
        part={entry.webhook}
        notice={notice}
        onChange={(change: Partial<WebhookSpec>) => onChange({ webhook: { ...(entry.webhook ?? emptyWebhookSpec()), ...change } }, false)}
      />
    );
  }
  if (destination.kind === 'sftp') return <SftpStep destination={destination} notice={notice} />;
  return null;
}

/** True for a destination with settings in this step: email, webhook and SFTP. */
export const hasPart = (destination: DestinationView | undefined): boolean => destination?.kind === 'email' || destination?.kind === 'webhook' || destination?.kind === 'sftp';

/** One destination and route whose settings are open below the routes. */
export interface OpenPart {
  route: number;
  entry: number;
}

/**
 * The routes of a job, one card each, in the order a document tries them: the conditions,
 * every one of which must match, and the destinations the documents that match go to.
 * The last route without conditions is Otherwise. The settings of one destination open
 * below its route.
 */
export function DestinationRoutes({
  routes,
  preview,
  open,
  onOpen,
  change,
}: {
  routes: Route[];
  preview: RoutesPreviewView | null;
  open: OpenPart | null;
  onOpen(open: OpenPart | null): void;
  /** Change the routes: each change is made to the latest routes. */
  change(update: (routes: Route[]) => Route[], debounce?: boolean): void;
}) {
  const { readOnly, destinations } = useJob();
  const [removing, setRemoving] = useState<number | null>(null);
  const setRoute = (index: number, update: (route: Route) => Route, debounce?: boolean) =>
    change((current) => current.map((route, at) => (at === index ? update(route) : route)), debounce);
  const move = (index: number, by: number) => {
    onOpen(null);
    change((current) => {
      const next = [...current];
      const [route] = next.splice(index, 1);
      next.splice(index + by, 0, route!);
      return next;
    });
  };
  const fields = preview?.fields ?? null;
  const fullRoutes = routes.length >= ROUTE_LIMITS.routes;

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-4">
        {routes.map((route, index) => {
          const label = routeLabel(routes, index);
          const count = preview ? preview.taken.filter((taken) => taken === index).length : null;
          const used = new Set(route.destinations.map((entry) => entry.destinationId));
          const left = destinations.filter((destination) => !used.has(destination.id));
          const fullDestinations = route.destinations.length >= ROUTE_LIMITS.destinations;
          const openHere = open?.route === index ? route.destinations[open.entry] : undefined;
          const openDestination = openHere ? destinations.find((d) => d.id === openHere.destinationId) : undefined;
          return (
            <li key={index} aria-labelledby={`route-${index}-title`} className="flex min-w-0 flex-col gap-4 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-baseline gap-2">
                  <h3 id={`route-${index}-title`} className="font-semibold text-sm">
                    {label}
                  </h3>
                  {count !== null && (
                    <span className="tabular text-muted-foreground text-xs">
                      {count} of {preview!.pageGroups} {preview!.pageGroups === 1 ? 'page group' : 'page groups'}
                    </span>
                  )}
                </div>
                {!readOnly && (
                  <RowMenu label={label}>
                    <DropdownMenuItem disabled={index === 0} onSelect={() => move(index, -1)}>
                      <ArrowUpIcon />
                      Move up
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={index === routes.length - 1} onSelect={() => move(index, 1)}>
                      <ArrowDownIcon />
                      Move down
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" disabled={routes.length === 1} onSelect={() => setRemoving(index)}>
                      <Trash2Icon />
                      Remove route
                    </DropdownMenuItem>
                  </RowMenu>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <h4 className="font-medium text-muted-foreground text-xs">When</h4>
                {route.when.length === 0 && (
                  <p className="text-sm">
                    {isOtherwise(routes, index) ? 'Every document the routes above do not take.' : 'Every document. Add a condition to take only some.'}
                  </p>
                )}
                <RouteConditions
                  route={index}
                  conditions={route.when}
                  fields={fields}
                  check={preview?.checks[index] ?? null}
                  readOnly={readOnly}
                  onChange={(when, debounce) => setRoute(index, (current) => ({ ...current, when }), debounce)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <h4 className="font-medium text-muted-foreground text-xs">Send to</h4>
                {route.destinations.length === 0 && <p className="text-destructive text-sm">No destination yet. Add one.</p>}
                {route.destinations.length > 0 && (
                  <ul className="flex flex-col divide-y rounded-md border">
                    {route.destinations.map((entry, at) => {
                      const destination = destinations.find((d) => d.id === entry.destinationId);
                      const isOpen = open?.route === index && open.entry === at;
                      return (
                        <li key={entry.destinationId} className="flex items-center gap-2 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-sm">{destination?.name ?? 'A destination that is gone'}</p>
                            <p className="truncate text-muted-foreground text-xs">{destination ? destinationText(destination).where : 'Remove it, and add another one.'}</p>
                          </div>
                          {hasPart(destination) && (
                            <Hint text={isOpen ? 'Close its settings.' : 'Show what this destination sends, with a preview of the page group shown.'}>
                              <Button size="sm" variant={isOpen ? 'secondary' : 'ghost'} aria-expanded={isOpen} onClick={() => onOpen(isOpen ? null : { route: index, entry: at })}>
                                <SettingsIcon />
                                Settings
                              </Button>
                            </Hint>
                          )}
                          {!readOnly && (
                            <Hint text="Removes this destination from the route.">
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Remove ${destination?.name ?? 'the destination'} from ${label}`}
                                onClick={() => {
                                  onOpen(null);
                                  setRoute(index, (current) => ({ ...current, destinations: current.destinations.filter((_, i) => i !== at) }));
                                }}
                              >
                                <XIcon />
                              </Button>
                            </Hint>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!readOnly && (
                  <Hint
                    text={
                      fullDestinations
                        ? `A route sends to up to ${ROUTE_LIMITS.destinations} destinations.`
                        : left.length === 0
                          ? 'Every destination is in this route already. Add one on the Destinations page.'
                          : undefined
                    }
                  >
                    <div className="w-full sm:w-72">
                      <Select
                        value=""
                        disabled={fullDestinations || left.length === 0}
                        onValueChange={(id) => {
                          const destination = destinations.find((d) => d.id === id);
                          if (!destination) return;
                          setRoute(index, (current) => ({ ...current, destinations: [...current.destinations, newEntry(destination)] }));
                          if (hasPart(destination)) onOpen({ route: index, entry: route.destinations.length });
                        }}
                      >
                        <SelectTrigger aria-label={`Add a destination to ${label}`} className="w-full">
                          <SelectValue
                            placeholder={
                              <span className="flex items-center gap-1.5">
                                <PlusIcon className="size-4" />
                                Add a destination
                              </span>
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {left.map((destination) => (
                            <SelectItem key={destination.id} value={destination.id}>
                              {destination.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </Hint>
                )}
              </div>
              {openHere && openDestination && hasPart(openDestination) && (
                <div className="border-t pt-4">
                  <h4 className="mb-3 font-medium text-sm">
                    {openDestination.name}, {routeName(routes, index)}
                  </h4>
                  <DestinationPart
                    destination={openDestination}
                    entry={openHere}
                    notice={<OtherRouteNotice routes={routes} route={index} preview={preview} />}
                    onChange={(part, debounce) =>
                      setRoute(
                        index,
                        (current) => ({ ...current, destinations: current.destinations.map((entry, i) => (i === open!.entry ? { ...entry, ...part } : entry)) }),
                        debounce,
                      )
                    }
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {!readOnly && (
        <div>
          <Hint
            text={
              fullRoutes
                ? `A job has up to ${ROUTE_LIMITS.routes} routes.`
                : routes.at(-1)?.when.length === 0
                  ? `Adds a route before ${routeName(routes, routes.length - 1)}, with a condition to fill in.`
                  : 'Adds a route at the end, without conditions, for the documents the routes above do not take.'
            }
          >
            <Button size="sm" variant="outline" disabled={fullRoutes} onClick={() => change(addRoute)}>
              <PlusIcon />
              Add a route
            </Button>
          </Hint>
        </div>
      )}
      <AlertDialog open={removing !== null} onOpenChange={(isOpen) => !isOpen && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing === null ? 'the route' : routeName(routes, removing)}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its conditions and destinations are removed from the draft. The documents it took go to the next route that matches. Saved versions keep it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const index = removing;
                setRemoving(null);
                onOpen(null);
                if (index !== null) change((current) => current.filter((_, at) => at !== index));
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
