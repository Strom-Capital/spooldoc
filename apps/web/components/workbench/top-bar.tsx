'use client';

import { ChevronDownIcon, LinkIcon } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText } from '@/lib/client/api';
import { useWorkbench } from './workbench-provider';

const SOURCE: Record<string, string> = {
  chrid: 'from CHRID',
  job: 'from the job CCSID',
  fallback: 'fallback',
};

/**
 * Sample facts on one line, the linked definition type with a popover to link one, and
 * the pane toggles.
 *
 * @param controls - Shown at the end of the bar (the pane toggles)
 */
export function TopBar({ controls }: { controls?: ReactNode }) {
  const { render, loading, sampleId } = useWorkbench();
  const sample = render?.sample;
  const facts = sample
    ? [
        `${sample.splf.name} #${sample.splf.number}`,
        `${sample.attributes.queue.library}/${sample.attributes.queue.name}`,
        `${sample.pages.length} ${sample.pages.length === 1 ? 'page' : 'pages'} ${sample.attributes.pageWidth}x${sample.attributes.pageLength}`,
        `CCSID ${sample.codePage}${sample.codePageSource ? ` ${SOURCE[sample.codePageSource]}` : ''}`,
      ]
    : [];

  return (
    <div className="shrink-0 border-b">
      <div className="flex h-12 items-center gap-3 px-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-mono font-semibold text-sm" title={sampleId}>
            {sampleId}
          </h1>
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={facts.join('\n')}>
            {facts.join(' · ')}
          </p>
        </div>
        {loading && <Spinner className="shrink-0 text-muted-foreground" />}
        <DefinitionLink />
        {controls}
      </div>
      {render && render.errors.length > 0 && (
        <p className="truncate px-3 pb-1.5 text-destructive text-xs" title={render.errors.join('\n\n')}>
          {render.errors.length === 1 ? '1 problem' : `${render.errors.length} problems`}: {render.errors[0]?.split('\n')[0]}
        </p>
      )}
    </div>
  );
}

/** The linked definition type as a button; its popover links another type. */
function DefinitionLink() {
  const { sampleId, render, reload } = useWorkbench();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linked = render?.sample.definition;

  async function link(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/samples/${encodeURIComponent(sampleId)}/definition`, {
        method: 'POST',
        body: { type: type.trim() },
      });
      setType('');
      setOpen(false);
      await reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="shrink-0 gap-1.5" title="The definition type linked to this sample">
          {linked ? (
            <>
              <span className="hidden text-muted-foreground text-xs lg:inline">Definition</span>
              <span className="font-mono text-primary text-xs">{linked}</span>
            </>
          ) : (
            <>
              <LinkIcon />
              Link definition
            </>
          )}
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <form onSubmit={link} className="flex flex-col gap-2">
          <label htmlFor="definition-type" className="font-medium text-sm">
            {linked ? 'Link another definition type' : 'Link a definition type'}
          </label>
          <div className="flex items-center gap-1">
            <Input
              id="definition-type"
              value={type}
              onChange={(event) => setType(event.target.value.toLowerCase())}
              placeholder="type, e.g. invoice"
              pattern="[a-z0-9-]+"
              required
              autoFocus
              className="h-8 text-sm"
              spellCheck={false}
            />
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? <Spinner /> : <LinkIcon />}
              Link
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          )}
        </form>
      </PopoverContent>
    </Popover>
  );
}
