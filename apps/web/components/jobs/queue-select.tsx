'use client';

import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Loading } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api, shownError, type ShownError } from '@/lib/client/api';
import type { QueueView } from '@/lib/types';

/** The visible output queues of a server, loaded once per server. */
export function useQueues(serverId: string | null): { queues: QueueView[] | null; error: ShownError | null } {
  const [state, setState] = useState<{ serverId: string | null; queues: QueueView[] | null; error: ShownError | null }>({
    serverId: null,
    queues: null,
    error: null,
  });
  useEffect(() => {
    if (!serverId) {
      return;
    }
    let cancelled = false;
    api<{ queues: QueueView[] }>(`/api/servers/${serverId}/queues?visible=1`).then(
      (data) => !cancelled && setState({ serverId, queues: data.queues, error: null }),
      (err) => !cancelled && setState({ serverId, queues: null, error: shownError(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [serverId]);
  return state.serverId === serverId ? state : { queues: null, error: null };
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
  const { queues, error } = useQueues(open || value ? serverId : null);
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
            {error && <p className="p-3 text-destructive text-sm">{error.message}</p>}
            <CommandEmpty>No queue matches.</CommandEmpty>
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
