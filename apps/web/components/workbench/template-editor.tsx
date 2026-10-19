'use client';

import { FolderInputIcon, RotateCcwIcon, WandSparklesIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CodeEditor } from './code-editor';
import { EditorBar, EditorMessage } from './editor-bar';
import { SaveStatus } from './save-status';
import { StartFromJobDialog } from './start-from-job-dialog';
import { useWorkbench } from './workbench-provider';

/**
 * The HTML template (Carbone tags) of the output shown. Without one the preview uses a
 * starter template generated from the definition, which can be copied in to edit, as can
 * another job's template. Problems the tag check finds are listed by line.
 */
export function TemplateEditor() {
  const { html, setHtml, render, readOnly } = useWorkbench();
  const [startFrom, setStartFrom] = useState(false);
  const starter = html === null ? (render?.template?.generated ? render.template.html : null) : null;
  const error = render?.template?.error;
  const detail = render?.template?.detail;
  const problems = render?.template?.problems ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorBar status={<SaveStatus />}>
        {!readOnly && html === null && starter && (
          <Button size="sm" variant="ghost" onClick={() => setHtml(starter)}>
            <WandSparklesIcon />
            Start from the generated template
          </Button>
        )}
        {!readOnly && html !== null && (
          <Button size="sm" variant="ghost" onClick={() => setHtml(null)} title="Remove the template and use the generated starter template">
            <RotateCcwIcon />
            Use the starter template
          </Button>
        )}
        {!readOnly && (
          <Button size="sm" variant="ghost" onClick={() => setStartFrom(true)} title="Copy a template of another job into this output, and on request its definition into this draft">
            <FolderInputIcon />
            Start from job
          </Button>
        )}
      </EditorBar>
      {startFrom && <StartFromJobDialog onClose={() => setStartFrom(false)} />}
      {html === null && (
        <EditorMessage tone="note">
          This output has no template yet. The preview uses a starter template generated from the definition.
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
        placeholder="<!doctype html> ... {d.doc.invoiceNo} ..."
      />
    </div>
  );
}
