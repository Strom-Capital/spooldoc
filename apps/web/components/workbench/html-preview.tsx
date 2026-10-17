'use client';

import { FileDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSession } from '@/components/session-provider';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DocumentSelect } from './document-select';
import { useWorkbench } from './workbench-provider';

/**
 * The rendered HTML of the current document in a sandboxed iframe (no scripts), and a PDF link.
 *
 * @param header - Controls for the start of the pane header (the Preview and Chat tabs)
 */
export function HtmlPreview({ header }: { header?: ReactNode }) {
  const { render, sampleId, documentIndex, drafts } = useWorkbench();
  const { session } = useSession();
  const pdf = session?.pdf === true;
  const unsaved = drafts.yaml !== null || drafts.html !== null;
  const pdfHref = `/api/pdf/${encodeURIComponent(sampleId)}?document=${documentIndex}`;
  const pdfHint = !pdf
    ? 'Set SPOOLDOC_CHROMIUM_PATH to render PDFs'
    : !render?.html
      ? 'Nothing to print yet: fix the definition or the template first.'
      : unsaved
        ? 'Opens the PDF of the saved definition and template in a new tab.'
        : 'Open the PDF of this document in a new tab';

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="HTML preview">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2 text-sm">
        {header ?? <span className="font-medium">Preview</span>}
        <DocumentSelect />
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-auto" tabIndex={pdf && render?.html ? undefined : 0}>
              {pdf && render?.html ? (
                <Button asChild size="sm" variant="outline">
                  <a href={pdfHref} target="_blank" rel="noopener noreferrer">
                    <FileDownIcon />
                    PDF
                  </a>
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled>
                  <FileDownIcon />
                  PDF
                </Button>
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent>{pdfHint}</TooltipContent>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 bg-muted/30 p-2">
        {render?.html ? (
          <iframe
            title="Rendered document"
            sandbox=""
            srcDoc={render.html}
            className="h-full w-full rounded border bg-white"
          />
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
