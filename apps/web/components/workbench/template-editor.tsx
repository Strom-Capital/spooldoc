'use client';

import { WandSparklesIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { api, errorText } from '@/lib/client/api';
import { CodeEditor } from './code-editor';
import { EditorBar, EditorMessage } from './editor-bar';
import { useWorkbench } from './workbench-provider';

/**
 * The HTML template (Nunjucks). Preview renders with the unsaved text; Save writes
 * `templates/<type>.html`. A generated starter template can be copied in to edit.
 */
export function TemplateEditor() {
  const { render, drafts, setDraft, preview, reload } = useWorkbench();
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'note'; text: string } | null>(null);
  const generated = render?.template?.generated === true;
  const saved = generated ? '' : (render?.template?.html ?? '');
  const value = drafts.html ?? saved;
  const type = render?.sample.definition ?? render?.definition?.type ?? null;
  const error = render?.template?.error;

  async function onPreview() {
    setBusy('preview');
    setMessage(null);
    await preview({ html: value.trim() ? value : null });
    setBusy(null);
  }

  async function onSave() {
    if (!type) {
      setMessage({ tone: 'error', text: 'Save a definition first: the template is saved under its type.' });
      return;
    }
    setBusy('save');
    setMessage(null);
    try {
      await api(`/api/files/templates/${encodeURIComponent(type)}`, { method: 'PUT', body: { content: value } });
      setDraft('html', null);
      await reload();
      setMessage({ tone: 'note', text: `Saved templates/${type}.html.` });
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
        saveDisabled={!type || !value.trim()}
        busy={busy}
        status={drafts.html !== null && drafts.html !== saved ? 'Unsaved changes' : undefined}
      >
        {generated && drafts.html === null && (
          <Button size="sm" variant="ghost" onClick={() => setDraft('html', render?.template?.html ?? '')}>
            <WandSparklesIcon />
            Start from the generated template
          </Button>
        )}
      </EditorBar>
      {generated && drafts.html === null && (
        <EditorMessage tone="note">
          No template is saved for this type yet. The preview uses a generated starter template.
        </EditorMessage>
      )}
      {error && <EditorMessage tone="error">{error}</EditorMessage>}
      {message && <EditorMessage tone={message.tone}>{message.text}</EditorMessage>}
      <CodeEditor
        value={value}
        onChange={(next) => setDraft('html', next)}
        label="Template HTML"
        language="html"
        placeholder="<!doctype html> ... {{ doc.invoiceNo }} ..."
      />
    </div>
  );
}
