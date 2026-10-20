'use client';

import {
  ArrowDownIcon,
  ArrowUpIcon,
  EyeIcon,
  EyeOffIcon,
  FileStackIcon,
  InboxIcon,
  RadioIcon,
  SearchIcon,
  SearchXIcon,
  ServerIcon,
  XIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ErrorNote, Page } from '@/components/page';
import { ServerSelect } from '@/components/server-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SkeletonRows } from '@/components/skeleton-rows';
import { EmptyState, TableEmpty } from '@/components/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api, errorText, isAbort, shownError, type ShownError } from '@/lib/client/api';
import type { QueueCountView, QueueView, ServerView } from '@/lib/types';
import { cn } from '@/lib/utils';
import { NewJobButton } from './new-job-button';

type CountKey = 'ready' | 'held' | 'total';
type SortKey = 'library' | 'name' | CountKey | 'text';
/** The file counts, under one Files header. Ready and held are what a job can pick up. */
const COUNT_COLUMNS: { key: CountKey; label: string; tip: string }[] = [
  { key: 'ready', label: 'Ready', tip: 'Files every job on this queue picks up.' },
  { key: 'held', label: 'Held', tip: 'Files a job picks up when it takes held files too.' },
  {
    key: 'total',
    label: 'Total',
    tip: 'Every spooled file on the queue, as WRKOUTQ counts them. Besides ready and held files, this includes saved and open files and files a printer is working on.',
  },
];

const queueKey = (q: { library: string; name: string }) => `${q.library}/${q.name}`;

