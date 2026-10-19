'use client';

import { useRef, useState, useSyncExternalStore, type ComponentType, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Below this viewport width the panes stack as tabs. */
const SINGLE_PANE = 768;
const PHONE = `(max-width: ${SINGLE_PANE - 1}px)`;
const MIN_PX = 260;

function subscribePhone(onChange: () => void) {
  const media = window.matchMedia(PHONE);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/**
 * Two panes side by side with a divider to drag (or move with the arrow keys). On a
 * phone one pane shows at a time, picked with tabs. Both stay mounted.
 */
export function SplitPanes({
  left,
  right,
  labels,
  initial = 0.5,
}: {
  left: ReactNode;
  right: ReactNode;
  labels: [string, string];
  initial?: number;
}) {
  const [frac, setFrac] = useState(initial);
  const [phonePane, setPhonePane] = useState<0 | 1>(0);
  const single = useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);
  const box = useRef<HTMLDivElement>(null);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const min = Math.min(0.45, MIN_PX / rect.width);
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => setFrac(Math.min(Math.max((e.clientX - rect.left) / rect.width, min), 1 - min));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {single && (
        <div role="tablist" className="flex shrink-0 gap-1 border-b px-2">
          {labels.map((label, index) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={phonePane === index}
              onClick={() => setPhonePane(index as 0 | 1)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm',
                phonePane === index ? 'border-primary font-medium' : 'border-transparent text-muted-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div ref={box} className="flex min-h-0 flex-1">
        <div className="min-w-0" style={{ flex: `${frac} 1 0` }} hidden={single && phonePane !== 0}>
          {left}
        </div>
        {!single && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize ${labels[0]} and ${labels[1]}`}
            aria-valuenow={Math.round(frac * 100)}
            tabIndex={0}
            onPointerDown={startDrag}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') setFrac((f) => Math.max(0.15, f - 0.02));
              if (event.key === 'ArrowRight') setFrac((f) => Math.min(0.85, f + 0.02));
            }}
            className="w-1.5 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none"
          />
        )}
        <div className="min-w-0" style={{ flex: `${1 - frac} 1 0` }} hidden={single && phonePane !== 1}>
          {right}
        </div>
      </div>
    </div>
  );
}

/** One tab of `PaneTabs`: an optional icon before its label, and a tooltip. */
export interface PaneTab<T extends string> {
  id: T;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  title?: string;
}

/** Tabs at the top of a pane. A long row scrolls sideways; `end` stays on the right. */
export function PaneTabs<T extends string>({ tabs, value, onChange, end, label }: { tabs: PaneTab<T>[]; value: T; onChange(tab: T): void; end?: ReactNode; label?: string }) {
  return (
    <div className="flex h-10 shrink-0 items-end gap-1 border-b px-2">
      <div role="tablist" aria-label={label} className="-mb-px flex min-w-0 items-end gap-1 overflow-x-auto">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={value === item.id}
            aria-label={item.title ? item.label : undefined}
            title={item.title}
            onClick={() => onChange(item.id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm',
              value === item.id ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {item.icon && <item.icon className="size-4 shrink-0" />}
            {item.label}
          </button>
        ))}
      </div>
      {end && <div className="ml-auto flex shrink-0 items-center gap-1 self-center">{end}</div>}
    </div>
  );
}
