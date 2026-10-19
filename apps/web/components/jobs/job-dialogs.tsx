'use client';

import { CheckCircle2Icon, CircleAlertIcon, CircleSlashIcon, PlayIcon, SaveIcon, Trash2Icon, XCircleIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loading } from '@/components/empty-state';
import { ErrorNote } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { api, errorText, shownError, type ShownError } from '@/lib/client/api';
import { deleteNotice, filterParams, splfKey, startsDeleting } from '@/lib/job-spec';
import type { RunView, SpooledFileView } from '@/lib/types';
import { useJob } from './job-provider';

/**
 * Save the draft as the next version, by default the active one. When that makes the job
 * start deleting spooled files, the dialog says so and the save button confirms it.
 */
export function SaveVersionDialog({ open, onClose, onSaved }: { open: boolean; onClose(): void; onSaved?(number: number): void }) {
  const { job, refresh, flush, activeSpec } = useJob();
  const [note, setNote] = useState('');
  const [activate, setActivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  // The server's notice, when it asked for a confirmation the dialog could not tell was needed.
  const [asked, setAsked] = useState<string | null>(null);
  const next = (job.versions[0]?.number ?? 0) + 1;
  // While the active version is loading, whether it deletes is not known; the server asks then.
  const known = job.activeVersion === null || activeSpec !== null;
  const confirming = activate && (asked !== null || (known && startsDeleting(job.draft, activeSpec)));

  async function onSave() {
    setBusy(true);
    setError(null);
    setProblems([]);
    try {
      await flush();
      const response = await fetch(`/api/jobs/${job.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note, activate, confirmDelete: confirming }),
      });
      const data = (await response.json().catch(() => ({}))) as { number?: number; error?: string; problems?: string[]; confirm?: string };
      if (response.status === 409 && data.confirm === 'delete') {
        setAsked(data.error ?? deleteNotice(job.draft));
        return;
      }
      if (!response.ok) {
        setError(data.error ?? `Saving failed (HTTP ${response.status}).`);
        setProblems(data.problems ?? []);
        return;
      }
      await refresh();
      setNote('');
      setAsked(null);
      toast.success(activate ? `Saved version ${data.number ?? next} and made it active` : `Saved version ${data.number ?? next}`);
      onSaved?.(data.number ?? next);
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save version {next}</DialogTitle>
          <DialogDescription>A version is a fixed copy of the job. Runs use the active version; the draft stays editable.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="version-note">Note</Label>
            <Input id="version-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="What changed" maxLength={500} />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="version-activate"
              checked={activate}
              onCheckedChange={(value) => {
                setActivate(value);
                setAsked(null);
              }}
            />
            <Label htmlFor="version-activate" className="font-normal">
              Make it the active version
            </Label>
          </div>
          {confirming && (
            <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive text-sm">
              <Trash2Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {asked ?? deleteNotice(job.draft)} This cannot be undone. Keep it only when the delivered files are the record.
              </span>
            </p>
          )}
          {error && (
            <ErrorNote>
              {error}
              {problems.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              )}
            </ErrorNote>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={confirming ? 'destructive' : 'default'} onClick={onSave} disabled={busy}>
            {busy ? <Spinner /> : confirming ? <Trash2Icon /> : <SaveIcon />}
            {confirming ? 'Save and start deleting' : `Save version ${next}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const idOf = (f: SpooledFileView) => ({ name: f.name, number: f.number, jobName: f.jobName, jobUser: f.jobUser, jobNumber: f.jobNumber });

/**
 * Pick spooled files of the source queue and run the active version on each. By default
 * only ready files this job has not processed are listed. Mount it when it opens, so it
 * starts empty each time.
 */
export function RunNowDialog({ open, onClose, onSaveVersion }: { open: boolean; onClose(): void; onSaveVersion(): void }) {
  const { job, activeSpec, draftDiffers } = useJob();
  const [showAll, setShowAll] = useState(false);
  const [files, setFiles] = useState<SpooledFileView[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<ShownError | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<RunView[] | null>(null);
  const source = activeSpec?.source;
  const filterKey = source ? filterParams(source.filter).toString() : '';

  useEffect(() => {
    if (!open || !source?.serverId) return;
    let cancelled = false;
    const params = new URLSearchParams({ forJob: job.id, limit: '200' });
    filterParams(source.filter, params);
    api<{ files: SpooledFileView[] }>(
      `/api/servers/${source.serverId}/queues/${encodeURIComponent(source.library)}/${encodeURIComponent(source.queue)}/files?${params}`,
    ).then(
      (data) => !cancelled && setFiles(data.files),
      (err) => !cancelled && setError(shownError(err)),
    );
    return () => {
      cancelled = true;
    };
    // The filters are compared by value through filterKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, job.id, source?.serverId, source?.library, source?.queue, filterKey]);

  const shown = (files ?? []).filter((file) => showAll || (file.status === 'READY' && !file.processedBy));
  const finish = activeSpec?.finish.action ?? 'none';
  const finishText =
    finish === 'hold'
      ? 'Files will be held after delivery.'
      : finish === 'move'
        ? `Files will be moved to ${activeSpec?.finish.queue?.library}/${activeSpec?.finish.queue?.name} after delivery.`
        : finish === 'delete'
          ? 'Files will be deleted from the IBM i after delivery.'
          : 'Files are left as they are.';

  async function onRun() {
    setBusy(true);
    setError(null);
    try {
      const chosen = shown.filter((file) => selected.has(splfKey(file))).map(idOf);
      const data = await api<{ runs: RunView[] }>(`/api/jobs/${job.id}/runs`, { method: 'POST', body: { splfs: chosen } });
      setResults(data.runs);
    } catch (err) {
      setError(shownError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Run now</DialogTitle>
          <DialogDescription>
            {job.activeVersion === null
              ? 'Save a version first: every run is logged against the version it used.'
              : `Runs version ${job.activeVersion} on the spooled files you pick. ${finishText}`}
          </DialogDescription>
        </DialogHeader>
        {job.activeVersion === null ? (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onClose();
                onSaveVersion();
              }}
            >
              <SaveIcon />
              Save a version
            </Button>
          </DialogFooter>
        ) : results ? (
          <>
            <ul className="flex max-h-80 flex-col gap-1.5 overflow-auto">
              {results.map((run) => (
                <li key={run.id} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
                  {run.status === 'success' ? (
                    <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  ) : run.status === 'skipped' ? (
                    <CircleSlashIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  ) : run.status === 'running' ? (
                    <Spinner className="mt-0.5" />
                  ) : run.status === 'warning' ? (
                    <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  ) : (
                    <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs">
                      Run #{run.seq}: {run.splf.name} #{run.splf.number}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {run.status === 'running'
                        ? 'Still running; see the Job log.'
                        : run.error ?? `${run.documents} ${run.documents === 1 ? 'document' : 'documents'} delivered`}
                    </div>
                  </div>
                  {run.outputs.slice(0, 3).map((output) => (
                    <a key={output.id} href={`/api/runs/${run.id}/files/${output.id}`} className="shrink-0 text-primary text-xs hover:underline">
                      {output.name}
                    </a>
                  ))}
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button asChild variant="outline">
                <Link href={`/runs?job=${job.id}`}>Open the Job log</Link>
              </Button>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            {draftDiffers && (
              <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <span>
                  The draft has changes that are not in version {job.activeVersion}. Run uses version {job.activeVersion} as it is.{' '}
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => {
                      onClose();
                      onSaveVersion();
                    }}
                  >
                    Save a version first
                  </button>
                </span>
              </p>
            )}
            <div className="flex items-center gap-2">
              <Switch id="run-show-all" checked={showAll} onCheckedChange={setShowAll} />
              <Label htmlFor="run-show-all" className="font-normal">
                Show held and processed files
              </Label>
            </div>
            {error && <ErrorNote detail={error.detail}>{error.message}</ErrorNote>}
            <div className="max-h-80 overflow-auto rounded-md border">
              {files === null && !error ? (
                <Loading className="p-3">Loading spooled files...</Loading>
              ) : shown.length === 0 ? (
                <p className="p-4 text-center text-muted-foreground text-sm">
                  {files && files.length > 0 ? 'No ready files this job has not processed. Turn on the switch to see the rest.' : 'The queue has no matching spooled files.'}
                </p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {shown.map((file) => {
                      const key = splfKey(file);
                      return (
                        <tr key={key} className="border-b last:border-0 hover:bg-muted/40">
                          <td className="w-8 px-3 py-2">
                            <Checkbox
                              checked={selected.has(key)}
                              onCheckedChange={(checked) =>
                                setSelected((current) => {
                                  const next = new Set(current);
                                  if (checked) next.add(key);
                                  else next.delete(key);
                                  return next;
                                })
                              }
                              aria-label={`Select ${file.name} #${file.number}`}
                            />
                          </td>
                          <td className="py-2 font-mono text-xs">
                            {file.name} #{file.number}
                            <div className="text-muted-foreground">
                              {file.jobNumber}/{file.jobUser}/{file.jobName}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-xs">{file.attributes.userData}</td>
                          <td className="px-2 py-2 text-xs">{file.status}</td>
                          <td className="px-2 py-2 text-muted-foreground text-xs">
                            {file.processedBy ? `Processed in run #${file.processedBy.seq ?? '?'}` : file.attributes.created.replace('T', ' ')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={onRun} disabled={busy || selected.size === 0}>
                {busy ? <Spinner /> : <PlayIcon />}
                Run {selected.size > 0 ? selected.size : ''} {selected.size === 1 ? 'file' : 'files'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
