'use client';

import { CheckIcon, DownloadIcon, RotateCcwIcon, ScrollTextIcon, XIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyNote, ErrorNote, Page } from '@/components/page';
import { RunStatusBadge } from '@/components/run-status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText } from '@/lib/client/api';
import { bytes, dateTime, duration, splfLabel } from '@/lib/client/format';
import type { JobSummary, RunStatus, RunView } from '@/lib/types';
import { cn } from '@/lib/utils';

const selectClass = 'h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30';

const STEP_LABEL: Record<string, string> = { capture: 'Capture', extract: 'Extract', render: 'Render', deliver: 'Deliver', finish: 'Finish' };

const RETRIED: Record<RunStatus, string> = { running: 'started', success: 'succeeded', warning: 'done with warnings', failed: 'failed', skipped: 'skipped' };

function runDuration(run: RunView): string {
  return run.finishedAt ? duration(new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) : '';
}

/** The job log: every run, filtered by job, status and date, newest first. */
export function RunsPage({ job, status, from, to }: { job: string; status: string; from: string; to: string }) {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [page, setPage] = useState<{ query: string; runs: RunView[]; next: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<RunView | null>(null);

  const query = useCallback(
    (before?: number) => {
      const params = new URLSearchParams();
      if (job) params.set('job', job);
      if (status) params.set('status', status);
      if (from) params.set('from', new Date(`${from}T00:00:00`).toISOString());
      if (to) params.set('to', new Date(`${to}T23:59:59`).toISOString());
      if (before) params.set('before', String(before));
      return `/api/runs?${params}`;
    },
    [job, status, from, to],
  );

  const current = query();
  const runs = page?.query === current ? page.runs : null;
  const next = page?.query === current ? page.next : null;

  const load = useCallback(async () => {
    try {
      const data = await api<{ runs: RunView[]; next: number | null }>(current);
      setPage({ query: current, ...data });
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [current]);

  useEffect(() => {
    api<{ jobs: JobSummary[] }>('/api/jobs').then((data) => setJobs(data.jobs), () => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchRuns = () =>
      api<{ runs: RunView[]; next: number | null }>(current).then(
        (data) => !cancelled && (setPage((prev) => (prev?.query === current && prev.runs.length > data.runs.length ? prev : { query: current, ...data })), setError(null)),
        (err) => !cancelled && setError(errorText(err)),
      );
    void fetchRuns();
    const timer = setInterval(() => void fetchRuns(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [current]);

  function setFilter(name: string, value: string) {
    const params = new URLSearchParams({ job, status, from, to });
    params.set(name, value);
    for (const [key, v] of [...params]) if (!v) params.delete(key);
    router.replace(`/runs${params.size ? `?${params}` : ''}`);
  }

  async function more() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const data = await api<{ runs: RunView[]; next: number | null }>(query(next));
      setPage((prev) => ({ query: current, runs: [...(prev?.runs ?? []), ...data.runs], next: data.next }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoadingMore(false);
    }
  }

  async function retry(run: RunView) {
    try {
      const fresh = await api<RunView>(`/api/runs/${run.id}/retry`, { method: 'POST' });
      const text = `Run #${fresh.seq}: ${RETRIED[fresh.status]}`;
      if (fresh.status === 'failed') toast.error(text, { description: fresh.error ?? undefined });
      else if (fresh.status === 'warning') toast.warning(text);
      else toast.success(text);
      setOpen(fresh);
      await load();
    } catch (err) {
      toast.error(`Could not retry run #${run.seq}`, { description: errorText(err) });
    }
  }

  const filtered = !!(job || status || from || to);

  return (
    <Page className="max-w-7xl" title="Job log" description="Every run of every job: what was read, what was delivered and what failed.">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-job" className="text-xs">
            Job
          </Label>
          <select id="filter-job" value={job} onChange={(event) => setFilter('job', event.target.value)} className={`${selectClass} w-56`}>
            <option value="">All jobs</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-status" className="text-xs">
            Status
          </Label>
          <select id="filter-status" value={status} onChange={(event) => setFilter('status', event.target.value)} className={`${selectClass} w-36`}>
            <option value="">Any status</option>
            <option value="success">Success</option>
            <option value="warning">Warning</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
            <option value="running">Running</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-from" className="text-xs">
            From
          </Label>
          <Input id="filter-from" type="date" value={from} onChange={(event) => setFilter('from', event.target.value)} className="w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-to" className="text-xs">
            To
          </Label>
          <Input id="filter-to" type="date" value={to} onChange={(event) => setFilter('to', event.target.value)} className="w-40" />
        </div>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => router.replace('/runs')}>
            <XIcon />
            Clear filters
          </Button>
        )}
      </div>
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      {runs === null && !error && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Spinner /> Loading runs...
        </div>
      )}
      {runs?.length === 0 && (
        <EmptyNote>
          <ScrollTextIcon className="mx-auto mb-2 size-6" aria-hidden />
          {filtered ? 'No runs match the filters.' : 'No runs yet. Use Run now in a job, or let a watching job pick up a spooled file.'}
        </EmptyNote>
      )}
      {runs && runs.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Run</th>
                <th className="px-3 py-2 font-medium">Job</th>
                <th className="px-3 py-2 font-medium">Spooled file</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Documents</th>
                <th className="px-3 py-2 font-medium">Files</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="cursor-pointer border-t align-top hover:bg-muted/40" onClick={() => setOpen(run)}>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="font-medium">#{run.seq}</div>
                    <div className="text-muted-foreground text-xs">{dateTime(run.startedAt)}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/jobs/${run.jobId}`} onClick={(event) => event.stopPropagation()} className="text-primary hover:underline">
                      {run.jobName}
                    </Link>
                    <div className="text-muted-foreground text-xs">
                      v{run.version}, {run.trigger === 'watch' ? 'watcher' : 'Run now'}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {run.splf.name} #{run.splf.number}
                    <div className="text-muted-foreground">
                      {run.splf.jobNumber}/{run.splf.jobUser}/{run.splf.jobName}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <RunStatusBadge status={run.status} />
                    <div className="text-muted-foreground text-xs">{runDuration(run)}</div>
                    {run.error && (
                      <div className={cn('max-w-xs truncate text-xs', run.status === 'skipped' ? 'text-muted-foreground' : 'text-destructive')} title={run.error}>
                        {run.error}
                      </div>
                    )}
                  </td>
                  <td className="tabular px-3 py-2 text-right">{run.documents}</td>
                  <td className="px-3 py-2">
                    <div className="flex max-w-xs flex-wrap gap-x-2 gap-y-0.5">
                      {run.outputs.slice(0, 3).map((output) => (
                        <a
                          key={output.id}
                          href={`/api/runs/${run.id}/files/${output.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex items-center gap-1 text-primary text-xs hover:underline"
                        >
                          <DownloadIcon className="size-3" />
                          {output.name}
                        </a>
                      ))}
                      {run.outputs.length > 3 && <span className="text-muted-foreground text-xs">and {run.outputs.length - 3} more</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={more} disabled={loadingMore}>
            {loadingMore && <Spinner />}
            Show older runs
          </Button>
        </div>
      )}

      <Sheet open={!!open} onOpenChange={(value) => !value && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle>
                  Run #{open.seq} of {open.jobName}
                </SheetTitle>
                <SheetDescription>
                  Version {open.version}, {open.trigger === 'watch' ? 'started by the watcher' : 'started with Run now'}, {dateTime(open.startedAt)}
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-5 px-4 pb-6">
                <div className="flex items-center justify-between gap-2">
                  <RunStatusBadge status={open.status} />
                  {(open.status === 'failed' || open.status === 'warning' || open.status === 'skipped') && (
                    <Button variant="outline" size="sm" onClick={() => retry(open)}>
                      <RotateCcwIcon />
                      Retry
                    </Button>
                  )}
                </div>
                <div>
                  <h3 className="mb-1 font-medium text-sm">Spooled file</h3>
                  <p className="font-mono text-xs">{splfLabel(open.splf)}</p>
                </div>
                {open.error &&
                  (open.status === 'skipped' ? (
                    <p className="rounded-md border bg-muted/40 px-3 py-2 text-muted-foreground text-sm">{open.error}</p>
                  ) : (
                    <ErrorNote>{open.error}</ErrorNote>
                  ))}
                <div>
                  <h3 className="mb-2 font-medium text-sm">Steps</h3>
                  <ol className="flex flex-col gap-1.5">
                    {open.steps.map((step, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm">
                        {step.ok ? <CheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XIcon className="mt-0.5 size-4 shrink-0 text-destructive" />}
                        <div className="min-w-0 flex-1">
                          <span className="font-medium">{STEP_LABEL[step.step] ?? step.step}</span>
                          {step.note && <span className="text-muted-foreground">: {step.note}</span>}
                          {step.error && <div className="break-words text-destructive text-xs">{step.error}</div>}
                        </div>
                        <span className="tabular shrink-0 text-muted-foreground text-xs">{duration(step.ms)}</span>
                      </li>
                    ))}
                    {open.steps.length === 0 && <li className="text-muted-foreground text-sm">{open.status === 'running' ? 'Running...' : 'No steps recorded.'}</li>}
                  </ol>
                </div>
                <div>
                  <h3 className="mb-2 font-medium text-sm">Files</h3>
                  {open.outputs.length === 0 ? (
                    <p className="text-muted-foreground text-sm">None delivered.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {open.outputs.map((output) => (
                        <li key={output.id} className="flex items-center gap-2 text-sm">
                          <a href={`/api/runs/${open.id}/files/${output.id}`} className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline">
                            <DownloadIcon className="size-3.5 shrink-0" />
                            <span className="truncate">{output.name}</span>
                          </a>
                          <a href={`/api/runs/${open.id}/files/${output.id}?inline=1`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground text-xs hover:underline">
                            Open
                          </a>
                          <span className="ml-auto text-muted-foreground text-xs">{bytes(output.size)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Page>
  );
}
