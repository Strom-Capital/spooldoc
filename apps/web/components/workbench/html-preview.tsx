'use client';

import { FileCodeIcon, FileDownIcon } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useAppInfo } from '@/components/app-info';
import { ErrorNote } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ApiError, shownError, type ShownError } from '@/lib/client/api';
import { DocumentSelect } from './document-select';
import { useWorkbench } from './workbench-provider';

/** Save a response body as a file in the browser. */
async function download(response: Response, fallback: string): Promise<void> {
  const disposition = response.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallback;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * The rendered HTML of the current document in a sandboxed iframe (no scripts), and
 * buttons that download it as HTML or as a PDF rendered by Carbone from the text in the
 * editors. Without a working Carbone server it says where to set one up.
 *
 * @param header - Controls for the start of the pane header
 * @param fileName - The file name (without extension) of a document's files, from its name
 */
export function HtmlPreview({ header, fileName = (name) => name }: { header?: ReactNode; fileName?(documentName: string): string }) {
  const { render, jobId, documentIndex, yaml, html, outputId } = useWorkbench();
  const { rendering } = useAppInfo();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);
  const ready = rendering && !!render?.html;
  const hint = !rendering
    ? 'Connect Carbone in Settings to render documents'
    : !render?.html
      ? 'Nothing to print yet: fix the definition or the template first.'
      : 'Download this document as a PDF';

  /** The rendered HTML of this document as a file, named like the PDF. */
  function onHtml() {
    if (!render?.html) return;
    const name = fileName(render.names?.[documentIndex] ?? `document-${documentIndex + 1}`);
    void download(new Response(render.html, { headers: { 'content-disposition': `attachment; filename="${name}.html"` } }), `${name}.html`);
  }

  async function onPdf() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${jobId}/preview-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml, html, document: documentIndex, outputId }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new ApiError(response.status, data.error ?? `Could not make the PDF (HTTP ${response.status}).`, { detail: data.detail });
      }
      await download(response, `document-${documentIndex + 1}.pdf`);
    } catch (err) {
      setError(shownError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="HTML preview">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2 text-sm">
        {header ?? <span className="font-medium">Preview</span>}
        <DocumentSelect />
        <Button size="sm" variant="outline" className="ml-auto" disabled={!render?.html} onClick={onHtml} title="Download this document as HTML">
          <FileCodeIcon />
          HTML
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={ready ? undefined : 0}>
              <Button size="sm" variant="outline" disabled={!ready || busy} onClick={onPdf}>
                {busy ? <Spinner /> : <FileDownIcon />}
                PDF
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{hint}</TooltipContent>
        </Tooltip>
      </div>
      {error && (
        <ErrorNote detail={error.detail} className="rounded-none border-x-0 border-t-0 py-1.5 text-xs">
          {error.message}
        </ErrorNote>
      )}
      <div className="min-h-0 flex-1 bg-muted/30 p-2">
        {render?.html ? (
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
              : 'Nothing to show yet: the preview needs a definition that finds documents.'}
          </p>
        )}
      </div>
    </section>
  );
}
