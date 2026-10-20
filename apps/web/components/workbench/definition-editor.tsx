'use client';

import { CodeEditor } from './code-editor';
import { EditorMessage } from './editor-bar';
import { useWorkbench } from './workbench-provider';

/** The definition YAML of the job. Changes are saved to the draft and rendered as you type. */
export function DefinitionEditor() {
  const { yaml, setYaml, render, readOnly } = useWorkbench();
  const error = render?.definition?.error;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {error && <EditorMessage tone="error">{error}</EditorMessage>}
      <CodeEditor
        value={yaml}
        onChange={setYaml}
        readOnly={readOnly}
        label="Definition YAML"
        language="yaml"
        placeholder={'type: invoice\nversion: 1\nsource: text\ntext:\n  page: { width: 132, length: 66 }\n  fields: []'}
      />
    </div>
  );
}
