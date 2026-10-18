'use client';

import { BracesIcon, FileTextIcon, PanelRightIcon, type LucideIcon } from 'lucide-react';
import { useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { useSession } from '@/components/session-provider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ChatPanel } from './chat-panel';
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

type RightTab = 'preview' | 'chat';

const RIGHT_TABS: { id: RightTab; label: string }[] = [
  { id: 'preview', label: 'Preview' },
  { id: 'chat', label: 'Chat' },
];

type Pane = 'page' | 'data' | 'output';

const PANES: { id: Pane; label: string; icon: LucideIcon }[] = [
  { id: 'page', label: 'Spooled page', icon: FileTextIcon },
  { id: 'data', label: 'JSON, definition and template', icon: BracesIcon },
  { id: 'output', label: 'Preview and chat', icon: PanelRightIcon },
];

/** Smallest pane width while dragging, in pixels. */
const MIN_PX = 240;
/** Below this viewport width only one pane shows at a time. */
const SINGLE_PANE = 768;
/** Below this viewport width the workbench starts with two panes. */
const TWO_PANES = 1440;
const STORAGE_KEY = 'spooldoc.workbench.panes';

/** The workbench for one sample: top bar and up to three resizable panes; the right one holds the preview and the chat. */
export function Workbench({ sampleId }: { sampleId: string }) {
  return (
    <WorkbenchProvider sampleId={sampleId}>
      <WorkbenchLayout />
    </WorkbenchProvider>
  );
}

const subscribeNothing = () => () => undefined;

function subscribeMedia(query: string) {
  return (onChange: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  };
}

const PHONE = `(max-width: ${SINGLE_PANE - 1}px)`;
const WIDE = `(min-width: ${TWO_PANES}px)`;
const subscribePhone = subscribeMedia(PHONE);
const subscribeWide = subscribeMedia(WIDE);

function readSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function parsePanes(saved: string | null): Record<Pane, boolean> | null {
  try {
    const panes = JSON.parse(saved ?? 'null') as Record<Pane, boolean> | null;
    return panes && PANES.some((pane) => panes[pane.id]) ? panes : null;
  } catch {
    return null;
  }
}

function writePanes(panes: Record<Pane, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(panes));
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
}

