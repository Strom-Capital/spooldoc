'use client';

import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Loading } from '@/components/empty-state';
import { ServerErrorNote } from '@/components/server-status';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api, shownError, type ShownError } from '@/lib/client/api';
import type { QueueView } from '@/lib/types';
import { useJob } from './job-provider';

/**
 * The visible output queues of a server, loaded once per server, and again on `reload`.
 * What the call came to shows on the server's status in the job builder.
 */
export function useQueues(serverId: string | null): { queues: QueueView[] | null; error: ShownError | null; reload(): void } {
  const [state, setState] = useState<{ serverId: string | null; queues: QueueView[] | null; error: ShownError | null }>({
    serverId: null,
    queues: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const { noteServerCall } = useJob();
  const reload = useCallback(() => {
    setState((current) => ({ ...current, queues: null, error: null }));
    setAttempt((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!serverId) {
      return;
    }
    let cancelled = false;
    api<{ queues: QueueView[] }>(`/api/servers/${serverId}/queues?visible=1`).then(
      (data) => {
        noteServerCall(serverId, null);
        if (!cancelled) setState({ serverId, queues: data.queues, error: null });
      },
      (err) => {
        const error = shownError(err);
        noteServerCall(serverId, error);
        if (!cancelled) setState({ serverId, queues: null, error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [serverId, attempt, noteServerCall]);
  return state.serverId === serverId ? { ...state, reload } : { queues: null, error: null, reload };
}

/** Pick an output queue of a server, searchable. Hidden queues are left out. */
export function QueueSelect({
  serverId,
  value,
  onChange,
  disabled,
  id,
}: {
  serverId: string | null;
  value: { library: string; name: string } | null;
  onChange(queue: QueueView): void;
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const { servers, reloadServers } = useJob();
  const { queues, error, reload } = useQueues(open || value ? serverId : null);
  const server = servers.find((s) => s.id === serverId) ?? null;
  const label = value?.library && value.name ? `${value.library}/${value.name}` : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} variant="outline" role="combobox" aria-expanded={open} disabled={disabled || !serverId} className="w-full justify-between font-normal sm:w-72">
          <span className={label ? 'font-mono' : 'text-muted-foreground'}>{label ?? 'Pick an output queue'}</span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search queues" />
          <CommandList>
            {queues === null && !error && (
              <Loading className="p-3">Loading queues...</Loading>
            )}
            {error && (
              <ServerErrorNote
                className="m-2"
                error={error}
                server={server}
                onRetry={() => {
                  reloadServers();
                  reload();
                }}
              />
            )}
            {!error && <CommandEmpty>No queue matches.</CommandEmpty>}
            <CommandGroup>
              {queues?.map((queue) => {
                const key = `${queue.library}/${queue.name}`;
                return (
                  <CommandItem
                    key={key}
                    value={`${key} ${queue.text}`}
                    onSelect={() => {
                      onChange(queue);
                      setOpen(false);
                    }}
                  >
                    <CheckIcon className={label === key ? 'opacity-100' : 'opacity-0'} />
                    <span className="font-mono text-xs">{key}</span>
                    <span className="ml-auto truncate text-muted-foreground text-xs">{queue.files} files</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
