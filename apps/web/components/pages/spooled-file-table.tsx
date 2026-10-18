'use client';

import { useEffect, useState } from 'react';
import { ErrorNote } from '@/components/page';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText, isAbort } from '@/lib/client/api';
import type { SpooledFileView } from '@/lib/types';

const key = (f: SpooledFileView) => `${f.jobNumber}/${f.jobUser}/${f.jobName}/${f.name}/${f.number}`;

/** The spooled files of a queue with name and user data filters. */
export function SpooledFileTable({ serverId, library, queue }: { serverId: string; library: string; queue: string }) {
  const [name, setName] = useState('');
  const [userData, setUserData] = useState('');
  const [files, setFiles] = useState<SpooledFileView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (name.trim()) params.set('name', name.trim());
      if (userData.trim()) params.set('userData', userData.trim());
      try {
        const data = await api<{ files: SpooledFileView[] }>(
          `/api/servers/${serverId}/queues/${encodeURIComponent(library)}/${encodeURIComponent(queue)}/files?${params}`,
          { signal: controller.signal },
        );
        setFiles(data.files);
        setError(null);
      } catch (err) {
        if (!isAbort(err)) {
          setError(errorText(err));
          setFiles(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [serverId, library, queue, name, userData]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Spooled file name"
          aria-label="Filter by spooled file name"
          className="w-48"
          spellCheck={false}
        />
        <Input
          value={userData}
          onChange={(event) => setUserData(event.target.value)}
          placeholder="User data"
          aria-label="Filter by user data"
          className="w-40"
          spellCheck={false}
        />
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
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
            </tr>
          </thead>
          <tbody>
            {files?.map((file) => (
              <tr key={key(file)} className="border-t hover:bg-muted/40">
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
                <td className="tabular whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {file.attributes.created.replace('T', ' ')}
                </td>
              </tr>
            ))}
            {files?.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  No spooled files match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {loading && (
          <div className="flex items-center gap-2 border-t px-3 py-3 text-muted-foreground text-sm">
            <Spinner /> Loading spooled files...
          </div>
        )}
      </div>
    </div>
  );
}
