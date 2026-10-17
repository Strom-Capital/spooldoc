'use client';

import { LinkIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText } from '@/lib/client/api';
import { useWorkbench } from './workbench-provider';

const SOURCE: Record<string, string> = {
  chrid: 'from CHRID',
  job: 'from the job CCSID',
  fallback: 'fallback',
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className="font-mono text-xs">{children}</span>
    </div>
  );
}

/** Sample facts and the linked definition type, with a small form to link one. */
export function TopBar() {
  const { sampleId, render, reload, loading } = useWorkbench();
  const [type, setType] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sample = render?.sample;

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
      await reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-end gap-x-6 gap-y-2 border-b px-4 py-2">
      <div className="flex flex-col">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Sample</span>
        <h1 className="font-mono font-semibold text-sm">{sampleId}</h1>
      </div>
      {sample && (
        <>
          <Fact label="Spooled file">
            {sample.splf.name} #{sample.splf.number}
          </Fact>
          <Fact label="Queue">
            {sample.attributes.queue.library}/{sample.attributes.queue.name}
          </Fact>
          <Fact label="Pages">
            {sample.pages.length} ({sample.attributes.pageWidth} x {sample.attributes.pageLength})
          </Fact>
          <Fact label="Code page">
            {sample.codePage}
            {sample.codePageSource && <span className="text-muted-foreground"> {SOURCE[sample.codePageSource]}</span>}
          </Fact>
        </>
      )}
      <div className="ml-auto flex items-end gap-3">
        {loading && <Spinner className="mb-1 text-muted-foreground" />}
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Definition</span>
          {sample?.definition ? (
            <span className="rounded bg-primary/10 px-1.5 font-mono text-primary text-xs">{sample.definition}</span>
          ) : (
            <span className="text-muted-foreground text-xs">Not linked</span>
          )}
        </div>
        <form onSubmit={link} className="flex items-center gap-1">
          <Input
            value={type}
            onChange={(event) => setType(event.target.value.toLowerCase())}
            placeholder="type, e.g. invoice"
            aria-label="Definition type to link"
            pattern="[a-z0-9-]+"
            required
            className="h-7 w-36 text-xs"
            spellCheck={false}
          />
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            {busy ? <Spinner /> : <LinkIcon />}
            Link definition
          </Button>
        </form>
      </div>
      {error && (
        <p role="alert" className="w-full text-destructive text-xs">
          {error}
        </p>
      )}
      {render && render.errors.length > 0 && (
        <p className="w-full text-destructive text-xs">
          {render.errors.length === 1 ? '1 problem' : `${render.errors.length} problems`}: {render.errors[0]?.split('\n')[0]}
        </p>
      )}
    </div>
  );
}
