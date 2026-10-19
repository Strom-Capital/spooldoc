'use client';

import { FileCodeIcon, FileDownIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useAppInfo } from '@/components/app-info';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/client/api';
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
 * buttons that download it as HTML or as a PDF rendered from the text in the editors.
 *
 * @param header - Controls for the start of the pane header
 * @param fileName - The file name (without extension) of a document's files, from its name
 */
export function HtmlPreview({ header, fileName = (name) => name }: { header?: ReactNode; fileName?(documentName: string): string }) {
  const { render, jobId, documentIndex, yaml, html, outputId } = useWorkbench();
  const { pdf } = useAppInfo();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = pdf && !!render?.html;
  const hint = !pdf
    ? 'Set SPOOLDOC_CHROMIUM_PATH to render PDFs'
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
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(response.status, data.error ?? `PDF failed (HTTP ${response.status}).`);
      }
      await download(response, `document-${documentIndex + 1}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF failed.');
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
        <p role="alert" className="border-b bg-destructive/10 px-3 py-1.5 text-destructive text-xs">
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1 bg-muted/30 p-2">
        {render?.html ? (
          <iframe title="Rendered document" sandbox="" srcDoc={render.html} className="h-full w-full rounded border bg-white" />
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
