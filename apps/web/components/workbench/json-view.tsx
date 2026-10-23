'use client';

import { CheckIcon, CopyIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Hint } from '@/components/hint';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { hitKey } from '@/lib/client/render';
import { CodeEditor } from './code-editor';
import { useWorkbench } from './workbench-provider';

const STATUS_CLASS = {
  found: 'bg-primary/15 text-primary',
  empty: 'bg-yellow-500/20 text-yellow-800 dark:text-yellow-300',
  missing: 'bg-destructive/15 text-destructive',
} as const;

/**
 * The extracted page groups as JSON, with warnings and the field hits of the current page
 * group. `withLookups` shows the page group with the values its lookups added, as
 * templates get it, once the preview ran them.
 */
export function JsonView({ withLookups = false }: { withLookups?: boolean }) {
  const { render, pageGroupIndex, selectedHit, setSelectedHit } = useWorkbench();
  const listRef = useRef<HTMLUListElement>(null);
  const extract = render?.extract;
  const looked = withLookups && render?.pageGroup === pageGroupIndex ? render.lookups?.pageGroup : undefined;
  const group = looked ?? extract?.pageGroups[pageGroupIndex] ?? extract?.pageGroups[0];
  const code = useMemo(() => (group ? JSON.stringify(group, null, 2) : ''), [group]);
  const hits = useMemo(() => (extract?.hits ?? []).filter((hit) => hit.pageGroup === pageGroupIndex), [extract, pageGroupIndex]);
  const selectedKey = selectedHit ? hitKey(selectedHit) : null;

  useEffect(() => {
    if (!selectedKey) return;
    const el = listRef.current?.querySelector(`[data-key="${CSS.escape(selectedKey)}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedKey, hits]);

  if (!extract) {
    return (
      <p className="p-4 text-muted-foreground text-sm">
        {render?.definition?.error
          ? 'The definition has errors; fix them in the Definition tab.'
          : 'No definition yet. Write one in the Definition tab, or ask the agent for one.'}
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {extract.warnings.length > 0 && (
          <ul className="mb-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm">
            {extract.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        )}
        {group ? (
          <div className="relative overflow-hidden rounded-md border">
            <CodeEditor value={code} label="Page group JSON" language="json" readOnly autoHeight />
            <CopyButton text={code} />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No page groups found.</p>
        )}
        <h3 className="mt-4 mb-1 font-medium text-sm">Fields</h3>
        <ul ref={listRef} className="divide-y rounded-md border text-xs">
          {hits.map((hit) => {
            const key = hitKey(hit);
            return (
              <li key={key} data-key={key}>
                <button
                  type="button"
                  onClick={() => setSelectedHit(hit)}
                  className={cn(
                    'flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-muted/50',
                    key === selectedKey && 'bg-primary/10',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-mono">{hit.name}</span>
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px] uppercase', STATUS_CLASS[hit.status])}>
                    {hit.status}
                  </span>
                  <span className="max-w-[35%] truncate text-right font-mono text-muted-foreground" title={hit.value}>
                    {hit.value}
                  </span>
                  <span className="tabular w-16 shrink-0 text-right text-muted-foreground">
                    p{hit.page} {hit.line}:{hit.column}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** Copies the JSON; the icon turns into a check for two seconds. */
/**
 * Copies a text to the clipboard, and says so for two seconds.
 *
 * @param label - The button's accessible name, such as "Copy JSON"
 * @param hint - What it copies, as its hint
 */
export function CopyButton({
  text,
  label = 'Copy JSON',
  hint = 'Copy the JSON to the clipboard',
  className = 'absolute top-1 right-1 bg-background/80',
}: {
  text: string;
  label?: string;
  hint?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure origin or denied): nothing to show.
    }
  }
  return (
    <Hint text={copied ? 'Copied' : hint}>
      <Button type="button" variant="ghost" size="icon-sm" onClick={copy} aria-label={label} className={className}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </Hint>
  );
}
