'use client';

import { SearchIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from '@/components/session-provider';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText, isAbort } from '@/lib/client/api';

interface OutputQueue {
  library: string;
  name: string;
  files: number;
  text: string;
}

/** Search box (library or name, debounced) and the matching output queues. */
export function QueueList() {
  const { session } = useSession();
  const [q, setQ] = useState('');
  const [queues, setQueues] = useState<OutputQueue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api<{ queues: OutputQueue[] }>(`/api/queues?q=${encodeURIComponent(q.trim())}`, {
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
  }, [q]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative max-w-sm">
        <SearchIcon className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" aria-hidden />
        <Input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={session?.library ? `Library or queue (default ${session.library})` : 'Library or queue name'}
          aria-label="Search output queues by library or name"
          className="pl-8"
          spellCheck={false}
        />
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Library</th>
              <th className="px-3 py-2 font-medium">Queue</th>
              <th className="px-3 py-2 text-right font-medium">Files</th>
              <th className="px-3 py-2 font-medium">Text</th>
            </tr>
          </thead>
          <tbody>
            {queues?.map((queue) => (
              <tr key={`${queue.library}/${queue.name}`} className="border-t hover:bg-muted/40">
                <td className="px-3 py-2 font-mono text-xs">{queue.library}</td>
                <td className="px-3 py-2">
                  <Link
                    href={`/queues/${encodeURIComponent(queue.library)}/${encodeURIComponent(queue.name)}`}
                    className="font-medium font-mono text-primary text-xs hover:underline"
                  >
                    {queue.name}
                  </Link>
                </td>
                <td className="tabular px-3 py-2 text-right">{queue.files}</td>
                <td className="px-3 py-2 text-muted-foreground">{queue.text}</td>
              </tr>
            ))}
            {queues?.length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  No output queues match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {loading && (
          <div className="flex items-center gap-2 border-t px-3 py-3 text-muted-foreground text-sm">
            <Spinner /> Loading queues...
          </div>
        )}
      </div>
    </div>
  );
}
