'use client';

import { Children, type ReactNode } from 'react';

/** A bar of actions above an editor; nothing when there are none. The save status is on the tab row. */
export function EditorBar({ children }: { children?: ReactNode }) {
  if (Children.toArray(children).length === 0) {
    return null;
  }
  return <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-1.5 border-b px-2 py-1 text-sm">{children}</div>;
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
