'use client';

import { getToolName, type DynamicToolUIPart, type ToolUIPart } from 'ai';
import { AlertTriangleIcon, CheckIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { CodeBlock } from '@/components/ai-elements/code-block';
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool';
import { Spinner } from '@/components/ui/spinner';
import { toolSummary } from '@/lib/client/chat';
import { cn } from '@/lib/utils';

const ICONS = {
  running: <Spinner className="size-3.5" />,
  ok: <CheckIcon className="size-3.5 text-green-600" />,
  warn: <AlertTriangleIcon className="size-3.5 text-amber-600" />,
  error: <XIcon className="size-3.5 text-destructive" />,
};

/** The input of a write tool as code (YAML or HTML), any other input as JSON. */
function ToolCallInput({ input }: { input: unknown }) {
  const value = (input ?? {}) as { yaml?: unknown; html?: unknown };
  if (typeof value.yaml === 'string') {
    return <CodeBlock code={value.yaml} language="yaml" className="max-h-80" />;
  }
  if (typeof value.html === 'string') {
    return <CodeBlock code={value.html} language="html" className="max-h-80" />;
  }
  return <ToolInput input={input} />;
}

/**
 * One line for a tool call in the chat ("Wrote definition invoice: 6 documents, 2 missing").
 * Clicking it opens the AI Elements Tool card with the input and the output.
 */
export function ToolSummary({ part }: { part: ToolUIPart | DynamicToolUIPart }) {
  const [open, setOpen] = useState(false);
  const toolName = getToolName(part);
  const summary = toolSummary({ toolName, state: part.state, input: part.input, output: part.output, errorText: part.errorText });

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-muted-foreground text-xs hover:bg-accent hover:text-foreground"
      >
        <ChevronRightIcon className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="shrink-0">{ICONS[summary.tone]}</span>
        <span className={cn('truncate', summary.tone === 'error' && 'text-destructive')}>{summary.text}</span>
      </button>
      {open && (
        <Tool defaultOpen className="mb-0">
          {part.type === 'dynamic-tool' ? (
            <ToolHeader type="dynamic-tool" toolName={toolName} state={part.state} />
          ) : (
            <ToolHeader type={part.type} state={part.state} />
          )}
          <ToolContent className="space-y-3 border-t">
            <ToolCallInput input={part.input} />
            <ToolOutput output={part.output} errorText={part.errorText} />
          </ToolContent>
        </Tool>
      )}
    </div>
  );
}
