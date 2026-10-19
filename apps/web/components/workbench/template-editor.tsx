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
 * The HTML template (Nunjucks) of the output shown. Without one the preview uses a starter
 * template generated from the definition, which can be copied in to edit, as can
 * another job's template.
 */
export function TemplateEditor() {
  const { html, setHtml, render, readOnly } = useWorkbench();
  const [startFrom, setStartFrom] = useState(false);
  const starter = html === null ? (render?.template?.generated ? render.template.html : null) : null;
  const error = render?.template?.error;
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
      {error && <EditorMessage tone="error">{error}</EditorMessage>}
      <CodeEditor
        value={html ?? ''}
        onChange={(next) => setHtml(next)}
        readOnly={readOnly}
        label="Template HTML"
        language="html"
        placeholder="<!doctype html> ... {{ doc.invoiceNo }} ..."
      />
    </div>
  );
}
