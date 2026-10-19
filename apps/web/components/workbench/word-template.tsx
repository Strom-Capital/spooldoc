'use client';

import { DownloadIcon, FileTextIcon, FolderInputIcon, SparklesIcon, Undo2Icon, UploadIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ErrorNote } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText, isAbort, shownError, type ShownError } from '@/lib/client/api';
import { postForFile } from '@/lib/client/download';
import { bytes, dateTime } from '@/lib/client/format';
import { FORMAT_FILES } from '@/lib/job-spec';
import type { TemplateFileDetails, TemplateFileView } from '@/lib/types';
import { EditorBar, EditorMessage } from './editor-bar';
import { SaveStatus } from './save-status';
import { StartFromJobDialog } from './start-from-job-dialog';
import { useWorkbench } from './workbench-provider';

/** The file's details, for the file id they were read for. */
type FileInfo = { id: string; file: TemplateFileDetails } | { id: string; error: string };

/**
 * The Word template shown: its `.docx`, uploaded or made by the AI
 * assistant, or the starter template generated from the definition until there is one.
 * The user changes the file in Word; here they upload it, download it or the starter
 * template, see what the tag check finds, by part, and put back the file the assistant
 * replaced.
 */
export function WordTemplate() {
  const { jobId, content, render, readOnly, yaml, templateId, onDraftWritten, setContent } = useWorkbench();
  const fileId = content.kind === 'docx' ? content.fileId : null;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'starter' | null>(null);
  const [error, setError] = useState<ShownError | null>(null);
  const [startFrom, setStartFrom] = useState(false);
  const [info, setInfo] = useState<FileInfo | null>(null);

  useEffect(() => {
    if (!fileId) {
      return;
    }
    const controller = new AbortController();
    api<TemplateFileDetails>(`/api/template-files/${fileId}`, { signal: controller.signal }).then(
      (file) => setInfo({ id: fileId, file }),
      (err: unknown) => !isAbort(err) && setInfo({ id: fileId, error: errorText(err) }),
    );
    return () => controller.abort();
  }, [fileId]);

  const current = info?.id === fileId ? info : null;
  const shown = render?.template?.kind === 'docx' ? render.template : undefined;
  const problems = shown?.problems ?? [];

  async function upload(file: File | undefined) {
    if (!file) {
      return;
    }
    const form = new FormData();
    form.set('file', file);
    form.set('templateId', templateId);
    setBusy('upload');
    setError(null);
    try {
      const saved = await api<TemplateFileView>(`/api/jobs/${jobId}/template-files`, { method: 'POST', body: form });
      setInfo({ id: saved.id, file: { ...saved, previous: null } });
      await onDraftWritten();
      toast.success(`Uploaded ${saved.name}`);
    } catch (err) {
      setError(shownError(err));
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  }

  /** Use the file the assistant replaced, or the starter template when it replaced none. */
  function restorePrevious(file: TemplateFileDetails) {
    setContent({ kind: 'docx', fileId: file.previous?.id ?? null });
    toast.success(file.previous ? `Using ${file.previous.name} again` : 'Using the starter template again');
  }

  async function downloadStarter() {
    setBusy('starter');
    setError(null);
    try {
      await postForFile(`/api/jobs/${jobId}/starter-docx`, { yaml }, 'template.docx');
    } catch (err) {
      setError(shownError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorBar status={<SaveStatus />}>
        {!readOnly && (
          <>
            <input
              ref={input}
              type="file"
              accept={`.docx,${FORMAT_FILES.docx.contentType}`}
              className="hidden"
              onChange={(event) => void upload(event.target.files?.[0])}
              aria-label="Word template file"
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => input.current?.click()}
              title="Upload a .docx made in Word. This template uses it from then on; saved versions keep theirs."
            >
              {busy === 'upload' ? <Spinner /> : <UploadIcon />}
              Upload template
            </Button>
          </>
        )}
        {fileId ? (
          <Button size="sm" variant="ghost" asChild>
            <a href={`/api/template-files/${fileId}/file`} download>
              <DownloadIcon />
              Download template
            </a>
          </Button>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy !== null || !yaml.trim()} onClick={downloadStarter} title="The starter template for the definition, to change in Word">
            {busy === 'starter' ? <Spinner /> : <DownloadIcon />}
            Download starter template
          </Button>
        )}
        {!readOnly && (
          <Button size="sm" variant="ghost" onClick={() => setStartFrom(true)} title="Copy a template of another job into this one, and on request its definition into this draft">
            <FolderInputIcon />
            Start from job
          </Button>
        )}
      </EditorBar>
      {startFrom && <StartFromJobDialog onClose={() => setStartFrom(false)} />}
      {error && (
        <ErrorNote detail={error.detail} className="rounded-none border-x-0 border-t-0 py-1.5 text-xs">
          {error.message}
        </ErrorNote>
      )}
      {!fileId && (
        <EditorMessage tone="note">
          This template has no Word file yet. The preview uses a starter template generated from the definition. Download it, change it in
          Word and upload it, or ask the AI assistant to design one.
        </EditorMessage>
      )}
      {current && 'error' in current && <EditorMessage tone="error">{current.error}</EditorMessage>}
      {shown?.error && (
        <EditorMessage tone="error">
          {problems.length > 0 && `${problems.length === 1 ? '1 problem' : `${problems.length} problems`} to fix in Word before the template renders:\n`}
          {shown.error}
          {shown.detail && (
            <details className="mt-1">
              <summary className="cursor-pointer select-none opacity-80 hover:opacity-100">Details</summary>
              <span className="font-mono">{shown.detail}</span>
            </details>
          )}
        </EditorMessage>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-4 text-sm">
        {fileId && (
          <div className="mb-4 flex items-center gap-3 rounded-md border p-3">
            <FileTextIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            {current && 'file' in current ? (
              <div className="min-w-0">
                <p className="truncate font-medium">{current.file.name}</p>
                <p className="text-muted-foreground text-xs">
                  {bytes(current.file.size)}, {current.file.madeBy === 'assistant' ? 'made by the AI assistant' : 'uploaded'} {dateTime(current.file.createdAt)}
                </p>
              </div>
            ) : current ? (
              <p className="text-muted-foreground">The file could not be read.</p>
            ) : (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Spinner /> Loading the file...
              </span>
            )}
          </div>
        )}
        {current && 'file' in current && current.file.madeBy === 'assistant' && (
          <PreviousFile file={current.file} readOnly={readOnly} onUse={() => restorePrevious(current.file)} />
        )}
        <h3 className="mb-2 font-medium">Tags in Word</h3>
        <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
          <li>
            Turn off smart quotes before you type tags: File, Options, Proofing, AutoCorrect Options, AutoFormat As You Type. Carbone prints a
            tag with curly quotes as text.
          </li>
          <li>
            Fields are the same tags as in HTML, such as <code className="font-mono text-foreground">{'{d.pageGroup.invoiceNo}'}</code>. JSON, at
            the end of the template tabs, shows the names.
          </li>
          <li>
            Repeat a table row with a row of <code className="font-mono text-foreground">[i]</code> tags and, below it, a row with{' '}
            <code className="font-mono text-foreground">{'{d.pageGroup.lines[i+1]}'}</code>. Keep a loop inside the body, a header or a footer.
          </li>
          <li>Insert a logo as a picture, set to In line with text. It is the same in every document.</li>
          <li>Page numbers are Word&apos;s own fields: Insert, Page Number.</li>
        </ul>
      </div>
    </div>
  );
}

/**
 * What the AI assistant replaced with the current file, and a button to use it again:
 * the earlier file while it is kept, or the starter template when there was no file.
 */
function PreviousFile({ file, readOnly, onUse }: { file: TemplateFileDetails; readOnly: boolean; onUse: () => void }) {
  const gone = file.previousId !== null && file.previous === null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-dashed p-3 text-xs">
      <SparklesIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1 text-muted-foreground">
        {file.previous
          ? `The AI assistant made this file in place of ${file.previous.name} from ${dateTime(file.previous.createdAt)}, which is kept.`
          : gone
            ? 'The AI assistant made this file. The file before it is no longer kept.'
            : 'The AI assistant made this file in place of the starter template.'}
      </p>
      {!readOnly && !gone && (
        <Button size="sm" variant="outline" onClick={onUse}>
          <Undo2Icon />
          {file.previous ? 'Use previous file' : 'Use starter template'}
        </Button>
      )}
    </div>
  );
}
