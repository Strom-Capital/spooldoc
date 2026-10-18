'use client';

import { ChevronsUpDownIcon, FileTextIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText } from '@/lib/client/api';
import { splfKey } from '@/lib/job-spec';
import type { SampleView } from '@/lib/client/render';
import type { SpooledFileView } from '@/lib/types';
import { useJob } from './job-provider';

const idOf = (f: SpooledFileView) => ({ name: f.name, number: f.number, jobName: f.jobName, jobUser: f.jobUser, jobNumber: f.jobNumber });

/**
 * The spooled file the definition and template are tried on: a searchable list of the
 * source queue's files. Picking one reads it from the IBM i; it is never held, moved
 * or deleted. Once the queue is set, the newest file is picked when none is.
 */
export function PreviewPicker({ sample }: { sample: SampleView | null }) {
  const { job, spec, refresh } = useJob();
  const { serverId, library, queue, filter } = spec.source;
  const [open, setOpen] = useState(false);
  const [listed, setListed] = useState<{ key: string; files: SpooledFileView[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = !!serverId && !!library && !!queue;
  const sourceKey = `${serverId}/${library}/${queue}/${filter.splf}/${filter.userData}`;

  async function list(limit: number): Promise<SpooledFileView[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (filter.splf) params.set('name', filter.splf);
    if (filter.userData) params.set('userData', filter.userData);
    const data = await api<{ files: SpooledFileView[] }>(
      `/api/servers/${serverId}/queues/${encodeURIComponent(library)}/${encodeURIComponent(queue)}/files?${params}`,
    );
    return data.files;
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
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  // Load the list each time it opens.
  const [opened, setOpened] = useState(0);
  const listKey = `${sourceKey}#${opened}`;
  const files = listed?.key === listKey ? listed.files : null;
  useEffect(() => {
    if (!open || !ready) return;
    let cancelled = false;
    list(100).then(
      (rows) => !cancelled && setListed({ key: listKey, files: rows }),
      (err) => !cancelled && setError(errorText(err)),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- list reads the same source the key names
  }, [open, listKey]);

  // Pick the newest file once the queue is set and nothing is picked yet.
  const tried = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || spec.preview.sampleId || tried.current === sourceKey) return;
    tried.current = sourceKey;
    list(1).then(
      (rows) => rows[0] && void pick(rows[0]),
      (err) => setError(errorText(err)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per source
  }, [ready, spec.preview.sampleId, sourceKey]);

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
          <Button variant="outline" size="sm" role="combobox" aria-expanded={open} disabled={!ready || busy} className="min-w-0 max-w-72 justify-between font-normal">
            {busy ? <Spinner /> : <FileTextIcon />}
            <span className="truncate">{current ?? (ready ? 'Pick a spooled file' : 'Set the source first')}</span>
            <ChevronsUpDownIcon className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[26rem] max-w-[calc(100vw-2rem)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search by name, job or user data" />
            <CommandList>
              {files === null && !error && (
                <div className="flex items-center gap-2 p-3 text-muted-foreground text-sm">
                  <Spinner /> Loading spooled files...
                </div>
              )}
              <CommandEmpty>No spooled file matches.</CommandEmpty>
              <CommandGroup heading={`${library}/${queue}, newest first`}>
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
      {sample && (
        <span className="hidden truncate text-muted-foreground text-xs lg:inline">
          {sample.pages.length} {sample.pages.length === 1 ? 'page' : 'pages'}, {sample.attributes.pageWidth}x{sample.attributes.pageLength}, CCSID {sample.codePage}
        </span>
      )}
      {error && (
        <span role="alert" className="truncate text-destructive text-xs" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
