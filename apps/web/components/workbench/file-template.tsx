'use client';

import { DownloadIcon, FileSpreadsheetIcon, FileTextIcon, MousePointerClickIcon, Undo2Icon, UploadIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DocsLink } from '@/components/docs-link';
import { Hint } from '@/components/hint';
import { ErrorNote } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText, isAbort, shownError, type ShownError } from '@/lib/client/api';
import { postForFile } from '@/lib/client/download';
import { bytes, dateTime } from '@/lib/client/format';
import { FORMAT_FILES, KIND_NAMES, type FileTemplateContent } from '@/lib/job-spec';
import type { TemplateFileDetails, TemplateFileView } from '@/lib/types';
import { EditorBar, EditorMessage } from './editor-bar';
import { StartFromJobButton, StartFromJobDialog } from './start-from-job-dialog';
import { useWorkbench } from './workbench-provider';

/** The file's details, for the file id they were read for. */
type FileInfo = { id: string; file: TemplateFileDetails } | { id: string; error: string };

/**
 * The Word or Excel template shown: its `.docx` or `.xlsx`, uploaded or made by the agent,
 * or the starter template generated from the definition until there is one. The user
 * changes the file in Word or Excel; here they upload it, download it or the starter
 * template, see what the tag check finds, by part or by sheet and cell, and put back the
 * file the agent replaced.
 */
