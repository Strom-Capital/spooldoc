'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ServerView } from '@/lib/types';

/** Pick one of the saved servers. */
export function ServerSelect({
  servers,
  value,
  onChange,
  id,
  className,
}: {
  servers: ServerView[];
  value: string | null;
  onChange(id: string): void;
  id?: string;
  className?: string;
}) {
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger id={id} className={className ?? 'w-64'} aria-label="Server">
        <SelectValue placeholder="Pick a server" />
      </SelectTrigger>
      <SelectContent>
        {servers.map((server) => (
          <SelectItem key={server.id} value={server.id}>
            {server.name}
            <span className="text-muted-foreground"> ({server.host})</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
