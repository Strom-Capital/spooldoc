'use client';

import {
  ChevronDownIcon,
  ChevronUpIcon,
  MoreHorizontalIcon,
  PlayIcon,
  RotateCcwIcon,
  SaveIcon,
  ScrollTextIcon,
  StarIcon,
  Trash2Icon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, errorText } from '@/lib/client/api';
import { dateTime } from '@/lib/client/format';
import type { JobDetail } from '@/lib/types';
import { AiButton, AiSidebar, useAiSidebar } from './ai-sidebar';
import { DestinationInspector, FinishInspector, SourceInspector } from './inspectors';
import { TriggerInspector } from './trigger-inspector';
import { SaveVersionDialog, RunNowDialog } from './job-dialogs';
import { JobProvider, useJob } from './job-provider';
import { PipelineStrip } from './pipeline-strip';
import { ExtractStep, JobChat, JobWorkbench, RenderStep } from './workbench-steps';

/** The job builder: the pipeline, the selected step, and the AI assistant. */
export function JobBuilder({ initial }: { initial: JobDetail }) {
  return (
    <JobProvider initial={initial}>
      <JobWorkbench>
        <Builder />
      </JobWorkbench>
    </JobProvider>
  );
}

function Builder() {
  const { step } = useJob();
  const ai = useAiSidebar();
  const [stripOpen, setStripOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar ai={ai} onSave={() => setSaving(true)} onRun={() => setRunning(true)} />
      <VersionBanner />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative shrink-0 border-b bg-muted/20">
            {stripOpen && <PipelineStrip />}
            <Button
              variant="ghost"
              size="xs"
              className={stripOpen ? 'absolute right-1 bottom-1' : 'm-1'}
              onClick={() => setStripOpen(!stripOpen)}
              aria-expanded={stripOpen}
            >
              {stripOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
              {stripOpen ? 'Hide pipeline' : 'Show pipeline'}
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            {step === 'source' && <SourceInspector />}
            {step === 'trigger' && <TriggerInspector />}
            {step === 'extract' && <ExtractStep />}
            {step === 'render' && <RenderStep />}
            {step === 'destination' && <DestinationInspector />}
            {step === 'finish' && <FinishInspector />}
          </div>
        </div>
        <AiSidebar open={ai.open} setOpen={ai.setOpen}>
          <JobChat />
        </AiSidebar>
      </div>
      {saving && <SaveVersionDialog open onClose={() => setSaving(false)} />}
      {running && <RunNowDialog open onClose={() => setRunning(false)} onSaveVersion={() => setSaving(true)} />}
    </div>
  );
}

function TopBar({ ai, onSave, onRun }: { ai: { open: boolean; setOpen(open: boolean): void }; onSave(): void; onRun(): void }) {
  const router = useRouter();
  const { job, viewing, setViewing, draftDiffers, updateJob } = useJob();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    setEditing(false);
    if (name && name !== job.name) {
      await updateJob({ name }).catch((err) => setError(errorText(err)));
    }
  }

  async function onDelete() {
    try {
      await api(`/api/jobs/${job.id}`, { method: 'DELETE' });
      router.push('/jobs');
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <div className="shrink-0 border-b">
      <div className="flex min-h-12 flex-wrap items-center gap-2 px-3 py-1.5">
        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={onRename} className="max-w-sm">
              <Input name="name" defaultValue={job.name} autoFocus onBlur={(event) => event.currentTarget.form?.requestSubmit()} aria-label="Job name" className="h-7" />
            </form>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="max-w-full truncate rounded px-1 text-left font-semibold hover:bg-muted" title="Rename">
              {job.name}
            </button>
          )}
          <div className="flex flex-wrap items-center gap-1.5 px-1 text-muted-foreground text-xs">
            <Link href="/jobs" className="hover:underline">
              Jobs
            </Link>
            {job.activeVersion !== null ? (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                v{job.activeVersion} active
              </Badge>
            ) : (
              <span>No version saved yet</span>
            )}
            {viewing === 'draft' && job.activeVersion !== null && draftDiffers && <span>Draft has changes</span>}
            {job.paused && <Badge variant="outline" className="h-4 px-1.5 text-[10px]">Paused</Badge>}
            {error && <span className="text-destructive">{error}</span>}
          </div>
        </div>
        <Select value={String(viewing)} onValueChange={(value) => void setViewing(value === 'draft' ? 'draft' : Number(value))}>
          <SelectTrigger size="sm" className="w-36" aria-label="Version">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="draft">Draft</SelectItem>
            {job.versions.map((version) => (
              <SelectItem key={version.number} value={String(version.number)}>
                v{version.number}
                {version.number === job.activeVersion ? ' (active)' : ''}
                <span className="text-muted-foreground">{version.note ? ` ${version.note.slice(0, 24)}` : ''}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={onSave} disabled={viewing !== 'draft'}>
          <SaveIcon />
          <span className="hidden sm:inline">Save version</span>
        </Button>
        <Button size="sm" onClick={onRun}>
          <PlayIcon />
          <span className="hidden sm:inline">Run now</span>
        </Button>
        <AiButton open={ai.open} setOpen={ai.setOpen} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/runs?job=${job.id}`}>
                <ScrollTextIcon />
                Runs of this job
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
              <Trash2Icon />
              Delete job
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {job.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The job, its versions, its runs and their files are deleted. Nothing changes on the IBM i.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Shown while a saved version is open: it is read-only, with restore and activate. */
function VersionBanner() {
  const { job, viewing, setViewing, refresh } = useJob();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (viewing === 'draft') {
    return null;
  }
  const version = job.versions.find((v) => v.number === viewing);

  async function act(path: 'restore' | 'activate') {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/jobs/${job.id}/versions/${viewing}/${path}`, { method: 'POST' });
      await refresh();
      if (path === 'restore') await setViewing('draft');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-amber-500/10 px-3 py-1.5 text-sm">
      <span>
        Viewing version {viewing}
        {version ? `, saved ${dateTime(version.createdAt)}` : ''}
        {version?.note ? ` (${version.note})` : ''}. It is read-only.
      </span>
      {error && <span className="text-destructive">{error}</span>}
      <div className="ml-auto flex gap-1.5">
        {job.activeVersion !== viewing && (
          <Button size="xs" variant="outline" disabled={busy} onClick={() => act('activate')}>
            <StarIcon />
            Make active
          </Button>
        )}
        <Button size="xs" variant="outline" disabled={busy} onClick={() => act('restore')}>
          <RotateCcwIcon />
          Restore to draft
        </Button>
        <Button size="xs" variant="ghost" onClick={() => void setViewing('draft')}>
          Back to draft
        </Button>
      </div>
    </div>
  );
}