export function FileTemplate({ kind }: { kind: FileTemplateContent['kind'] }) {
  const { jobId, content, render, readOnly, yaml, templateId, onDraftWritten, setContent } = useWorkbench();
  const fileId = content.kind === kind ? content.fileId : null;
  const scope = content.kind === 'xlsx' ? content.scope : 'splf';
  const { app, name: kindLabel } = KIND_NAMES[kind];
  const { extension, contentType } = FORMAT_FILES[kind];
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
  const shown = render?.template?.kind === kind ? render.template : undefined;
  const problems = shown?.problems ?? [];
  const noPageSetup = shown?.kind === 'xlsx' ? (shown.noPageSetup ?? []) : [];

  async function upload(file: File | undefined) {
    if (!file) {
      return;
    }
    const form = new FormData();
    form.set('file', file);
    form.set('templateId', templateId);
    form.set('kind', kind);
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

  /** Use the file the agent replaced, or the starter template when it replaced none. */
  function restorePrevious(file: TemplateFileDetails) {
    const fileId = file.previous?.id ?? null;
    setContent(kind === 'xlsx' ? { kind, fileId, scope } : { kind, fileId });
    toast.success(file.previous ? `Using ${file.previous.name} again` : 'Using the starter template again');
  }

  async function downloadStarter() {
    setBusy('starter');
    setError(null);
    try {
      await postForFile(`/api/jobs/${jobId}/starter`, { yaml, kind, scope }, `template.${extension}`);
    } catch (err) {
      setError(shownError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorBar>
        {!readOnly && (
          <>
            <input
              ref={input}
              type="file"
              accept={`.${extension},${contentType}`}
              className="hidden"
              onChange={(event) => void upload(event.target.files?.[0])}
              aria-label={`${kindLabel} file`}
            />
            <Hint
              text={
                busy !== null
                  ? 'Wait for the file to finish.'
                  : `Choose a .${extension} file made in ${app}. It becomes this template's file in the draft, in place of the current one. A saved version keeps the file it was saved with.`
              }
            >
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => input.current?.click()}>
                {busy === 'upload' ? <Spinner /> : <UploadIcon />}
                Upload template
              </Button>
            </Hint>
          </>
        )}
        {fileId ? (
          <Hint text={`Save this .${extension} file to your computer. Change it in ${app}, then upload it again with Upload template.`}>
            <Button size="sm" variant="ghost" asChild>
              <a href={`/api/template-files/${fileId}/file`} download>
                <DownloadIcon />
                Download template
              </a>
            </Button>
          </Hint>
        ) : (
          <Hint
            text={
              !yaml.trim()
                ? 'Write a definition first. The starter template is made from its fields.'
                : `Save a .${extension} file made from the definition's fields to your computer. Change it in ${app}, then upload it with Upload template.`
            }
          >
            <Button size="sm" variant="ghost" disabled={busy !== null || !yaml.trim()} onClick={downloadStarter}>
              {busy === 'starter' ? <Spinner /> : <DownloadIcon />}
              Download starter template
            </Button>
          </Hint>
        )}
        {!readOnly && <StartFromJobButton onClick={() => setStartFrom(true)} />}
      </EditorBar>
      {startFrom && <StartFromJobDialog onClose={() => setStartFrom(false)} />}
      {error && (
        <ErrorNote detail={error.detail} className="rounded-none border-x-0 border-t-0 py-1.5 text-xs">
          {error.message}
        </ErrorNote>
      )}
      {!fileId && (
        <EditorMessage tone="note">
          This template has no {app} file yet. The preview uses a starter template generated from the definition. Download it, change it in{' '}
          {app} and upload it, or ask the agent to design one.
        </EditorMessage>
      )}
      {fileId && noPageSetup.length > 0 && (
        <EditorMessage tone="note">
          {noPageSetup.length === 1 ? `The sheet ${noPageSetup[0]} has` : `The sheets ${noPageSetup.join(', ')} have`} no page setup, so the PDF prints on US
          Letter and can cut columns off. In Excel, set it on the Page Layout tab: Size A4, Orientation, Width 1 page under Scale to Fit, and Print
          Titles for the header row.
        </EditorMessage>
      )}
      {current && 'error' in current && <EditorMessage tone="error">{current.error}</EditorMessage>}
      {shown?.error && (
        <EditorMessage tone="error">
          {problems.length > 0 && `${problems.length === 1 ? '1 problem' : `${problems.length} problems`} to fix in ${app} before the template renders:\n`}
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
            {kind === 'xlsx' ? (
              <FileSpreadsheetIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
              <FileTextIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            )}
            {current && 'file' in current ? (
              <div className="min-w-0">
                <p className="truncate font-medium">{current.file.name}</p>
                <p className="text-muted-foreground text-xs">
                  {bytes(current.file.size)}, {current.file.madeBy === 'assistant' ? 'made by the agent' : 'uploaded'} {dateTime(current.file.createdAt)}
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
        {kind === 'xlsx' ? <ExcelTips scope={scope} /> : <WordTips />}
      </div>
    </div>
  );
}

/** How to write tags in Word. */
function WordTips() {
  return (
    <>
      <h3 className="mb-2 font-medium">Tags in Word</h3>
      <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
          <li>
            Turn off smart quotes before you type tags: File, Options, Proofing, AutoCorrect Options, AutoFormat As You Type. Carbone prints a
            tag with curly quotes as text.
          </li>
          <li>
            Fields are the same tags as in HTML, such as <code className="font-mono text-foreground">{'{d.pg.invoiceNo}'}</code>. The JSON tab
            has the names.
          </li>
          <li>
            Repeat a table row with a row of <code className="font-mono text-foreground">[i]</code> tags and, below it, a row with{' '}
            <code className="font-mono text-foreground">{'{d.pg.lines[i+1]}'}</code>. Keep a loop inside the body, a header or a footer.
          </li>
          <li>Insert a logo as a picture, set to In line with text. It is the same in every document.</li>
          <li>Page numbers are Word&apos;s own fields: Insert, Page Number.</li>
      </ul>
      <DocsLink page="templates" anchor="tags-in-word" className="mt-3">
        More about tags in Word
      </DocsLink>
    </>
  );
}

const code = (text: string) => <code className="font-mono text-foreground">{text}</code>;

/** How to write tags in Excel, for the template's scope. */
function ExcelTips({ scope }: { scope: 'splf' | 'pageGroup' }) {
  const list = scope === 'splf' ? 'd.pgs[i].lines[i]' : 'd.pg.lines[i]';
  return (
    <>
      <h3 className="mb-2 font-medium">Tags in Excel</h3>
      <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
        <li>
          {scope === 'splf' ? (
            <>
              Each file holds the whole spooled file. A row with {code('{d.pgs[i].invoiceNo}')} and {code(`{${list}.item}`)}, and below it a row
              with {code('{d.pgs[i+1].lines[i+1]}')}, makes a row per line with its page group&apos;s fields.
            </>
          ) : (
            <>
              Each file holds one page group, as {code('{d.pg.invoiceNo}')}. Repeat a row with a row of {code('[i]')} tags and, below it, a row
              with {code('{d.pg.lines[i+1]}')}.
            </>
          )}{' '}
          The JSON tab has the names.
        </li>
        <li>
          Write numbers as {code(`{${list}.amount:formatN}`)}, and give the cell a number format such as {code('#,##0.00')}. Without{' '}
          {code(':formatN')} the cell is text and SUM gives 0.
        </li>
        <li>
          Write dates as {code(`{${list}.shipDate:formatD(X):div(86400):add(25569):formatN}`)}, with a date format such as{' '}
          {code('dd.mm.yyyy')} on the cell. This makes a real date.
        </li>
        <li>
          Under a loop, total a column with {code('=SUM(INDIRECT("D5:D"&ROW()-1))')}, from the loop&apos;s row: a plain SUM does not grow with
          the rows.
        </li>
        <li>Merge no cells in or below a loop. Put filters and conditional formatting on whole columns, such as A:G.</li>
        <li>The PDF follows the page setup of each sheet: Page Layout, Size, Orientation, Scale to Fit and Print Titles.</li>
      </ul>
      <DocsLink page="templates" anchor="tags-in-excel" className="mt-3">
        More about tags in Excel
      </DocsLink>
    </>
  );
}

/**
 * What the agent replaced with the current file, and a button to use it again:
 * the earlier file while it is kept, or the starter template when there was no file.
 */
function PreviousFile({ file, readOnly, onUse }: { file: TemplateFileDetails; readOnly: boolean; onUse: () => void }) {
  const gone = file.previousId !== null && file.previous === null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-dashed p-3 text-xs">
      <MousePointerClickIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1 text-muted-foreground">
        {file.previous
          ? `The agent made this file in place of ${file.previous.name} from ${dateTime(file.previous.createdAt)}, which is kept.`
          : gone
            ? 'The agent made this file. The file before it is no longer kept.'
            : 'The agent made this file in place of the starter template.'}
      </p>
      {!readOnly && !gone && (
        <Hint
          text={
            file.previous
              ? `Use ${file.previous.name} again as this template's file in the draft. The agent's file is then no longer used.`
              : "Go back to the starter template made from the definition. The agent's file is then no longer used."
          }
        >
          <Button size="sm" variant="outline" onClick={onUse}>
            <Undo2Icon />
            {file.previous ? 'Use previous file' : 'Use starter template'}
          </Button>
        </Hint>
      )}
    </div>
  );
}
