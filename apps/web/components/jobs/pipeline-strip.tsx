'use client';

import '@xyflow/react/dist/style.css';

import { Handle, MarkerType, Position, ReactFlow, useReactFlow, useStore, type Edge, type Node, type NodeProps } from '@xyflow/react';
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
import { useAppInfo } from '@/components/app-info';
import { useWorkbench } from '@/components/workbench/workbench-provider';
import { STEP_TITLE, STEPS } from '@/lib/client/job-steps';
import { missingFields, type StepStatus } from '@/lib/client/step-status';
import { contentLabel, formatList, hasOwnContent, type TemplateContent } from '@/lib/job-spec';
import { cn } from '@/lib/utils';
import { useJob, type Step } from './job-provider';
import { useStepStatuses } from './use-step-statuses';

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
      <Handle type="target" position={Position.Left} className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent" isConnectable={false} />
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
      <Handle type="source" position={Position.Right} className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent" isConnectable={false} />
    </button>
  );
}

const nodeTypes = { step: StepCard };

const subscribeNothing = () => () => undefined;

/** Smallest zoom at which the step text is still readable. */
const MIN_ZOOM = 0.45;
const PAD = 12;
/** Room kept under the steps for Hide pipeline, which the job builder centers there. */
const BUTTON_BAND = 26;
const TOTAL_WIDTH = STEPS.length * NODE_WIDTH + (STEPS.length - 1) * GAP;

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
    const room = height - BUTTON_BAND;
    const zoom = Math.min(1, (width - 2 * PAD) / TOTAL_WIDTH, room / NODE_HEIGHT);
    if (zoom >= MIN_ZOOM) {
      void setViewport({ x: (width - TOTAL_WIDTH * zoom) / 2, y: (room - NODE_HEIGHT * zoom) / 2, zoom });
    } else {
      void setViewport({ x: PAD, y: (room - NODE_HEIGHT * MIN_ZOOM) / 2, zoom: MIN_ZOOM });
    }
  }, [width, height, setViewport]);
  return null;
}

/** Title, detail line and status of each step, from the spec and the latest render. */
function useSteps(): StepInfo[] {
  const { spec, job, servers, destinations } = useJob();
  const { render, sampleId, templateId } = useWorkbench();
  const { rendering } = useAppInfo();
  const { statuses } = useStepStatuses();
  const server = servers.find((s) => s.id === spec.source.serverId);
  const hasSource = !!spec.source.serverId && !!spec.source.library && !!spec.source.queue;
  const extract = render?.extract;
  const missing = extract ? missingFields(extract) : 0;
  const destination = destinations.find((d) => d.id === spec.destination.destinationId);
  const finish = spec.finish;
  const templates = spec.render.templates;
  const picked = templates.find((t) => t.id === templateId) ?? templates[0];

  return [
    {
      step: 'source',
      title: STEP_TITLE.source,
      icon: InboxIcon,
      detail: hasSource ? `${spec.source.library}/${spec.source.queue}` : 'Pick a server and queue',
      sub: server?.name,
      status: statuses.source,
    },
    {
      step: 'trigger',
      title: STEP_TITLE.trigger,
      icon: spec.trigger.mode === 'watch' ? RadioIcon : PlayIcon,
      detail: spec.trigger.mode === 'watch' ? 'Watching the queue' : 'On demand',
      sub: job.paused
        ? 'Paused'
        : spec.trigger.mode === 'watch' && job.lastWatchError
          ? job.lastWatchError
          : spec.trigger.mode === 'watch' && job.realtimeError
            ? 'Polled: real-time watching stopped'
            : undefined,
      status: statuses.trigger,
    },
    {
      step: 'extract',
      title: STEP_TITLE.extract,
      icon: FileJsonIcon,
      detail: !spec.extract.definition.trim()
        ? 'Write a definition'
        : extract
          ? `${extract.pageGroups.length} ${extract.pageGroups.length === 1 ? 'page group' : 'page groups'}`
          : sampleId
            ? 'Definition to JSON'
            : 'Pick a spooled file',
      sub: extract ? (missing > 0 ? `${missing} missing ${missing === 1 ? 'field' : 'fields'}` : 'Every field found') : undefined,
      status: statuses.extract,
    },
    {
      step: 'render',
      title: STEP_TITLE.render,
      icon: FileTextIcon,
      detail: templates.length > 1 ? `${templates.length} templates` : contentName(templates[0]!),
      sub: !rendering
        ? 'Connect Carbone in Settings'
        : render?.template?.error
          ? templates.length > 1
            ? `The ${picked?.name} template has errors`
            : 'Template has errors'
          : render?.carbone
            ? 'Carbone did not answer'
            : templates.length > 1
              ? templates.map((t) => `${t.name}: ${formatList(t.formats)}`).join(', ')
              : formatList(templates[0]!.formats),
      status: statuses.render,
    },
    {
      step: 'destination',
      title: STEP_TITLE.destination,
      icon: SendIcon,
      // A destination in test mode says so, since its documents go to the test address, URL or folder.
      detail: destination
        ? (destination.kind === 'email' && destination.config.testAddress) ||
          (destination.kind === 'webhook' && destination.config.testUrl) ||
          (destination.kind === 'sftp' && destination.config.testFolder)
          ? `${destination.name} (test)`
          : destination.name
        : 'Pick a destination',
      status: statuses.destination,
    },
    {
      step: 'finish',
      title: STEP_TITLE.finish,
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
      status: statuses.finish,
    },
  ];
}

/** What a template has as its content, for the Render step's summary. */
function contentName(template: TemplateContent): string {
  return contentLabel(template.kind, hasOwnContent(template));
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
        style: { strokeWidth: 1.5, stroke: 'var(--muted-foreground)' },
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: 'var(--muted-foreground)' },
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
