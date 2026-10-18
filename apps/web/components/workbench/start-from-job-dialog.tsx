'use client';

import { CopyIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ErrorNote } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText, isAbort } from '@/lib/client/api';
import type { JobSummary } from '@/lib/types';
import { useWorkbench } from './workbench-provider';

/** What `/api/jobs/[id]/files` answers: a job's definition and template, nothing else. */
interface JobFilesView {
  id: string;
  name: string;
  definitionYaml: string;
  templateHtml: string | null;
}

/** The `type:` of a definition YAML, read without parsing it. */
function typeOf(yaml: string): string | null {
  return /^type:\s*["']?([a-z0-9-]+)/m.exec(yaml)?.[1] ?? null;
}

/**
 * Copy another job's template, and on request its definition, into this job's draft.
 * The files come from the other job's active version, or its draft when it has no
 * version. Mount it when it opens, so it starts empty each time.
 */
export function StartFromJobDialog({ onClose }: { onClose(): void }) {
  const { jobId, setYaml, setHtml } = useWorkbench();
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [loaded, setLoaded] = useState<JobFilesView | null>(null);
  const [withDefinition, setWithDefinition] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api<{ jobs: JobSummary[] }>('/api/jobs', { signal: controller.signal }).then(
      (data) => setJobs(data.jobs.filter((job) => job.id !== jobId)),
      (err: unknown) => !isAbort(err) && setError(errorText(err)),
    );
    return () => controller.abort();
  }, [jobId]);

  useEffect(() => {
    if (!chosen) {
      return;
    }
    const controller = new AbortController();
    api<JobFilesView>(`/api/jobs/${chosen}/files`, { signal: controller.signal }).then(
      (data) => setLoaded(data),
      (err: unknown) => !isAbort(err) && setError(errorText(err)),
    );
    return () => controller.abort();
  }, [chosen]);

  // The files of the chosen job only: a job picked before stays loaded but is not shown.
  const files = loaded?.id === chosen ? loaded : null;
  const type = files ? typeOf(files.definitionYaml) : null;
  const hasDefinition = !!files?.definitionYaml.trim();
  const hasTemplate = files?.templateHtml !== null && files?.templateHtml !== undefined;
  const copies = files ? [hasTemplate && 'template', withDefinition && hasDefinition && 'definition'].filter(Boolean) : [];

  function copy() {
    if (!files || copies.length === 0) {
      return;
    }
    if (hasTemplate) {
      setHtml(files.templateHtml);
    }
    if (withDefinition && hasDefinition) {
      setYaml(files.definitionYaml);
    }
    toast.success(`Copied the ${copies.join(' and ')} of ${files.name}`);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start from another job</DialogTitle>
          <DialogDescription>
            Copies the chosen job&apos;s template into this draft, replacing the current one. Its definition can come along too.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="start-from-job">Job</Label>
            {jobs === null && !error ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Spinner /> Loading jobs...
              </div>
            ) : jobs && jobs.length === 0 ? (
              <p className="text-muted-foreground text-sm">There are no other jobs yet.</p>
            ) : (
              <Select value={chosen} onValueChange={setChosen}>
                <SelectTrigger id="start-from-job" className="w-full" aria-label="Job">
                  <SelectValue placeholder="Pick a job" />
                </SelectTrigger>
                <SelectContent>
                  {(jobs ?? []).map((job) => (
                    <SelectItem key={job.id} value={job.id}>
                      {job.name}
                      {job.source.library && job.source.queue && (
                        <span className="text-muted-foreground">
                          {job.source.library}/{job.source.queue}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {chosen && !files && !error && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Spinner /> Reading the job&apos;s files...
            </div>
          )}
          {files && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm" aria-label="Files of the chosen job">
              <dt className="text-muted-foreground">Template</dt>
              <dd>{hasTemplate ? 'Yes' : 'None, the job uses the starter template'}</dd>
              <dt className="text-muted-foreground">Definition</dt>
              <dd>{hasDefinition ? (type ?? 'Yes') : 'None yet'}</dd>
            </dl>
          )}
          <div className="flex items-center gap-2">
            <Checkbox
              id="start-from-job-definition"
              checked={withDefinition}
              onCheckedChange={(checked) => setWithDefinition(checked === true)}
              disabled={!!files && !hasDefinition}
            />
            <Label htmlFor="start-from-job-definition" className="font-normal">
              Also replace the definition
            </Label>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={copy} disabled={copies.length === 0}>
            <CopyIcon />
            {copies.length === 0 ? 'Copy' : `Copy the ${copies.join(' and ')}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
