'use client';

import { useState } from 'react';
import { api, errorText } from '@/lib/client/api';
import { yamlType } from '@/lib/client/render';
import { CodeEditor } from './code-editor';
import { EditorBar, EditorMessage } from './editor-bar';
import { useWorkbench } from './workbench-provider';

/**
 * The definition YAML. Preview renders with the unsaved text; Save writes
 * `definitions/<type>.yaml` and links the sample to the type when it is not linked yet.
 */
export function DefinitionEditor() {
  const { sampleId, render, drafts, setDraft, preview, reload } = useWorkbench();
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'note'; text: string } | null>(null);
  const saved = render?.definition?.yaml ?? '';
  const value = drafts.yaml ?? saved;
  const linked = render?.sample.definition;
  const type = linked ?? yamlType(value);
  const error = render?.definition?.error;

  async function onPreview() {
    setBusy('preview');
    setMessage(null);
    await preview({ yaml: value });
    setBusy(null);
  }

  async function onSave() {
    if (!type) {
      setMessage({ tone: 'error', text: 'Add a `type:` line (lowercase letters, digits and dashes) or link a type first.' });
      return;
    }
    setBusy('save');
    setMessage(null);
    try {
      await api(`/api/files/definitions/${encodeURIComponent(type)}`, { method: 'PUT', body: { content: value } });
      if (!linked) {
        await api(`/api/samples/${encodeURIComponent(sampleId)}/definition`, { method: 'POST', body: { type } });
      }
      setDraft('yaml', null);
      await reload();
      setMessage({ tone: 'note', text: `Saved definitions/${type}.yaml${linked ? '' : ' and linked this sample'}.` });
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorBar
        onPreview={onPreview}
        onSave={onSave}
        saveLabel={type ? `Save as ${type}` : 'Save'}
        busy={busy}
        status={drafts.yaml !== null && drafts.yaml !== saved ? 'Unsaved changes' : undefined}
      />
      {error && <EditorMessage tone="error">{error}</EditorMessage>}
      {message && <EditorMessage tone={message.tone}>{message.text}</EditorMessage>}
      <CodeEditor
        value={value}
        onChange={(next) => setDraft('yaml', next)}
        label="Definition YAML"
        placeholder={'type: invoice\nversion: 1\nsource: text\ntext:\n  page: { width: 132, length: 66 }\n  fields: []'}
      />
    </div>
  );
}
