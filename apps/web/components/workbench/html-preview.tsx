'use client';

import { FileCodeIcon, FileDownIcon, FileTextIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAppInfo } from '@/components/app-info';
import { ErrorNote } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { shownError, type ShownError } from '@/lib/client/api';
import { download, postForFile } from '@/lib/client/download';
import { PageGroupSelect } from './page-group-select';
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
 * scripts), a Word template's PDF in the browser's PDF viewer. Buttons download it as
 * HTML or as a PDF, or a Word template's as a PDF or a DOCX, rendered by Carbone from the
 * text in the editors. Without a working Carbone server it says where to set one up.
 *
 * @param header - Controls for the start of the pane header
 * @param fileName - The file name (without extension) of a document's files, from its name
 */
export function HtmlPreview({ header, fileName = (name) => name }: { header?: ReactNode; fileName?(documentName: string): string }) {
  const { render, jobId, pageGroupIndex, yaml, content, templateRequest, templateId } = useWorkbench();
  const { rendering } = useAppInfo();
  const [busy, setBusy] = useState<'pdf' | 'docx' | null>(null);
  const [error, setError] = useState<ShownError | null>(null);
  const word = content.kind === 'docx';
  const pdfUrl = usePdfUrl(word ? render?.pdf : undefined);
  const rendered = word ? !!render?.pdf : !!render?.html;
  const ready = rendering && rendered;
  const hint = (format: string) =>
    !rendering
      ? 'Connect Carbone in Settings to render documents'
      : !rendered
        ? 'Nothing to print yet: fix the definition or the template first.'
        : `Download this document as ${format}`;
  const name = () => fileName(render?.names?.[pageGroupIndex] ?? `document-${pageGroupIndex + 1}`);

  /** The rendered HTML of this document as a file, named like the PDF. */
  function onHtml() {
    if (!render?.html) return;
    void download(new Response(render.html, { headers: { 'content-disposition': `attachment; filename="${name()}.html"` } }), `${name()}.html`);
  }

  async function onFile(format: 'pdf' | 'docx') {
    setError(null);
    // A Word template's PDF is the one on screen.
    if (format === 'pdf' && word && pdfUrl) {
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

  const fileButton = (format: 'pdf' | 'docx', label: string) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={ready ? undefined : 0}>
          <Button size="sm" variant="outline" disabled={!ready || busy !== null} onClick={() => void onFile(format)}>
            {busy === format ? <Spinner /> : format === 'pdf' ? <FileDownIcon /> : <FileTextIcon />}
            {label}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint(format === 'pdf' ? 'a PDF' : 'a DOCX')}</TooltipContent>
    </Tooltip>
  );

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Preview">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2 text-sm">
        {header ?? <span className="font-medium">Preview</span>}
        <PageGroupSelect />
        <div className="ml-auto flex items-center gap-2">
          {word ? (
            fileButton('docx', 'DOCX')
          ) : (
            <Button size="sm" variant="outline" disabled={!render?.html} onClick={onHtml} title="Download this document as HTML">
              <FileCodeIcon />
              HTML
            </Button>
          )}
          {fileButton('pdf', 'PDF')}
        </div>
      </div>
      {error && (
        <ErrorNote detail={error.detail} className="rounded-none border-x-0 border-t-0 py-1.5 text-xs">
          {error.message}
        </ErrorNote>
      )}
      <div className="min-h-0 flex-1 bg-muted/30 p-2">
        {word && pdfUrl ? (
          <iframe title="Rendered document" src={pdfUrl} className="h-full w-full rounded border bg-white" />
        ) : !word && render?.html ? (
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
