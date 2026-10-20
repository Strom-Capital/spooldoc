'use client';

import { FileCodeIcon, FileDownIcon, FileSpreadsheetIcon, FileTextIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAppInfo } from '@/components/app-info';
import { ErrorNote } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { shownError, type ShownError } from '@/lib/client/api';
import { download, postForFile } from '@/lib/client/download';
import { FORMAT_FILES, KIND_NAMES, perSpooledFile, spooledFileName } from '@/lib/job-spec';
import { useWorkbench } from './workbench-provider';

/** A PDF in base64 as an object URL, revoked when it changes or the pane goes. */
function usePdfUrl(base64: string | undefined): string | null {
  const url = useMemo(
    () => (base64 ? URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'application/pdf' })) : null),
    [base64],
  );
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  return url;
}

/**
 * The current page group's document as rendered: an HTML template's HTML in a sandboxed iframe (no
 * scripts), a Word or Excel template's PDF in the browser's PDF viewer. An Excel template of
 * the whole spooled file shows the document of every page group. Buttons download it as
 * HTML or as a PDF, or a Word or Excel template's as a PDF or a DOCX or XLSX, rendered by
 * Carbone from the text in the editors. Without a working Carbone server it says where to set one up.
 *
 * @param header - Controls for the start of the pane header
 * @param fileName - The file name (without extension) of a document's files, from its name
 */
export function HtmlPreview({ header, fileName = (name) => name }: { header?: ReactNode; fileName?(documentName: string): string }) {
  const { render, jobId, pageGroupIndex, yaml, content, templateRequest, templateId } = useWorkbench();
  const { rendering } = useAppInfo();
  const [busy, setBusy] = useState<'pdf' | 'docx' | 'xlsx' | null>(null);
  const [error, setError] = useState<ShownError | null>(null);
  /** DOCX or XLSX for a Word or Excel template, whose PDF is the one on screen; null for HTML. */
  const fileFormat = KIND_NAMES[content.kind].fileFormat as 'docx' | 'xlsx' | null;
  const pdfShown = fileFormat !== null;
  const pdfUrl = usePdfUrl(pdfShown ? render?.pdf : undefined);
  const rendered = pdfShown ? !!render?.pdf : !!render?.html;
  const ready = rendering && rendered;
  const hint = (format: string) =>
    !rendering
      ? 'Connect Carbone in Settings to render documents'
      : !rendered
        ? 'Nothing to print yet: fix the definition or the template first.'
        : `Download this document as ${format}`;
  const name = () =>
    fileName(perSpooledFile(content) && render ? spooledFileName(render.sample) : (render?.names?.[pageGroupIndex] ?? `document-${pageGroupIndex + 1}`));

  /** The rendered HTML of this document as a file, named like the PDF. */
  function onHtml() {
    if (!render?.html) return;
    void download(new Response(render.html, { headers: { 'content-disposition': `attachment; filename="${name()}.html"` } }), `${name()}.html`);
  }

  async function onFile(format: 'pdf' | 'docx' | 'xlsx') {
    setError(null);
    // A Word or Excel template's PDF is the one on screen.
    if (format === 'pdf' && pdfShown && pdfUrl) {
      void download(await fetch(pdfUrl), `${name()}.pdf`);
      return;
    }
    setBusy(format);
    try {
      await postForFile(`/api/jobs/${jobId}/preview-file`, { yaml, ...templateRequest, pageGroup: pageGroupIndex, templateId, format }, `${name()}.${format}`);
    } catch (err) {
      setError(shownError(err));
    } finally {
      setBusy(null);
    }
  }

  const fileButton = (format: 'pdf' | 'docx' | 'xlsx') => (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={ready ? undefined : 0}>
          <Button size="sm" variant="outline" disabled={!ready || busy !== null} onClick={() => void onFile(format)}>
            {busy === format ? <Spinner /> : format === 'pdf' ? <FileDownIcon /> : format === 'xlsx' ? <FileSpreadsheetIcon /> : <FileTextIcon />}
            {FORMAT_FILES[format].label}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint(`${format === 'xlsx' ? 'an' : 'a'} ${FORMAT_FILES[format].label}`)}</TooltipContent>
    </Tooltip>
  );

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Preview">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2 text-sm">
        {header ?? <span className="font-medium">Preview</span>}
        <div className="ml-auto flex items-center gap-2">
          {fileFormat ? (
            fileButton(fileFormat)
          ) : (
            <Button size="sm" variant="outline" disabled={!render?.html} onClick={onHtml} title="Download this document as HTML">
              <FileCodeIcon />
              HTML
            </Button>
          )}
          {fileButton('pdf')}
        </div>
      </div>
      {error && (
        <ErrorNote detail={error.detail} className="rounded-none border-x-0 border-t-0 py-1.5 text-xs">
          {error.message}
        </ErrorNote>
      )}
      <div className="min-h-0 flex-1 bg-muted/30 p-2">
        {pdfShown && pdfUrl ? (
          <iframe title="Rendered document" src={pdfUrl} className="h-full w-full rounded border bg-white" />
        ) : !pdfShown && render?.html ? (
          <iframe title="Rendered document" sandbox="" srcDoc={render.html} className="h-full w-full rounded border bg-white" />
        ) : render?.carbone ? (
          <ErrorNote detail={render.carbone.detail} className="m-1">
            {render.carbone.error}{' '}
            <Link href="/settings#rendering" className="underline underline-offset-2">
              Open Settings
            </Link>
          </ErrorNote>
        ) : (
          <p className="p-2 text-muted-foreground text-sm">
            {render?.template?.error
              ? 'The template has errors; see the Template tab.'
              : 'Nothing to show yet: the preview needs a definition that finds page groups.'}
          </p>
        )}
      </div>
    </section>
  );
}
