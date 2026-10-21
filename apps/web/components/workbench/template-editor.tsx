'use client';

import { FilePenLineIcon, RotateCcwIcon } from 'lucide-react';
import { useState } from 'react';
import { DocsLink } from '@/components/docs-link';
import { Hint } from '@/components/hint';
import { Button } from '@/components/ui/button';
import { CodeEditor } from './code-editor';
import { EditorBar, EditorMessage } from './editor-bar';
import { StartFromJobButton, StartFromJobDialog } from './start-from-job-dialog';
import { FileTemplate } from './file-template';
import { useWorkbench } from './workbench-provider';

/** The template shown: the HTML editor, or the Word or Excel template's file and problems. */
export function TemplateEditor() {
  const { content } = useWorkbench();
  return content.kind === 'html' ? <HtmlTemplateEditor /> : <FileTemplate kind={content.kind} />;
}

/**
 * The HTML (Carbone tags) of the template shown. Without one the preview uses a
 * starter template generated from the definition, which can be copied in to edit, as can
 * another job's template. Problems the tag check finds are listed by line.
 */
function HtmlTemplateEditor() {
  const { html, setHtml, render, readOnly } = useWorkbench();
  const [startFrom, setStartFrom] = useState(false);
  const shown = render?.template?.kind === 'html' ? render.template : undefined;
  const starter = html === null ? (shown?.generated ? shown.html : null) : null;
  const error = shown?.error;
  const detail = shown?.detail;
  const problems = shown?.problems ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorBar>
        {!readOnly && html === null && starter && (
          <Hint text="Copy the starter template made from the definition into the editor, so you can change it.">
            <Button size="sm" variant="ghost" onClick={() => setHtml(starter)}>
              <FilePenLineIcon />
              Start from the generated template
            </Button>
          </Hint>
        )}
        {!readOnly && html !== null && (
          <Hint text="Remove this HTML from the draft and use the starter template made from the definition. Saved versions keep their own HTML.">
            <Button size="sm" variant="ghost" onClick={() => setHtml(null)}>
              <RotateCcwIcon />
              Use the starter template
            </Button>
          </Hint>
        )}
        {!readOnly && (
          <StartFromJobButton onClick={() => setStartFrom(true)} />
        )}
        <DocsLink page="templates" anchor="the-data" className="ml-auto px-2">
          Tags and formatters
        </DocsLink>
      </EditorBar>
      {startFrom && <StartFromJobDialog onClose={() => setStartFrom(false)} />}
      {html === null && (
        <EditorMessage tone="note">
          This template has no HTML yet. The preview uses a starter template generated from the definition.
        </EditorMessage>
      )}
      {error && (
        <EditorMessage tone="error">
          {problems.length > 0 && `${problems.length === 1 ? '1 problem' : `${problems.length} problems`} to fix before the template renders:\n`}
          {error}
          {detail && (
            <details className="mt-1">
              <summary className="cursor-pointer select-none opacity-80 hover:opacity-100">Details</summary>
              <span className="font-mono">{detail}</span>
            </details>
          )}
        </EditorMessage>
      )}
      <CodeEditor
        value={html ?? ''}
        onChange={(next) => setHtml(next)}
        readOnly={readOnly}
        label="Template HTML"
        language="html"
        placeholder="<!doctype html> ... {d.pg.invoiceNo} ..."
      />
    </div>
  );
}
