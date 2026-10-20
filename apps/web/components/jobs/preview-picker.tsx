'use client';

import { ChevronsUpDownIcon, FileTextIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Loading } from '@/components/empty-state';
import { ServerErrorNote } from '@/components/server-status';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { api, shownError, type ShownError } from '@/lib/client/api';
import { dateTime } from '@/lib/client/format';
import { filterParams, splfKey } from '@/lib/job-spec';
import type { SampleView } from '@/lib/client/render';
import type { SpooledFileView } from '@/lib/types';
import { useJob } from './job-provider';

const idOf = (f: SpooledFileView) => ({ name: f.name, number: f.number, jobName: f.jobName, jobUser: f.jobUser, jobNumber: f.jobNumber });

/**
 * The spooled file the definition and template are tried on: a searchable list of the
 * source queue's files. Picking one reads it from the IBM i and saves a copy, which the
 * workbench shows from then on, also after the file leaves the queue. The file is never
 * held, moved or deleted. Once the queue is set, the newest file is picked when none is.
 */
export function PreviewPicker({ sample }: { sample: SampleView | null }) {
  const { job, spec, refresh, servers, reloadServers, noteServerCall } = useJob();
  const { serverId, library, queue, filter } = spec.source;
  const server = servers.find((s) => s.id === serverId) ?? null;
  const [open, setOpen] = useState(false);
  const [listed, setListed] = useState<{ key: string; files: SpooledFileView[] } | null>(null);
  // Why the list in the popover could not be loaded.
  const [listError, setListError] = useState<{ key: string; error: ShownError } | null>(null);
  // Why picking a file failed, and how to try again.
  const [error, setError] = useState<{ error: ShownError; retry(): void } | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = !!serverId && !!library && !!queue;
  const sourceKey = `${serverId}/${library}/${queue}?${filterParams(filter)}`;

  /** Lists the source queue. What the call came to shows on the server's status. */
  async function list(limit: number): Promise<SpooledFileView[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    filterParams(filter, params);
    try {
      const data = await api<{ files: SpooledFileView[] }>(
        `/api/servers/${serverId}/queues/${encodeURIComponent(library)}/${encodeURIComponent(queue)}/files?${params}`,
      );
      noteServerCall(serverId!, null);
      return data.files;
    } catch (err) {
      noteServerCall(serverId!, shownError(err));
      throw err;
    }
  }

  async function pick(file: SpooledFileView) {
    setBusy(true);
    setError(null);
    setOpen(false);
    try {
      // The server makes the file the draft's preview; fetch the draft again.
      await api<{ sample: SampleView }>(`/api/jobs/${job.id}/preview-sample`, { method: 'POST', body: { splf: idOf(file) } });
      await refresh();
    } catch (err) {
      const shown = shownError(err);
      // Reading the file failed on the server's connection: its status says so too.
      if (serverId && (shown.code === 'host' || shown.code === 'auth')) noteServerCall(serverId, shown);
      setError({ error: shown, retry: () => void pick(file) });
    } finally {
      setBusy(false);
    }
  }

  // Load the list each time it opens.
  const [opened, setOpened] = useState(0);
  const listKey = `${sourceKey}#${opened}`;
  const files = listed?.key === listKey ? listed.files : null;
  const shownListError = listError?.key === listKey ? listError.error : null;
  useEffect(() => {
    if (!open || !ready) return;
    let cancelled = false;
    list(100).then(
      (rows) => !cancelled && setListed({ key: listKey, files: rows }),
      (err) => !cancelled && setListError({ key: listKey, error: shownError(err) }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- list reads the same source the key names
  }, [open, listKey]);

  // Pick the newest file once the queue is set and nothing is picked yet.
  const tried = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!ready || spec.preview.sampleId || tried.current === sourceKey) return;
    tried.current = sourceKey;
    list(1).then(
      (rows) => rows[0] && void pick(rows[0]),
      (err) =>
        setError({
          error: shownError(err),
          retry: () => {
            setError(null);
            tried.current = null;
            setAttempt((n) => n + 1);
          },
        }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per source, and again on Try again or Reconnect
  }, [ready, spec.preview.sampleId, sourceKey, attempt]);

  const current = sample ? `${sample.splf.name} #${sample.splf.number}` : null;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) setOpened((n) => n + 1);
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            disabled={!ready || busy}
            title={
              sample
                ? `Saved copy from ${dateTime(sample.capturedAt)}: ${sample.pages.length} ${sample.pages.length === 1 ? 'page' : 'pages'}, ${sample.attributes.pageWidth}x${sample.attributes.pageLength}, CCSID ${sample.codePage}`
                : undefined
            }
            className="min-w-0 max-w-72 justify-between font-normal"
          >
            {busy ? <Spinner /> : <FileTextIcon />}
            <span className="truncate">{current ?? (ready ? 'Pick a spooled file' : 'Set the source first')}</span>
            {sample && <span className="shrink-0 text-muted-foreground">saved copy</span>}
            <ChevronsUpDownIcon className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[26rem] max-w-[calc(100vw-2rem)] p-0" align="start">
          {sample && (
            <p className="border-b px-3 py-2 text-muted-foreground text-xs">
              A copy of {current} saved {dateTime(sample.capturedAt)}. It stays when the file leaves the queue. Pick a file to
              save a new copy.
            </p>
          )}
          <Command>
            <CommandInput placeholder="Search by name, job or user data" />
            <CommandList>
              {files === null && !shownListError && (
                <Loading className="p-3">Loading spooled files...</Loading>
              )}
              {shownListError && (
                <ServerErrorNote
                  className="m-2"
                  error={shownListError}
                  server={server}
                  onRetry={() => {
                    reloadServers();
                    setOpened((n) => n + 1);
                  }}
                />
              )}
              {files !== null && (
                <CommandEmpty>{files.length === 0 ? `${library}/${queue} has no spooled files.` : 'No spooled file matches.'}</CommandEmpty>
              )}
              <CommandGroup heading={files?.length ? `${library}/${queue}, newest first` : undefined}>
                {files?.map((file) => (
                  <CommandItem
                    key={splfKey(file)}
                    value={`${splfKey(file)} ${file.attributes.userData}`}
                    onSelect={() => void pick(file)}
                    className="flex-col items-start gap-0"
                  >
                    <span className="font-mono text-xs">
                      {file.name} #{file.number}
                      <span className="text-muted-foreground"> {file.status}</span>
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {file.attributes.created.replace('T', ' ')}, {file.attributes.pages} p
                      {file.attributes.userData ? `, ${file.attributes.userData}` : ''}, job {file.jobNumber}/{file.jobUser}/{file.jobName}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error && (
        <ServerErrorNote
          className="py-1 text-xs"
          error={error.error}
          server={server}
          onRetry={() => {
            reloadServers();
            error.retry();
          }}
        />
      )}
    </div>
  );
}