function WorkbenchLayout() {
  const { error, tab, setTab, selectedHit } = useWorkbench();
  const { session } = useSession();
  // Relative pane widths (flex-grow), so hiding a pane gives its room to the others.
  const [weights, setWeights] = useState<Record<Pane, number>>({ page: 36, data: 32, output: 32 });
  // On a phone one pane shows at a time; elsewhere the user's choice, else the saved one,
  // else all three on a wide screen and the page and data on a laptop.
  const single = useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => true);
  const saved = useSyncExternalStore(subscribeNothing, readSaved, () => null);
  const [choice, setChoice] = useState<Record<Pane, boolean> | null>(null);
  const [singlePane, setSinglePane] = useState<Pane>('data');
  const shown: Record<Pane, boolean> = single
    ? { page: false, data: false, output: false, [singlePane]: true }
    : (choice ?? parsePanes(saved) ?? { page: true, data: true, output: wide });
  // The chat opens first when a model is configured, until the user picks a tab.
  const [rightChoice, setRightChoice] = useState<RightTab | null>(null);
  const right: RightTab = rightChoice ?? (session?.model ? 'chat' : 'preview');
  const pageRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const refs = { page: pageRef, data: dataRef, output: outputRef };

  const show = (next: Record<Pane, boolean>) => {
    setChoice(next);
    writePanes(next);
  };
  const toggle = (pane: Pane) => {
    if (single) {
      setSinglePane(pane);
      return;
    }
    const next = { ...shown, [pane]: !shown[pane] };
    if (PANES.some((p) => next[p.id])) show(next);
  };

  // A field picked on the page, or a tab switched by the chat, needs the data pane.
  const [last, setLast] = useState({ tab, selectedHit });
  if (tab !== last.tab || selectedHit !== last.selectedHit) {
    setLast({ tab, selectedHit });
    if (single) setSinglePane('data');
    else if (!shown.data) setChoice({ ...shown, data: true });
  }

  const visible = PANES.filter((pane) => shown[pane.id]).map((pane) => pane.id);

  const startDrag = (a: Pane, b: Pane, event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const left = refs[a].current?.getBoundingClientRect();
    const rightBox = refs[b].current?.getBoundingClientRect();
    if (!left || !rightBox) return;
    const span = rightBox.right - left.left;
    const min = Math.min(0.45, MIN_PX / span);
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const frac = Math.min(Math.max((e.clientX - left.left) / span, min), 1 - min);
      setWeights((w) => {
        const sum = w[a] + w[b];
        return { ...w, [a]: sum * frac, [b]: sum * (1 - frac) };
      });
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  const nudge = (a: Pane, b: Pane, delta: number) =>
    setWeights((w) => {
      const sum = w[a] + w[b];
      const frac = Math.min(Math.max(w[a] / sum + delta, 0.15), 0.85);
      return { ...w, [a]: sum * frac, [b]: sum * (1 - frac) };
    });

  /** The divider before `pane`, when a shown pane sits to its left. */
  const divider = (pane: Pane) => {
    const index = visible.indexOf(pane);
    if (index <= 0) return null;
    const a = visible[index - 1]!;
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panes"
        aria-valuenow={Math.round((weights[a] / (weights[a] + weights[pane])) * 100)}
        tabIndex={0}
        onPointerDown={(event) => startDrag(a, pane, event)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') nudge(a, pane, -0.02);
          if (event.key === 'ArrowRight') nudge(a, pane, 0.02);
        }}
        className="w-1.5 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none"
      />
    );
  };

  // Every pane stays mounted, so a running chat keeps streaming and scroll positions hold while hidden.
  const paneProps = (pane: Pane) => ({
    style: { flex: `${weights[pane]} 1 0` },
    hidden: !shown[pane],
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar controls={<PaneToggles shown={shown} onToggle={toggle} single={single} />} />
      {error && (
        <p role="alert" className="border-b bg-destructive/10 px-4 py-2 text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <div ref={pageRef} className="min-w-0" {...paneProps('page')}>
          <PageView />
        </div>
        {divider('data')}
        <div ref={dataRef} className={cn('min-w-0 flex-col', shown.data && 'flex')} {...paneProps('data')}>
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
        {divider('output')}
        <div ref={outputRef} className={cn('min-w-0 flex-col', shown.output && 'flex')} {...paneProps('output')}>
          <div className={cn('min-h-0 flex-1', right !== 'preview' && 'hidden')}>
            <HtmlPreview header={<RightTabs value={right} onChange={setRightChoice} />} />
          </div>
          <div className={cn('min-h-0 flex-1', right !== 'chat' && 'hidden')}>
            <ChatPanel header={<RightTabs value={right} onChange={setRightChoice} />} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Icon toggles that show and hide the three panes; on a phone they pick the one pane. */
function PaneToggles({ shown, onToggle, single }: { shown: Record<Pane, boolean>; onToggle: (pane: Pane) => void; single: boolean }) {
  return (
    <div role="group" aria-label="Panes" className="flex shrink-0 items-center gap-0.5 rounded-md bg-muted p-0.5">
      {PANES.map((pane) => (
        <Tooltip key={pane.id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-pressed={shown[pane.id]}
              aria-label={`${single ? 'Show' : shown[pane.id] ? 'Hide' : 'Show'} ${pane.label.toLowerCase()}`}
              onClick={() => onToggle(pane.id)}
              className={cn(
                'flex size-7 items-center justify-center rounded [&_svg]:size-4',
                shown[pane.id] ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <pane.icon />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{pane.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

/** The Preview and Chat tabs at the start of the right pane's header. */
function RightTabs({ value, onChange }: { value: RightTab; onChange: (tab: RightTab) => void }) {
  return (
    <div role="tablist" aria-label="Preview and chat" className="flex shrink-0 items-center gap-0.5 rounded-md bg-muted p-0.5">
      {RIGHT_TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          onClick={() => onChange(item.id)}
          className={cn(
            'rounded px-2.5 py-0.5 text-sm',
            value === item.id ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
