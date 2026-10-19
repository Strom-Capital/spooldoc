'use client';

import { CircleAlertIcon, PauseIcon, PlayIcon, RadioIcon, Trash2Icon, WorkflowIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, Loading } from '@/components/empty-state';
import { ErrorNote, Page } from '@/components/page';
import { RunStatusBadge } from '@/components/run-status';
import { Button } from '@/components/ui/button';
import { api, errorText } from '@/lib/client/api';
import { pollWhileVisible } from '@/lib/client/poll';
import { ago } from '@/lib/client/format';
import type { JobSummary } from '@/lib/types';
import { NewJobButton } from './new-job-button';

/** The job list: source, mode, active version and last run, with pause and resume. */
export function JobsPage() {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setJobs((await api<{ jobs: JobSummary[] }>('/api/jobs')).jobs);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchJobs = () =>
      api<{ jobs: JobSummary[] }>('/api/jobs').then(
        (data) => !cancelled && (setJobs(data.jobs), setError(null)),
        (err) => !cancelled && setError(errorText(err)),
      );
    void fetchJobs();
    const stop = pollWhileVisible(() => void fetchJobs(), 15_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  async function setPaused(job: JobSummary, paused: boolean) {
    try {
      await api(`/api/jobs/${job.id}`, { method: 'PATCH', body: { paused } });
      toast.success(paused ? `Paused ${job.name}` : `Resumed ${job.name}`);
      await load();
    } catch (err) {
      toast.error(paused ? `Could not pause ${job.name}` : `Could not resume ${job.name}`, { description: errorText(err) });
    }
  }

  return (
    <Page
      title="Jobs"
      description="A job turns the spooled files of one output queue into documents and delivers them."
      actions={<NewJobButton onError={setError} />}
    >
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      {jobs === null && !error && (
        <Loading>Loading jobs...</Loading>
      )}
      {jobs?.length === 0 && (
        <EmptyState icon={WorkflowIcon} title="No jobs yet" description="Start one here, or from a queue on the Queues page.">
          <NewJobButton onError={setError} />
        </EmptyState>
      )}
      {jobs && jobs.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Job</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Mode</th>
                <th className="px-3 py-2 font-medium">Version</th>
                <th className="px-3 py-2 font-medium">Last run</th>
                <th className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-t align-top hover:bg-muted/40">
                  <td className="px-3 py-2.5">
                    <Link href={`/jobs/${job.id}`} className="font-medium text-primary hover:underline">
                      {job.name}
                    </Link>
                    {job.broken && (
                      <div className="flex max-w-xs items-start gap-1 text-destructive text-xs" title={job.broken}>
                        <CircleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden />
                        <span className="line-clamp-2">{job.broken}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {job.source.queue ? (
                      <>
                        <div>{job.source.serverName ?? 'Unknown server'}</div>
                        <div className="font-mono text-muted-foreground text-xs">
                          {job.source.library}/{job.source.queue}
                        </div>
                        {job.finish === 'delete' && job.activeVersion !== null && (
                          <div className="mt-0.5 inline-flex items-center gap-1 text-destructive text-xs">
                            <Trash2Icon className="size-3" aria-hidden />
                            Deletes spooled files after delivery
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">Not set</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {job.mode === 'watch' ? (
                      <>
                        <span className="inline-flex items-center gap-1">
                          <RadioIcon className="size-3.5" aria-hidden />
                          {job.paused ? 'Paused' : 'Watching'}
                        </span>
                        {job.lastWatchError ? (
                          <div className="max-w-xs truncate text-destructive text-xs" title={job.lastWatchError}>
                            {job.lastWatchError}
                          </div>
                        ) : job.lastWatchAt ? (
                          <div className="text-muted-foreground text-xs">Checked {ago(job.lastWatchAt)}</div>
                        ) : null}
                      </>
                    ) : (
                      <span>On demand</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {job.activeVersion !== null ? `v${job.activeVersion}` : <span className="text-muted-foreground">Draft only</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {job.lastRun ? (
                      <Link href={`/runs?job=${job.id}`} className="hover:underline">
                        <RunStatusBadge status={job.lastRun.status} />
                        <div className="text-muted-foreground text-xs">
                          #{job.lastRun.seq}, {ago(job.lastRun.startedAt)}
                        </div>
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Never</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1">
                      {job.mode === 'watch' && (
                        <Button variant="ghost" size="sm" onClick={() => setPaused(job, !job.paused)}>
                          {job.paused ? <PlayIcon /> : <PauseIcon />}
                          {job.paused ? 'Resume' : 'Pause'}
                        </Button>
                      )}
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/jobs/${job.id}`}>Open</Link>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
