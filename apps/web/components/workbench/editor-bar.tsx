'use client';

import type { ReactNode } from 'react';

/** A bar above an editor: actions on the left, the save status on the right. */
export function EditorBar({ status, children }: { status?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-1.5 border-b px-2 py-1 text-sm">
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
