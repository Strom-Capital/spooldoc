'use client';

import {
  ChevronDownIcon,
  ChevronUpIcon,
  CircleCheckIcon,
  CirclePauseIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PenLineIcon,
  PlayIcon,
  RotateCcwIcon,
  SaveIcon,
  ScrollTextIcon,
  StarIcon,
  Trash2Icon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState, type FormEvent } from 'react';
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
import { Hint } from '@/components/hint';
import { StatusPill } from '@/components/status-pill';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, ApiError, errorText } from '@/lib/client/api';
import { dateTime } from '@/lib/client/format';
import { runVariant } from '@/lib/client/step-status';
import { deleteNotice, startsDeleting } from '@/lib/job-spec';
import type { JobDetail } from '@/lib/types';
import { AiButton, AiSidebar, useAiSidebar } from './ai-sidebar';
import { DeleteJobDialog } from './delete-job-dialog';
import { DestinationInspector, FinishInspector, SourceInspector } from './inspectors';
import { TriggerInspector } from './trigger-inspector';
import { SaveVersionDialog, RunNowDialog } from './job-dialogs';
import { JobProvider, useJob } from './job-provider';
import { PipelineStrip } from './pipeline-strip';
import { StepNavProvider } from './step-nav';
import { useStepStatuses } from './use-step-statuses';
import { ExtractStep, JobChat, JobWorkbench, RenderStep } from './workbench-steps';

/** The job builder: the pipeline, the selected step, and the agent. */
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
  const openSave = useCallback(() => setSaving(true), []);
  const [running, setRunning] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar ai={ai} onSave={() => setSaving(true)} onRun={() => setRunning(true)} />
      <VersionBanner />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative shrink-0 border-b bg-muted/20">
            {stripOpen && <PipelineStrip />}
            {/* Centered, so React Flow's attribution in the corner stays visible. */}
            <Button
              variant="ghost"
              size="xs"
              className={stripOpen ? 'absolute bottom-1 left-1/2 -translate-x-1/2' : 'mx-auto my-1 flex'}
              onClick={() => setStripOpen(!stripOpen)}
              aria-expanded={stripOpen}
            >
              {stripOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
              {stripOpen ? 'Hide pipeline' : 'Show pipeline'}
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <StepNavProvider onSaveVersion={openSave}>
              {step === 'source' && <SourceInspector />}
              {step === 'trigger' && <TriggerInspector />}
              {step === 'extract' && <ExtractStep />}
              {step === 'render' && <RenderStep />}
              {step === 'destination' && <DestinationInspector />}
              {step === 'finish' && <FinishInspector />}
            </StepNavProvider>
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
  const { ready } = useStepStatuses();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Escape leaves the name field without saving; the blur that follows must not save it.
  const cancelled = useRef(false);
  // Rename in the menu opens the name field once the menu has closed, so the menu's
  // focus handling does not take focus from the field and close it straight away.
  const renameAfterMenu = useRef(false);

  function startRename() {
    cancelled.current = false;
    setEditing(true);
  }

  async function onRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cancelled.current) return;
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    setEditing(false);
    if (name && name !== job.name) {
      await updateJob({ name }).catch((err) => toast.error('Could not rename the job', { description: errorText(err) }));
    }
  }

  return (
    <div className="shrink-0 border-b">
      <div className="flex min-h-12 flex-wrap items-center gap-2 px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap gap-1">
              <BreadcrumbItem className="shrink-0 px-1">
                <BreadcrumbLink asChild>
                  <Link href="/jobs">Jobs</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="shrink-0" />
              <BreadcrumbItem className="min-w-0">
                {/* Not BreadcrumbPage: its role="link" would wrap the rename button and input. */}
                <span aria-current="page" className="block min-w-0 max-w-full text-foreground">
                  {editing ? (
                    <form onSubmit={onRename} className="w-72 max-w-full">
                      <Input
                        name="name"
                        defaultValue={job.name}
                        autoFocus
                        onBlur={(event) => event.currentTarget.form?.requestSubmit()}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelled.current = true;
                            setEditing(false);
                          }
                        }}
                        aria-label="Job name"
                        className="h-7"
                      />
                    </form>
                  ) : (
                    <Hint text="Rename the job" side="bottom">
                      <button type="button" onClick={startRename} className="block max-w-full truncate rounded px-1 text-left font-semibold hover:bg-muted">
                        {job.name}
                      </button>
                    </Hint>
                  )}
                </span>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
            {job.activeVersion === null ? (
              <StatusPill tone="neutral" icon={PenLineIcon} title="No version is saved yet. Save a version to run the job.">
                Draft only
              </StatusPill>
            ) : (
              <StatusPill tone="ready" icon={CircleCheckIcon} title={`Watching and Run now use version ${job.activeVersion}.`}>
                v{job.activeVersion} active
              </StatusPill>
            )}
            {job.activeVersion !== null && viewing === 'draft' && draftDiffers && (
              <StatusPill tone="held" icon={PenLineIcon} title={`The draft has changes that are not in version ${job.activeVersion}. Save a version to use them.`}>
                Draft changed
              </StatusPill>
            )}
          </div>
          {job.paused && (
            <StatusPill tone="held" icon={CirclePauseIcon} title="A paused job is not watched." className="shrink-0">
              Paused
            </StatusPill>
          )}
        </div>
        <ButtonGroup>
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
          <Hint
            text={
              viewing !== 'draft'
                ? 'A saved version is read-only. Go back to the draft to save a new version.'
                : 'Save the draft as a fixed version. Watching and Run now use the active version, so the draft can change without touching them.'
            }
          >
            <Button variant="outline" size="sm" onClick={onSave} disabled={viewing !== 'draft'} aria-label="Save version">
              <SaveIcon />
              <span className="hidden sm:inline">Save version</span>
            </Button>
          </Hint>
        </ButtonGroup>
        {/* Primary once every step is ready; until then Next is the step to take. */}
        <Hint
          text={
            job.activeVersion === null
              ? 'Run the job by hand on spooled files you pick. It runs the active version, so save a version and make it active first.'
              : `Run version ${job.activeVersion} now on spooled files you pick from the source queue.`
          }
        >
          <Button size="sm" variant={runVariant(ready)} onClick={onRun} aria-label="Run now">
            <PlayIcon />
            <span className="hidden sm:inline">Run now</span>
          </Button>
        </Hint>
        <AiButton open={ai.open} setOpen={ai.setOpen} />
        <DropdownMenu>
          <Hint text="Rename, Job log and Delete job">
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More">
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              if (renameAfterMenu.current) {
                renameAfterMenu.current = false;
                event.preventDefault();
                startRename();
              }
            }}
          >
            <DropdownMenuItem
              onSelect={() => {
                renameAfterMenu.current = true;
              }}
            >
              <PencilIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
      <DeleteJobDialog job={deleting ? job : null} onClose={() => setDeleting(false)} onDeleted={() => router.push('/jobs')} />
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
          <Hint text={`Watching and Run now use version ${viewing} from now on. The draft does not change.`}>
            <Button size="xs" variant="outline" disabled={busy} onClick={onActivate}>
              <StarIcon />
              Make active
            </Button>
          </Hint>
        )}
        <Hint text={`Copy version ${viewing} into the draft, in place of what the draft has now. The active version does not change.`}>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => act('restore')}>
            <RotateCcwIcon />
            Restore to draft
          </Button>
        </Hint>
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
