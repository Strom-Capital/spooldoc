'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Page } from '@/components/page';
import { ServerErrorNote } from '@/components/server-status';
import { Input } from '@/components/ui/input';
import { EyeIcon, InboxIcon, RefreshCwIcon, SearchXIcon, XIcon } from 'lucide-react';
import { SkeletonRows } from '@/components/skeleton-rows';
import { SpoolFileDialog } from '@/components/spool-file-dialog';
import { TableEmpty } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { api, errorText, isAbort, shownError, type ShownError } from '@/lib/client/api';
import { SPOOLED_FILE_LIST, type SpooledFileView } from '@/lib/types';
import { cn } from '@/lib/utils';
import { NewJobButton } from './new-job-button';

const key = (f: SpooledFileView) => `${f.jobNumber}/${f.jobUser}/${f.jobName}/${f.name}/${f.number}`;

/**
 * The spooled files of one output queue: Refresh and New job in the header, "contains"
 * filters on the name and user data, and the table with its loading and empty states.
 * The newest 200 files show first; when there are more, the page says so and Load more
 * lists 200 more, up to 5000.
 */
export function QueueFilesPage({
  serverId,
  serverName,
  library,
  queue,
}: {
  serverId: string;
  serverName: string;
  library: string;
  queue: string;
}) {
  const [name, setName] = useState('');
  const [userData, setUserData] = useState('');
  const [job, setJob] = useState('');
  const [files, setFiles] = useState<SpooledFileView[] | null>(null);
  const [more, setMore] = useState(false);
  const [limit, setLimit] = useState<number>(SPOOLED_FILE_LIST.page);
  // Load more keeps the filters and toasts nothing; new filters start from the first page.
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [viewing, setViewing] = useState<SpooledFileView | null>(null);
  // Refresh and Check again keep what is on screen and report the answer in a toast.
  const [checking, setChecking] = useState(false);
  const reportFor = useRef<number | null>(null);
  const filtered = !!(name.trim() || userData.trim() || job.trim());

  useEffect(() => {
    const controller = new AbortController();
    const report = reportFor.current === nonce;
    const timer = setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (name.trim()) params.set('name', name.trim());
      if (userData.trim()) params.set('userData', userData.trim());
      if (job.trim()) params.set('job', job.trim());
      params.set('limit', String(limit));
      try {
        const data = await api<{ files: SpooledFileView[]; more: boolean }>(
          `/api/servers/${serverId}/queues/${encodeURIComponent(library)}/${encodeURIComponent(queue)}/files?${params}`,
          { signal: controller.signal },
        );
        setFiles(data.files);
        setMore(data.more);
        setError(null);
        if (report) {
          reportFor.current = null;
          setChecking(false);
          const n = data.files.length;
          const what = `${n} ${n === 1 ? 'spooled file' : 'spooled files'}`;
          if (n > 0) toast.success(filtered ? `${what} match the filters` : `${what} on ${library}/${queue}`);
          else if (filtered) toast.info('No spooled files match the filters');
          else
            toast.info(`${library}/${queue} is still empty`, {
              description: 'No spooled files have arrived yet.',
            });
        }
      } catch (err) {
        if (!isAbort(err)) {
          if (report) {
            reportFor.current = null;
            setChecking(false);
            toast.error(`Could not check ${library}/${queue}`, {
              description: errorText(err),
            });
          }
          setError(shownError(err));
          setFiles(null);
          setMore(false);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `filtered` follows name and userData, which are dependencies already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, library, queue, name, userData, job, nonce, limit]);

  /** Change a filter; new filters list from the newest files again. */
  const filterBy = (set: (value: string) => void) => (value: string) => {
    set(value);
    setLimit(SPOOLED_FILE_LIST.page);
  };

  const loadMore = () => {
    setLoadingMore(true);
    setLimit((current) => Math.min(current + SPOOLED_FILE_LIST.page, SPOOLED_FILE_LIST.max));
  };

  const refresh = useCallback(() => {
    reportFor.current = nonce + 1;
    setChecking(true);
    setNonce(nonce + 1);
  }, [nonce]);

  const refreshButton = (label: string, busyLabel: string, variant: 'outline' | 'ghost' = 'outline') => (
    <Button variant={variant} disabled={loading} onClick={refresh}>
      <RefreshCwIcon className={cn(loading && checking && 'animate-spin')} />
      {loading && checking ? busyLabel : label}
    </Button>
  );

  return (
    <Page
      back={{ href: `/queues?server=${serverId}`, label: 'Queues' }}
      title={
        <span className="font-mono">
          {library}/{queue}
        </span>
      }
      description={
        <>
          Spooled files on{' '}
          <Link href="/servers" className="hover:underline">
            {serverName}
          </Link>
          , newest first.
        </>
      }
      actions={
        <>
          {refreshButton('Refresh', 'Refreshing...')}
          <NewJobButton source={{ serverId, library, queue }} label="New job from this queue" />
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Input
            value={name}
            onChange={(event) => filterBy(setName)(event.target.value)}
            placeholder="Name contains"
            aria-label="Spooled file name contains"
            title="Shows spooled files whose name contains this text"
            className="w-48"
            spellCheck={false}
          />
          <Input
            value={job}
            onChange={(event) => filterBy(setJob)(event.target.value)}
            placeholder="Job contains"
            aria-label="Job contains"
            title="Shows spooled files whose job (number/user/name) contains this text"
            className="w-48"
            spellCheck={false}
          />
          <Input
            value={userData}
            onChange={(event) => filterBy(setUserData)(event.target.value)}
            placeholder="User data contains"
            aria-label="User data contains"
            title="Shows spooled files whose user data contains this text"
            className="w-48"
            spellCheck={false}
          />
        </div>
        {error && <ServerErrorNote error={error} server={{ id: serverId, name: serverName }} onRetry={() => setNonce((n) => n + 1)} />}
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 text-right font-medium">Number</th>
                <th className="px-3 py-2 font-medium">Job</th>
                <th className="px-3 py-2 font-medium">User data</th>
                <th className="px-3 py-2 text-right font-medium">Pages</th>
                <th className="px-3 py-2 font-medium">Width x length</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2">
                  <span className="sr-only">View</span>
                </th>
              </tr>
            </thead>
            <tbody aria-busy={loading} className={cn(loading && !!files?.length && 'opacity-60 transition-opacity')}>
              {!files && !error && <SkeletonRows widths={['w-20', 'ml-auto w-8', 'w-36', 'w-16', 'ml-auto w-6', 'w-16', 'w-12', 'w-32', 'ml-auto w-14']} />}
              {files?.map((file) => (
                <tr key={key(file)} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setViewing(file)}>
                  <td className="px-3 py-2 font-medium font-mono text-xs">{file.name}</td>
                  <td className="tabular px-3 py-2 text-right">{file.number}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {file.jobNumber}/{file.jobUser}/{file.jobName}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{file.attributes.userData}</td>
                  <td className="tabular px-3 py-2 text-right">{file.attributes.pages}</td>
                  <td className="tabular px-3 py-2">
                    {file.attributes.pageWidth} x {file.attributes.pageLength}
                  </td>
                  <td className="px-3 py-2">{file.status}</td>
                  <td className="tabular whitespace-nowrap px-3 py-2 text-muted-foreground">{file.attributes.created.replace('T', ' ')}</td>
                  <td className="px-2 py-1 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        setViewing(file);
                      }}
                    >
                      <EyeIcon />
                      View
                    </Button>
                  </td>
                </tr>
              ))}
              {files?.length === 0 &&
                (!loading || checking) &&
                (filtered ? (
                  <TableEmpty
                    colSpan={9}
                    icon={SearchXIcon}
                    title="No spooled files match"
                    description="Nothing on this queue matches the filters."
                  >
                    <Button
                      variant="outline"
                      onClick={() => {
                        setName('');
                        setUserData('');
                        setJob('');
                        setLimit(SPOOLED_FILE_LIST.page);
                      }}
                    >
                      <XIcon />
                      Clear filters
                    </Button>
                  </TableEmpty>
                ) : (
                  <TableEmpty
                    colSpan={9}
                    icon={InboxIcon}
                    title={`${library}/${queue} is empty`}
                    description="When a program prints to this queue, its spooled files show up here. A job that watches the queue turns each new one into documents."
                  >
                    {refreshButton('Check again', 'Checking...')}
                    <NewJobButton source={{ serverId, library, queue }} label="New job for this queue" />
                  </TableEmpty>
                ))}
            </tbody>
          </table>
        </div>
        {files && more && (
          <div className="flex flex-wrap items-center gap-3 text-muted-foreground text-sm">
            <span>
              Showing the newest {files.length} {filtered ? 'matching ' : ''}spooled files. There are more on the queue.
              {limit >= SPOOLED_FILE_LIST.max && ' Narrow the filters to find older ones.'}
            </span>
            {limit < SPOOLED_FILE_LIST.max && (
              <Button variant="outline" size="sm" disabled={loading} onClick={loadMore}>
                {loadingMore && <RefreshCwIcon className="animate-spin" />}
                {loadingMore ? 'Loading...' : `Load ${SPOOLED_FILE_LIST.page} more`}
              </Button>
            )}
          </div>
        )}
      </div>
      {viewing && (
        <SpoolFileDialog server={{ id: serverId, name: serverName }} library={library} queue={queue} file={viewing} onClose={() => setViewing(null)} />
      )}
    </Page>
  );
}
