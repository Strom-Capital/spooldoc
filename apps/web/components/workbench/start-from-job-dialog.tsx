'use client';

import { CopyIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loading } from '@/components/empty-state';
import { ErrorNote } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import type { JobTemplateFiles } from '@/lib/chat-types';
import { api, errorText, isAbort } from '@/lib/client/api';
import type { JobSummary } from '@/lib/types';
import { useWorkbench } from './workbench-provider';

/** What `/api/jobs/[id]/files` answers: a job's definition and templates, nothing else. */
interface JobFilesView {
  id: string;
  name: string;
  definitionYaml: string;
  templates: JobTemplateFiles[];
}

/** What a template of the other job has as its content. */
function contentName(template: JobTemplateFiles): string {
  if (template.kind === 'docx') return template.fileId === null ? 'Starter Word template' : 'Word template';
  return template.html === null ? 'Starter template' : 'Custom template';
}

/** The `type:` of a definition YAML, read without parsing it. */
function typeOf(yaml: string): string | null {
  return /^type:\s*["']?([a-z0-9-]+)/m.exec(yaml)?.[1] ?? null;
}

/**
 * Copy one of another job's templates into the template shown, and on request the
 * other job's definition into this job's draft. The files come from the
 * other job's active version, or its draft when it has no version. Mount it when it
 * opens, so it starts empty each time.
 */
export function StartFromJobDialog({ onClose }: { onClose(): void }) {
  const { jobId, setYaml, setContent } = useWorkbench();
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [loaded, setLoaded] = useState<JobFilesView | null>(null);
  const [sourceId, setSourceId] = useState('');
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
  const source = files ? (files.templates.find((t) => t.id === sourceId) ?? files.templates[0]) : undefined;
  const hasTemplate = !!source && (source.kind === 'docx' ? source.fileId !== null : source.html !== null);
  const copies = files ? [hasTemplate && 'template', withDefinition && hasDefinition && 'definition'].filter(Boolean) : [];

  function copy() {
    if (!files || copies.length === 0) {
      return;
    }
    if (hasTemplate) {
      setContent(source.kind === 'docx' ? { kind: 'docx', fileId: source.fileId } : { kind: 'html', source: source.html });
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
            Copies a template of the chosen job into this one, replacing what it has. Its definition can come along too.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="start-from-job">Job</Label>
            {jobs === null && !error ? (
              <Loading>Loading jobs...</Loading>
            ) : jobs && jobs.length === 0 ? (
              <p className="text-muted-foreground text-sm">There are no other jobs yet.</p>
            ) : (
              <Select
                value={chosen}
                onValueChange={(id) => {
                  setChosen(id);
                  setSourceId('');
                }}
              >
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
          {files && files.templates.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="start-from-template">Template to copy</Label>
              <Select value={source?.id ?? ''} onValueChange={setSourceId}>
                <SelectTrigger id="start-from-template" className="w-full" aria-label="Template to copy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {files.templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                      <span className="text-muted-foreground">{contentName(template)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {files && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm" aria-label="Files of the chosen job">
              <dt className="text-muted-foreground">Template</dt>
              <dd>{hasTemplate ? (source.kind === 'docx' ? 'A Word template' : 'An HTML template') : 'None, it uses the starter template'}</dd>
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
