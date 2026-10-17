'use client';

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@/lib/utils';
import { DefinitionEditor } from './definition-editor';
import { HtmlPreview } from './html-preview';
import { JsonView } from './json-view';
import { PageView } from './page-view';
import { TemplateEditor } from './template-editor';
import { TopBar } from './top-bar';
import { useWorkbench, WorkbenchProvider, type WorkbenchTab } from './workbench-provider';

const TABS: { id: WorkbenchTab; label: string }[] = [
  { id: 'json', label: 'JSON' },
  { id: 'definition', label: 'Definition' },
  { id: 'template', label: 'Template' },
];

/** Smallest pane width, in percent of the workbench. */
const MIN = 15;

/** The workbench for one sample: top bar and three resizable panes. */
export function Workbench({ sampleId }: { sampleId: string }) {
  return (
    <WorkbenchProvider sampleId={sampleId}>
      <WorkbenchLayout />
    </WorkbenchProvider>
  );
}

function WorkbenchLayout() {
  const { error, tab, setTab } = useWorkbench();
  // Pane widths in percent; the last pane takes the rest. A fourth pane (chat) can be added here.
  const [widths, setWidths] = useState<[number, number]>([42, 30]);
  const container = useRef<HTMLDivElement>(null);

  const startDrag = useCallback((divider: 0 | 1, event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const box = container.current?.getBoundingClientRect();
    if (!box) return;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const pct = ((e.clientX - box.left) / box.width) * 100;
      setWidths(([a, b]) => {
        if (divider === 0) {
          const left = Math.min(Math.max(pct, MIN), 100 - b - MIN);
          return [left, b];
        }
        const middle = Math.min(Math.max(pct - a, MIN), 100 - a - MIN);
        return [a, middle];
      });
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }, []);

  const nudge = (divider: 0 | 1, delta: number) =>
    setWidths(([a, b]) =>
      divider === 0
        ? [Math.min(Math.max(a + delta, MIN), 100 - b - MIN), b]
        : [a, Math.min(Math.max(b + delta, MIN), 100 - a - MIN)],
    );

  const divider = (index: 0 | 1) => (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panes"
      aria-valuenow={Math.round(index === 0 ? widths[0] : widths[0] + widths[1])}
      tabIndex={0}
      onPointerDown={(event) => startDrag(index, event)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') nudge(index, -2);
        if (event.key === 'ArrowRight') nudge(index, 2);
      }}
      className="w-1.5 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none"
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar />
      {error && (
        <p role="alert" className="border-b bg-destructive/10 px-4 py-2 text-destructive text-sm">
          {error}
        </p>
      )}
      <div ref={container} className="flex min-h-0 flex-1">
        <div className="min-w-0" style={{ width: `${widths[0]}%` }}>
          <PageView />
        </div>
        {divider(0)}
        <div className="flex min-w-0 flex-col" style={{ width: `${widths[1]}%` }}>
          <div role="tablist" aria-label="Data and files" className="flex h-10 shrink-0 items-end gap-1 border-b px-2">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className={cn(
                  '-mb-px border-b-2 px-3 py-2 text-sm',
                  tab === item.id ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="min-h-0 flex-1">
            {tab === 'json' && <JsonView />}
            {tab === 'definition' && <DefinitionEditor />}
            {tab === 'template' && <TemplateEditor />}
          </div>
        </div>
        {divider(1)}
        <div className="min-w-0 flex-1">
          <HtmlPreview />
        </div>
      </div>
    </div>
  );
}
