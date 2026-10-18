'use client';

import '@xyflow/react/dist/style.css';

import { Handle, Position, ReactFlow, useReactFlow, useStore, type Edge, type Node, type NodeProps } from '@xyflow/react';
import {
  CheckCheckIcon,
  FileJsonIcon,
  FileTextIcon,
  InboxIcon,
  PlayIcon,
  RadioIcon,
  SendIcon,
  type LucideIcon,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useWorkbench } from '@/components/workbench/workbench-provider';
import { cn } from '@/lib/utils';
import { useJob, type Step } from './job-provider';

/** How a step looks in the strip. */
export type StepStatus = 'unset' | 'ok' | 'warn' | 'error';

interface StepInfo {
  step: Step;
  title: string;
  icon: LucideIcon;
  detail: string;
  sub?: string;
  status: StepStatus;
}

type StepData = StepInfo & { selected: boolean; onSelect(step: Step): void } & Record<string, unknown>;

type StepNode = Node<StepData, 'step'>;

const DOT: Record<StepStatus, string> = {
  unset: 'bg-muted-foreground/40',
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  error: 'bg-destructive',
};

const STATUS_LABEL: Record<StepStatus, string> = { unset: 'Not set', ok: 'Ready', warn: 'Check', error: 'Problem' };

const NODE_WIDTH = 184;
const NODE_HEIGHT = 76;
const HANDLE = 6;

/**
 * The size and handle positions of every step, given up front. React Flow forgets a
 * node's measured size whenever it gets a new node object (the strip rebuilds them on
 * every change), and an unmeasured node is hidden and its edges dropped until it is
 * measured again, which never happens when its size does not change. Known sizes make
 * the steps and connectors render every time, and the strip can be fitted at once.
 */
const NODE_SIZE = {
  width: NODE_WIDTH,
  height: NODE_HEIGHT,
  handles: [
    { type: 'target' as const, position: Position.Left, x: -HANDLE / 2, y: NODE_HEIGHT / 2 - HANDLE / 2, width: HANDLE, height: HANDLE },
    { type: 'source' as const, position: Position.Right, x: NODE_WIDTH - HANDLE / 2, y: NODE_HEIGHT / 2 - HANDLE / 2, width: HANDLE, height: HANDLE },
  ],
};
const GAP = 36;

function StepCard({ data }: NodeProps<StepNode>) {
  const Icon = data.icon;
  return (
    <button
      type="button"
      onClick={() => data.onSelect(data.step)}
      aria-pressed={data.selected}
      aria-label={`${data.title}: ${data.detail}. ${STATUS_LABEL[data.status]}`}
      className={cn(
        // NODE_SIZE: one size for every step, so the handles line up and the connectors stay level.
        'nodrag nopan flex h-[76px] w-[184px] cursor-pointer flex-col justify-start gap-1 rounded-lg border bg-card px-3 py-2 text-left shadow-xs transition-colors hover:border-primary/60',
        data.selected && 'border-primary ring-2 ring-primary/25',
      )}
    >
      <Handle type="target" position={Position.Left} className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-border" isConnectable={false} />
      <span className="flex items-center gap-1.5 font-medium text-sm">
        <Icon className="size-4 text-primary" aria-hidden />
        {data.title}
        <span className={cn('ml-auto size-2 rounded-full', DOT[data.status])} title={STATUS_LABEL[data.status]} />
      </span>
      <span className="truncate text-xs" title={data.detail}>
        {data.detail}
      </span>
      {data.sub && (
        <span className="truncate text-[11px] text-muted-foreground" title={data.sub}>
          {data.sub}
        </span>
      )}
      <Handle type="source" position={Position.Right} className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-border" isConnectable={false} />
    </button>
  );
}

const nodeTypes = { step: StepCard };

const subscribeNothing = () => () => undefined;

/** Smallest zoom at which the step text is still readable. */
const MIN_ZOOM = 0.45;
const PAD = 12;
const STEPS = 6;
const TOTAL_WIDTH = STEPS * NODE_WIDTH + (STEPS - 1) * GAP;

/**
 * Fit the steps whenever the strip changes size (the sidebars or the window). When all
 * six do not fit at a readable size, start at Source and let the strip be dragged.
 */
function FitOnResize() {
  const { setViewport } = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  useEffect(() => {
    if (width <= 0 || height <= 0) {
      return;
    }
    const zoom = Math.min(1, (width - 2 * PAD) / TOTAL_WIDTH, (height - 2 * PAD) / NODE_HEIGHT);
    if (zoom >= MIN_ZOOM) {
      void setViewport({ x: (width - TOTAL_WIDTH * zoom) / 2, y: (height - NODE_HEIGHT * zoom) / 2, zoom });
    } else {
      void setViewport({ x: PAD, y: (height - NODE_HEIGHT * MIN_ZOOM) / 2, zoom: MIN_ZOOM });
    }
  }, [width, height, setViewport]);
  return null;
}