/** Output queues of one server: search, sort, hide and unhide, and start a job from one. */
export function QueuesPage({ serverId }: { serverId: string | null }) {
  const router = useRouter();
  const [servers, setServers] = useState<ServerView[] | null>(null);
  const [q, setQ] = useState('');
  // The rows and the server they belong to, so another server's rows are never shown.
  const [loaded, setLoaded] = useState<{ serverId: string; queues: QueueView[] } | null>(null);
  const [error, setError] = useState<ShownError | null>(null);
  const [loading, setLoading] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'library', desc: false });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Ready and held counts load after the list: counting reads every spooled file.
  const [counted, setCounted] = useState<{ serverId: string; counts: Map<string, QueueCountView> | null; error: ShownError | null } | null>(null);

  useEffect(() => {
    api<{ servers: ServerView[] }>('/api/servers').then(
      (data) => setServers(data.servers),
      (err) => setError(shownError(err)),
    );
  }, []);

  const server = servers?.find((s) => s.id === serverId) ?? null;
  const queues = loaded && server && loaded.serverId === server.id ? loaded.queues : null;
  const setQueues = useCallback(
    (update: (current: QueueView[] | null) => QueueView[] | null) =>
      setLoaded((prev) => {
        const next = update(prev?.queues ?? null);
        return prev && next ? { ...prev, queues: next } : prev;
      }),
    [],
  );

  // Without a server in the URL, open the first one.
  useEffect(() => {
    if (servers && servers.length > 0 && !server) {
      router.replace(`/queues?server=${servers[0]!.id}`);
    }
  }, [servers, server, router]);

  useEffect(() => {
    if (!server) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api<{ queues: QueueView[] }>(`/api/servers/${server.id}/queues?q=${encodeURIComponent(q.trim())}`, {
          signal: controller.signal,
        });
        setLoaded({ serverId: server.id, queues: data.queues });
        setError(null);
      } catch (err) {
        if (!isAbort(err)) {
          setError(shownError(err));
          setLoaded(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [server, q]);

  useEffect(() => {
    if (!server) {
      return;
    }
    const controller = new AbortController();
    api<{ counts: QueueCountView[] }>(`/api/servers/${server.id}/queue-counts`, { signal: controller.signal }).then(
      (data) => setCounted({ serverId: server.id, counts: new Map(data.counts.map((count) => [queueKey(count), count])), error: null }),
      (err) => {
        if (!isAbort(err)) {
          setCounted({ serverId: server.id, counts: null, error: shownError(err) });
        }
      },
    );
    return () => controller.abort();
  }, [server]);

  const counts = counted && server && counted.serverId === server.id ? counted : null;
  // A queue missing from the counts has no ready or held files; null while not counted.
  const countOf = useCallback(
    (queue: QueueView, key: CountKey): number | null => {
      if (key === 'total') return queue.files;
      if (!counts?.counts) return null;
      return counts.counts.get(queueKey(queue))?.[key] ?? 0;
    },
    [counts],
  );

  const shown = useMemo(() => {
    const rows = (queues ?? []).filter((queue) => showHidden || !queue.hidden);
    const dir = sort.desc ? -1 : 1;
    return rows.sort((a, b) => {
      const order =
        sort.key === 'library' || sort.key === 'name' || sort.key === 'text'
          ? a[sort.key].localeCompare(b[sort.key])
          : (countOf(a, sort.key) ?? -1) - (countOf(b, sort.key) ?? -1);
      return dir * (order || queueKey(a).localeCompare(queueKey(b)));
    });
  }, [queues, showHidden, sort, countOf]);

  const hiddenCount = queues?.filter((queue) => queue.hidden).length ?? 0;
  // With one library every row has the same one, so there is no Library column to read or sort.
  const oneLibrary = server?.libraries.length === 1;
  const columns = oneLibrary ? 7 : 8;
  const shownSort = oneLibrary && sort.key === 'library' ? { ...sort, key: 'name' as const } : sort;

  const setHidden = useCallback(
    (targets: QueueView[], hidden: boolean): Promise<void> => {
      const keys = new Set(targets.map(queueKey));
      const what = targets.length === 1 ? `${targets[0]!.library}/${targets[0]!.name}` : `${targets.length} queues`;
      // Undo applies the opposite once, without offering to undo that.
      async function apply(hide: boolean, undoable: boolean): Promise<void> {
        if (!server || targets.length === 0) {
          return;
        }
        setQueues((current) => current?.map((queue) => (keys.has(queueKey(queue)) ? { ...queue, hidden: hide } : queue)) ?? null);
        setSelected(new Set());
        try {
          await api(`/api/servers/${server.id}/queue-prefs`, {
            method: 'PUT',
            body: { queues: targets.map((queue) => ({ library: queue.library, name: queue.name, hidden: hide })) },
          });
          toast.success(hide ? `Hid ${what}` : `Unhid ${what}`, undoable ? { action: { label: 'Undo', onClick: () => void apply(!hide, false) } } : undefined);
        } catch (err) {
          toast.error(hide ? `Could not hide ${what}` : `Could not unhide ${what}`, { description: errorText(err) });
          setQueues((current) => current?.map((queue) => (keys.has(queueKey(queue)) ? { ...queue, hidden: !hide } : queue)) ?? null);
        }
      }
      return apply(hidden, true);
    },
    [server, setQueues],
  );

  const selectedRows = shown.filter((queue) => selected.has(queueKey(queue)));
  const allSelected = shown.length > 0 && selectedRows.length === shown.length;

  function toggleSort(key: SortKey) {
    setSort((current) => ({ key, desc: shownSort.key === key ? !current.desc : false }));
  }

  if (servers?.length === 0) {
    return (
      <Page title="Queues" description="Output queues of a server.">
        <EmptyState icon={ServerIcon} title="No servers yet" description="Add a server first. Its output queues show here.">
          <Button asChild>
            <Link href="/servers">Go to Servers</Link>
          </Button>
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page
      title="Queues"
      description={
        server
          ? // With one server there is no picker, so the description names it.
            `Output queues${servers?.length === 1 ? ` of ${server.name}` : ''} in ${server.libraries.length > 0 ? server.libraries.join(', ') : 'every library'}. Hide the ones you don't need; jobs only offer visible queues.`
          : 'Output queues of a server.'
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {servers && servers.length > 1 && (
          <ServerSelect servers={servers} value={server?.id ?? null} onChange={(id) => router.push(`/queues?server=${id}`)} />
        )}
        <div className="relative w-full max-w-sm">
          <SearchIcon className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder={oneLibrary ? 'Queue name' : 'Library or queue, or LIB/QUEUE'}
            aria-label="Search output queues"
            className="pl-8"
            spellCheck={false}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="show-hidden" checked={showHidden} onCheckedChange={setShowHidden} />
          <Label htmlFor="show-hidden" className="font-normal">
            Show hidden{hiddenCount > 0 ? ` (${hiddenCount})` : ''}
          </Label>
        </div>
        {selectedRows.length > 0 && (
          <div className="flex items-center gap-2 sm:ml-auto">
            <span className="text-muted-foreground text-sm">{selectedRows.length} selected</span>
            <Button variant="outline" size="sm" onClick={() => setHidden(selectedRows, true)}>
              <EyeOffIcon />
              Hide
            </Button>
            {showHidden && (
              <Button variant="outline" size="sm" onClick={() => setHidden(selectedRows, false)}>
                <EyeIcon />
                Unhide
              </Button>
            )}
          </div>
        )}
      </div>
      {error && (
        <ErrorNote className="mb-4" detail={error.detail}>
          {error.message}
        </ErrorNote>
      )}
      {!error && counts?.error && (
        <ErrorNote className="mb-4" detail={counts.error.detail}>
          Could not count the ready and held files. {counts.error.message}
        </ErrorNote>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th rowSpan={2} className="w-8 px-3 py-2 align-bottom">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) => setSelected(checked ? new Set(shown.map(queueKey)) : new Set())}
                  aria-label="Select all queues"
                />
              </th>
              {!oneLibrary && <SortHeader column="library" label="Library" sort={shownSort} onSort={toggleSort} rowSpan={2} />}
              <SortHeader column="name" label="Queue" sort={shownSort} onSort={toggleSort} rowSpan={2} />
              {/* The line under Files spans the three counts, so they read as one group. */}
              <th colSpan={3} scope="colgroup" className="px-3 pt-2 text-center font-medium">
                <span className="block border-b pb-1">Files</span>
              </th>
              <SortHeader column="text" label="Text" sort={shownSort} onSort={toggleSort} rowSpan={2} />
              <th rowSpan={2} className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
            <tr>
              {COUNT_COLUMNS.map((column) => (
                <SortHeader key={column.key} column={column.key} label={column.label} tip={column.tip} sort={shownSort} onSort={toggleSort} numeric />
              ))}
            </tr>
          </thead>
          <tbody aria-busy={loading} className={cn(loading && queues && 'opacity-60 transition-opacity')}>
            {!queues && !error && (
              <SkeletonRows widths={['w-4', ...(oneLibrary ? [] : ['w-16']), 'w-24', 'ml-auto w-5', 'ml-auto w-5', 'ml-auto w-6', 'w-48', 'ml-auto w-40']} />
            )}
            {server &&
              shown.map((queue) => (
                <tr key={queueKey(queue)} className={`border-t hover:bg-muted/40 ${queue.hidden ? 'text-muted-foreground' : ''}`}>
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={selected.has(queueKey(queue))}
                      onCheckedChange={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked) next.add(queueKey(queue));
                          else next.delete(queueKey(queue));
                          return next;
                        })
                      }
                      aria-label={`Select ${queueKey(queue)}`}
                    />
                  </td>
                  {!oneLibrary && <td className="px-3 py-2 font-mono text-xs">{queue.library}</td>}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <Link
                        href={`/queues/${server.id}/${encodeURIComponent(queue.library)}/${encodeURIComponent(queue.name)}`}
                        className="font-medium font-mono text-primary text-xs hover:underline"
                      >
                        {queue.name}
                      </Link>
                      {queue.dataQueue && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <RadioIcon className="size-3.5 text-muted-foreground" aria-label="Sends to a data queue" />
                          </TooltipTrigger>
                          <TooltipContent>
                            Sends an entry to {queue.dataQueue.library}/{queue.dataQueue.name} when a file is ready
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {queue.hidden && <span className="rounded bg-muted px-1.5 text-[11px]">Hidden</span>}
                    </div>
                  </td>
                  {COUNT_COLUMNS.map((column) => (
                    <CountCell key={column.key} column={column.key} value={countOf(queue, column.key)} failed={!!counts?.error} />
                  ))}
                  <td className="px-3 py-2 text-muted-foreground">{queue.text}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/queues/${server.id}/${encodeURIComponent(queue.library)}/${encodeURIComponent(queue.name)}`}>
                          <FileStackIcon />
                          Files
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setHidden([queue], !queue.hidden)}
                        aria-label={queue.hidden ? `Unhide ${queueKey(queue)}` : `Hide ${queueKey(queue)}`}
                        title={queue.hidden ? 'Unhide' : 'Hide'}
                      >
                        {queue.hidden ? <EyeIcon /> : <EyeOffIcon />}
                      </Button>
                      <NewJobButton source={{ serverId: server.id, library: queue.library, queue: queue.name }} variant="outline" size="sm" />
                    </div>
                  </td>
                </tr>
              ))}
            {queues &&
              shown.length === 0 &&
              !loading &&
              (queues.length > 0 ? (
                <TableEmpty
                  colSpan={columns}
                  icon={EyeOffIcon}
                  title="Every queue here is hidden"
                  description={q.trim() ? 'The queues that match the search are all hidden.' : 'You have hidden all the queues of this server.'}
                >
                  <Button variant="outline" onClick={() => setShowHidden(true)}>
                    <EyeIcon />
                    Show hidden queues
                  </Button>
                </TableEmpty>
              ) : q.trim() ? (
                <TableEmpty colSpan={columns} icon={SearchXIcon} title="No output queues match" description={`Nothing matches "${q.trim()}". ${oneLibrary ? 'Search by queue name.' : 'Search by library, queue name, or LIB/QUEUE.'}`}>
                  <Button variant="outline" onClick={() => setQ('')}>
                    <XIcon />
                    Clear search
                  </Button>
                </TableEmpty>
              ) : (
                <TableEmpty
                  colSpan={columns}
                  icon={InboxIcon}
                  title="No output queues"
                  description={
                    server?.libraries.length
                      ? `There are no output queues in ${server.libraries.join(', ')}. Check the server's libraries.`
                      : 'This server has no output queues Spooldoc can list.'
                  }
                >
                  <Button asChild variant="outline">
                    <Link href="/servers">
                      <ServerIcon />
                      Edit libraries on Servers
                    </Link>
                  </Button>
                </TableEmpty>
              ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

/** A sortable column header; numeric ones are right-aligned and may explain themselves in a tooltip. */
function SortHeader({
  column,
  label,
  tip,
  sort,
  onSort,
  numeric = false,
  rowSpan,
}: {
  column: SortKey;
  label: string;
  tip?: string;
  sort: { key: SortKey; desc: boolean };
  onSort: (key: SortKey) => void;
  numeric?: boolean;
  rowSpan?: number;
}) {
  const active = sort.key === column;
  const button = (
    <button type="button" onClick={() => onSort(column)} className="inline-flex items-center gap-1 hover:text-foreground">
      {label}
      {active && (sort.desc ? <ArrowDownIcon className="size-3" /> : <ArrowUpIcon className="size-3" />)}
    </button>
  );
  return (
    <th
      rowSpan={rowSpan}
      className={cn('px-3 py-2 align-bottom font-medium', numeric && 'text-right')}
      aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}
    >
      {tip ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent className="max-w-64">{tip}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
    </th>
  );
}

/**
 * One file count. Ready files are what a job takes next, so a queue with some stands
 * out; zeros and the total stay quiet. A placeholder while counting, a dash when it failed.
 */
function CountCell({ column, value, failed }: { column: CountKey; value: number | null; failed: boolean }) {
  return (
    <td
      className={cn(
        'tabular px-3 py-2 text-right',
        (column === 'total' || value === 0) && 'text-muted-foreground',
        column === 'ready' && !!value && 'font-medium',
      )}
    >
      {value !== null ? (
        value
      ) : failed ? (
        <span className="text-muted-foreground">
          <span aria-hidden>–</span>
          <span className="sr-only">Not counted</span>
        </span>
      ) : (
        <Skeleton className="ml-auto h-4 w-5" />
      )}
    </td>
  );
}
