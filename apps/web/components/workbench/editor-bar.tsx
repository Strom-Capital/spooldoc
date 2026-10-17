'use client';

import { EyeIcon, SaveIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/** Preview and Save buttons with a status line, above an editor. */
export function EditorBar({
  onPreview,
  onSave,
  saveLabel,
  saveDisabled,
  busy,
  status,
  children,
}: {
  onPreview: () => void;
  onSave: () => void;
  saveLabel: string;
  saveDisabled?: boolean;
  busy: 'preview' | 'save' | null;
  status?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-1.5 border-b px-2 py-1 text-sm">
      <Button size="sm" variant="outline" onClick={onPreview} disabled={busy !== null}>
        {busy === 'preview' ? <Spinner /> : <EyeIcon />}
        Preview
      </Button>
      <Button size="sm" onClick={onSave} disabled={busy !== null || saveDisabled}>
        {busy === 'save' ? <Spinner /> : <SaveIcon />}
        {saveLabel}
      </Button>
      {children}
      {status && <span className="ml-auto text-muted-foreground text-xs">{status}</span>}
    </div>
  );
}

/** An error or note shown above an editor. */
export function EditorMessage({ tone, children }: { tone: 'error' | 'note'; children: ReactNode }) {
  return (
    <pre
      role={tone === 'error' ? 'alert' : undefined}
      className={
        tone === 'error'
          ? 'max-h-40 shrink-0 overflow-auto whitespace-pre-wrap border-b bg-destructive/10 px-3 py-2 font-sans text-destructive text-xs'
          : 'shrink-0 whitespace-pre-wrap border-b bg-muted/50 px-3 py-2 font-sans text-muted-foreground text-xs'
      }
    >
      {children}
    </pre>
  );
}