/** Title, detail line and status of each step, from the spec and the latest render. */
function useSteps(): StepInfo[] {
  const { spec, job, servers, destinations } = useJob();
  const { render, sampleId } = useWorkbench();
  const server = servers.find((s) => s.id === spec.source.serverId);
  const hasSource = !!spec.source.serverId && !!spec.source.library && !!spec.source.queue;
  const extract = render?.extract;
  const missing = extract ? new Set(extract.hits.filter((h) => h.status === 'missing').map((h) => h.name)).size : 0;
  const destination = destinations.find((d) => d.id === spec.destination.destinationId);
  const finish = spec.finish;

  const extractStatus: StepStatus = !spec.extract.definition.trim()
    ? 'unset'
    : render?.definition?.error
      ? 'error'
      : !extract
        ? 'unset'
        : extract.documents.length === 0 || missing > 0
          ? 'warn'
          : 'ok';

  return [
    {
      step: 'source',
      title: 'Source',
      icon: InboxIcon,
      detail: hasSource ? `${spec.source.library}/${spec.source.queue}` : 'Pick a server and queue',
      sub: server?.name,
      status: hasSource ? (server?.lastError ? 'warn' : 'ok') : 'unset',
    },
    {
      step: 'trigger',
      title: 'Trigger',
      icon: spec.trigger.mode === 'watch' ? RadioIcon : PlayIcon,
      detail: spec.trigger.mode === 'watch' ? 'Watching the queue' : 'On demand',
      sub: job.paused ? 'Paused' : spec.trigger.mode === 'watch' && job.lastWatchError ? job.lastWatchError : undefined,
      status: spec.trigger.mode === 'watch' && (job.lastWatchError || job.paused) ? 'warn' : 'ok',
    },
    {
      step: 'extract',
      title: 'Extract',
      icon: FileJsonIcon,
      detail: !spec.extract.definition.trim()
        ? 'Write a definition'
        : extract
          ? `${extract.documents.length} ${extract.documents.length === 1 ? 'document' : 'documents'}`
          : sampleId
            ? 'Definition to JSON'
            : 'Pick a spooled file',
      sub: extract ? (missing > 0 ? `${missing} missing ${missing === 1 ? 'field' : 'fields'}` : 'Every field found') : undefined,
      status: extractStatus,
    },
    {
      step: 'render',
      title: 'Render',
      icon: FileTextIcon,
      detail: spec.render.template === null ? 'Starter template' : 'Custom template',
      sub: render?.template?.error ? 'Template has errors' : spec.render.formats.map((f) => f.toUpperCase()).join(' and '),
      status: render?.template?.error ? 'error' : render?.html ? 'ok' : 'unset',
    },
    {
      step: 'destination',
      title: 'Destination',
      icon: SendIcon,
      detail: destination?.name ?? 'Pick a destination',
      status: destination ? 'ok' : 'unset',
    },
    {
      step: 'finish',
      title: 'Finish',
      icon: CheckCheckIcon,
      detail:
        finish.action === 'hold'
          ? 'Hold the spooled file'
          : finish.action === 'move'
            ? finish.queue
              ? `Move to ${finish.queue.library}/${finish.queue.name}`
              : 'Move: pick a queue'
            : finish.action === 'delete'
              ? 'Delete the spooled file'
              : 'Leave as is',
      status: finish.action === 'move' && !finish.queue ? 'unset' : finish.action === 'delete' ? 'warn' : 'ok',
    },
  ];
}

/**
 * The job as a pipeline: six fixed steps joined left to right. Clicking a step opens
 * it in the inspector below. Steps cannot be moved or connected.
 */
export function PipelineStrip() {
  const { step, setStep } = useJob();
  const { resolvedTheme } = useTheme();
  // The theme is only known in the browser; the first render matches the server's.
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const steps = useSteps();

  const nodes = useMemo<StepNode[]>(
    () =>
      steps.map((data, index) => ({
        id: data.step,
        type: 'step',
        position: { x: index * (NODE_WIDTH + GAP), y: 0 },
        ...NODE_SIZE,
        data: { ...data, selected: data.step === step, onSelect: setStep },
        draggable: false,
        connectable: false,
        selectable: false,
      })),
    [steps, step, setStep],
  );
  const edges = useMemo<Edge[]>(
    () =>
      steps.slice(1).map((data, index) => ({
        id: `${steps[index]!.step}-${data.step}`,
        source: steps[index]!.step,
        target: data.step,
        type: 'straight',
        style: { strokeWidth: 1.5 },
      })),
    [steps],
  );

  return (
    <div className="h-[118px] w-full" aria-label="Pipeline">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        minZoom={MIN_ZOOM}
        maxZoom={1}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        panOnScroll={false}
        panOnDrag
        preventScrolling={false}
        colorMode={hydrated && resolvedTheme === 'dark' ? 'dark' : 'light'}
        // A click handler keeps React Flow from making the nodes ignore the pointer.
        onNodeClick={(_, node) => setStep(node.id as Step)}
      >
        <FitOnResize />
      </ReactFlow>
    </div>
  );
}
