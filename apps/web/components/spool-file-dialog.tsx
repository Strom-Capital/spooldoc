'use client';

import { TriangleAlertIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ErrorNote } from '@/components/page';
import { SpoolViewer } from '@/components/spool-viewer';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText } from '@/lib/client/api';
import type { SampleView } from '@/lib/client/render';
import type { SpooledFileView } from '@/lib/types';

type Loaded = { sample: SampleView; warnings: string[] } | { error: string };

/** The pages of a spooled file on a queue, read from the IBM i when opened. Reading changes nothing on the queue. */
export function SpoolFileDialog({
  serverId,
  library,
  queue,
  file,
  onClose,
}: {
  serverId: string;
  library: string;
  queue: string;
  file: SpooledFileView;
  onClose(): void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ splf: file.name, number: String(file.number), jobName: file.jobName, jobUser: file.jobUser, jobNumber: file.jobNumber });
    api<{ sample: SampleView; warnings: string[] }>(`/api/servers/${serverId}/queues/${encodeURIComponent(library)}/${encodeURIComponent(queue)}/files/view?${query}`, {
      signal: controller.signal,
    }).then(
      (data) => setLoaded(data),
      (err) => !controller.signal.aborted && setLoaded({ error: errorText(err) }),
    );
    return () => controller.abort();
  }, [serverId, library, queue, file]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="border-b px-4 pt-4 pb-3 pr-12">
          <DialogTitle className="font-mono">
            {file.name} #{file.number}
          </DialogTitle>
          <DialogDescription>
            Job {file.jobNumber}/{file.jobUser}/{file.jobName}
            {file.attributes.userData && `, user data ${file.attributes.userData}`}, {file.attributes.pages} {file.attributes.pages === 1 ? 'page' : 'pages'},{' '}
            {file.attributes.created.replace('T', ' ')}
          </DialogDescription>
        </DialogHeader>
        {loaded === null && (
          <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground text-sm">
            <Spinner /> Reading the spooled file...
          </div>
        )}
        {loaded && 'error' in loaded && <ErrorNote className="m-4">{loaded.error}</ErrorNote>}
        {loaded && 'sample' in loaded && (
          <>
            {loaded.warnings.length > 0 && (
              <ul className="flex flex-col gap-1 border-b bg-amber-500/10 px-4 py-2 text-amber-800 text-xs dark:text-amber-300">
                {loaded.warnings.map((warning) => (
                  <li key={warning} className="flex items-start gap-2">
                    <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {warning}
                  </li>
                ))}
              </ul>
            )}
            <div className="min-h-0 flex-1">
              <SpoolViewer pages={loaded.sample.pages} width={loaded.sample.attributes.pageWidth || 132} page={page} onPage={setPage} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
