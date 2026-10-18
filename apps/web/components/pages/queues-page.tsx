'use client';

import { ArrowDownIcon, ArrowUpIcon, EyeIcon, EyeOffIcon, FileStackIcon, RadioIcon, SearchIcon, ServerIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyNote, ErrorNote, Page } from '@/components/page';
import { ServerSelect } from '@/components/server-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api, errorText, isAbort } from '@/lib/client/api';
import type { QueueView, ServerView } from '@/lib/types';
import { NewJobButton } from './new-job-button';

type SortKey = 'library' | 'name' | 'files' | 'text';
const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'library', label: 'Library' },
  { key: 'name', label: 'Queue' },
  { key: 'files', label: 'Files', numeric: true },
  { key: 'text', label: 'Text' },
];

const queueKey = (q: { library: string; name: string }) => `${q.library}/${q.name}`;

/** Output queues of one server: search, sort, hide and unhide, and start a job from one. */
export function QueuesPage({ serverId }: { serverId: string | null }) {
  const router = useRouter();
  const [servers, setServers] = useState<ServerView[] | null>(null);
  const [q, setQ] = useState('');
  const [queues, setQueues] = useState<QueueView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'library', desc: false });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    api<{ servers: ServerView[] }>('/api/servers').then(
      (data) => setServers(data.servers),
      (err) => setError(errorText(err)),
    );
  }, []);

  const server = servers?.find((s) => s.id === serverId) ?? null;

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
        setQueues(data.queues);
        setError(null);
      } catch (err) {
        if (!isAbort(err)) {
          setError(errorText(err));
          setQueues(null);
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

  const shown = useMemo(() => {
    const rows = (queues ?? []).filter((queue) => showHidden || !queue.hidden);
    const dir = sort.desc ? -1 : 1;
    return rows.sort((a, b) => {
      const order = sort.key === 'files' ? a.files - b.files : String(a[sort.key]).localeCompare(String(b[sort.key]));
      return dir * (order || queueKey(a).localeCompare(queueKey(b)));
    });
  }, [queues, showHidden, sort]);

  const hiddenCount = queues?.filter((queue) => queue.hidden).length ?? 0;

  const setHidden = useCallback(
    async (targets: QueueView[], hidden: boolean) => {
      if (!server || targets.length === 0) {
        return;
      }
      const keys = new Set(targets.map(queueKey));
      setQueues((current) => current?.map((queue) => (keys.has(queueKey(queue)) ? { ...queue, hidden } : queue)) ?? null);
      setSelected(new Set());
      try {
        await api(`/api/servers/${server.id}/queue-prefs`, {
          method: 'PUT',
          body: { queues: targets.map((queue) => ({ library: queue.library, name: queue.name, hidden })) },
        });
      } catch (err) {
        setError(errorText(err));
        setQueues((current) => current?.map((queue) => (keys.has(queueKey(queue)) ? { ...queue, hidden: !hidden } : queue)) ?? null);
      }
    },
    [server],
  );

  const selectedRows = shown.filter((queue) => selected.has(queueKey(queue)));
  const allSelected = shown.length > 0 && selectedRows.length === shown.length;

  function toggleSort(key: SortKey) {
    setSort((current) => ({ key, desc: current.key === key ? !current.desc : false }));
  }

  if (servers?.length === 0) {
    return (
      <Page title="Queues" description="Output queues of a server.">
        <EmptyNote>
          <ServerIcon className="mx-auto mb-2 size-6" aria-hidden />
          Add a server first.
          <div className="mt-4">
            <Button asChild>
              <Link href="/servers">Go to Servers</Link>
            </Button>
          </div>
        </EmptyNote>
      </Page>
    );
  }

  return (
    <Page
      title="Queues"
      description={
        server
          ? server.libraries.length > 0
            ? `Output queues in ${server.libraries.join(', ')}. Hide the ones you don't need; jobs only offer visible queues.`
            : "Output queues in every library. Hide the ones you don't need; jobs only offer visible queues."
          : 'Output queues of a server.'
      }
      actions={
        servers && servers.length > 0 ? (
          <ServerSelect servers={servers} value={server?.id ?? null} onChange={(id) => router.push(`/queues?server=${id}`)} />
        ) : null
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Library or queue, or LIB/QUEUE"
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
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="w-8 px-3 py-2">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) => setSelected(checked ? new Set(shown.map(queueKey)) : new Set())}
                  aria-label="Select all queues"
                />
              </th>
              {COLUMNS.map((column) => (
                <th key={column.key} className={`px-3 py-2 font-medium ${column.numeric ? 'text-right' : ''}`} aria-sort={sort.key === column.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
                  <button type="button" onClick={() => toggleSort(column.key)} className="inline-flex items-center gap-1 hover:text-foreground">
                    {column.label}
                    {sort.key === column.key && (sort.desc ? <ArrowDownIcon className="size-3" /> : <ArrowUpIcon className="size-3" />)}
                  </button>
                </th>
              ))}
              <th className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
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
                  <td className="px-3 py-2 font-mono text-xs">{queue.library}</td>
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
                  <td className="tabular px-3 py-2 text-right">{queue.files}</td>
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
            {queues && shown.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  {queues.length > 0 ? 'Every matching queue is hidden. Turn on Show hidden to see them.' : 'No output queues match.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {(loading || servers === null) && (
          <div className="flex items-center gap-2 border-t px-3 py-3 text-muted-foreground text-sm">
            <Spinner /> Loading queues...
          </div>
        )}
      </div>
    </Page>
  );
}
