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
import { toast } from 'sonner';
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
import { api, ApiError, errorText } from '@/lib/client/api';
import { dateTime } from '@/lib/client/format';
import { deleteNotice, startsDeleting } from '@/lib/job-spec';
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

  async function onRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    setEditing(false);
    if (name && name !== job.name) {
      await updateJob({ name }).catch((err) => toast.error('Could not rename the job', { description: errorText(err) }));
    }
  }

  async function onDelete() {
    try {
      await api(`/api/jobs/${job.id}`, { method: 'DELETE' });
      toast.success(`Deleted ${job.name}`);
      router.push('/jobs');
    } catch (err) {
      toast.error(`Could not delete ${job.name}`, { description: errorText(err) });
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
              <span>Draft only</span>
            )}
            {viewing === 'draft' && job.activeVersion !== null && draftDiffers && <span>Draft has changes</span>}
            {job.paused && <Badge variant="outline" className="h-4 px-1.5 text-[10px]">Paused</Badge>}
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
                Job log for this job
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

/**
 * Shown while a saved version is open: it is read-only, with restore and activate.
 * Activating a version that starts deleting spooled files asks first.
 */
function VersionBanner() {
  const { job, spec, activeSpec, viewing, setViewing, refresh } = useJob();
  const [busy, setBusy] = useState(false);
  // The notice to confirm before the version is made active, while the question is open.
  const [confirm, setConfirm] = useState<string | null>(null);
  if (viewing === 'draft') {
    return null;
  }
  const version = job.versions.find((v) => v.number === viewing);
  // While the active version is loading, whether it deletes is not known; the server asks then.
  const known = job.activeVersion === null || activeSpec !== null;

  async function act(path: 'restore' | 'activate', confirmDelete = false) {
    setBusy(true);
    try {
      await api(`/api/jobs/${job.id}/versions/${viewing}/${path}`, { method: 'POST', body: path === 'activate' ? { confirmDelete } : undefined });
      toast.success(path === 'activate' ? `Version ${viewing} is now active` : `Version ${viewing} copied to the draft`);
      await refresh();
      if (path === 'restore') await setViewing('draft');
    } catch (err) {
      if (path === 'activate' && err instanceof ApiError && err.status === 409) {
        setConfirm(err.message);
      } else {
        toast.error(path === 'activate' ? `Could not make version ${viewing} active` : `Could not restore version ${viewing}`, { description: errorText(err) });
      }
    } finally {
      setBusy(false);
    }
  }

  function onActivate() {
    if (known && startsDeleting(spec, activeSpec)) {
      setConfirm(deleteNotice(spec));
    } else {
      void act('activate');
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-amber-500/10 px-3 py-1.5 text-sm">
      <span>
        Viewing version {viewing}
        {version ? `, saved ${dateTime(version.createdAt)}` : ''}
        {version?.note ? ` (${version.note})` : ''}. It is read-only.
      </span>
      <div className="ml-auto flex gap-1.5">
        {job.activeVersion !== viewing && (
          <Button size="xs" variant="outline" disabled={busy} onClick={onActivate}>
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
      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make version {viewing} active and start deleting?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm} This cannot be undone. Keep it only when the delivered files are the record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirm(null);
                void act('activate', true);
              }}
            >
              <Trash2Icon />
              Make active
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
