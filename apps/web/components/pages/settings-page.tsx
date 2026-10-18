'use client';

import { SaveIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ErrorNote, Page } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText } from '@/lib/client/api';
import type { SettingsView } from '@/lib/types';

type Unit = 's' | 'min';

function split(seconds: number): { value: number; unit: Unit } {
  return seconds % 60 === 0 ? { value: seconds / 60, unit: 'min' } : { value: seconds, unit: 's' };
}

/** A number of seconds as a value and a unit (seconds or minutes). */
function Interval({
  id,
  label,
  hint,
  seconds,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  seconds: number;
  onChange(seconds: number): void;
}) {
  const [{ value, unit }, setParts] = useState(() => split(seconds));
  const update = (next: { value: number; unit: Unit }) => {
    setParts(next);
    onChange(Math.round(next.value * (next.unit === 'min' ? 60 : 1)));
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input id={id} type="number" min={1} value={value} onChange={(event) => update({ value: Number(event.target.value), unit })} className="w-28" />
        <select
          aria-label={`${label} unit`}
          value={unit}
          onChange={(event) => update({ value, unit: event.target.value as Unit })}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30"
        >
          <option value="s">seconds</option>
          <option value="min">minutes</option>
        </select>
      </div>
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}

type Draft = Pick<SettingsView, 'pollSeconds' | 'safetyCheckSeconds' | 'retentionDays'>;

/** What the last cleanup did, in a sentence. */
function cleanupText(cleanup: NonNullable<SettingsView['cleanup']>): string {
  const at = new Date(cleanup.at).toLocaleString();
  if (cleanup.error) return `The last cleanup, at ${at}, failed: ${cleanup.error}`;
  const runs = `${cleanup.runs} ${cleanup.runs === 1 ? 'run' : 'runs'}`;
  const samples = `${cleanup.samples} ${cleanup.samples === 1 ? 'spooled file' : 'spooled files'}`;
  return `The last cleanup, at ${at}, deleted ${runs} and ${samples}.`;
}

/** App-wide settings: the watcher intervals and how long runs are kept. */
export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<SettingsView>('/api/settings').then(
      (data) => {
        setSettings(data);
        setDraft({ pollSeconds: data.pollSeconds, safetyCheckSeconds: data.safetyCheckSeconds, retentionDays: data.retentionDays });
      },
      (err) => setError(errorText(err)),
    );
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const data = await api<SettingsView>('/api/settings', { method: 'PUT', body: draft });
      setSettings(data);
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Settings" description="Settings for the whole app." className="max-w-3xl">
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      {!draft && !error && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Spinner /> Loading settings...
        </div>
      )}
      {draft && settings && (
        <form onSubmit={onSubmit} className="flex flex-col gap-6">
          <section className="rounded-lg border p-5">
            <h2 className="font-semibold">Watching</h2>
            <p className="mt-0.5 mb-5 text-muted-foreground text-sm">
              Right now {settings.watching.realtime} {settings.watching.realtime === 1 ? 'queue is' : 'queues are'} watched in real time and{' '}
              {settings.watching.polled} {settings.watching.polled === 1 ? 'is' : 'are'} polled.
            </p>
            <div className="grid gap-6 sm:grid-cols-2">
              <Interval
                id="poll"
                label="Poll interval"
                hint="How often queues without a data queue are checked for new spooled files. 5 seconds to 1 hour."
                seconds={draft.pollSeconds}
                onChange={(pollSeconds) => setDraft({ ...draft, pollSeconds })}
              />
              <Interval
                id="safety"
                label="Safety check"
                hint="How often real-time queues are also checked, to catch anything the data queue missed. 1 minute to 1 day."
                seconds={draft.safetyCheckSeconds}
                onChange={(safetyCheckSeconds) => setDraft({ ...draft, safetyCheckSeconds })}
              />
            </div>
          </section>
          <section className="rounded-lg border p-5">
            <h2 className="font-semibold">Retention</h2>
            <p className="mt-0.5 mb-5 text-muted-foreground text-sm">
              Runs are deleted this long after they finish, with their captured spooled files and delivered files. Spooldoc still remembers which
              spooled files it processed, so none is processed again.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="retention">Keep runs for</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="retention"
                  type="number"
                  min={1}
                  max={3650}
                  value={draft.retentionDays}
                  onChange={(event) => setDraft({ ...draft, retentionDays: Number(event.target.value) })}
                  className="w-28"
                />
                <span className="text-sm">days</span>
              </div>
              <p className="text-muted-foreground text-xs">
                1 to 3650 days. Preview samples no job uses are deleted after the same time. Old runs are cleaned up once an hour.
              </p>
              {settings.cleanup && <p className="text-muted-foreground text-xs">{cleanupText(settings.cleanup)}</p>}
            </div>
          </section>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner /> : <SaveIcon />}
              Save
            </Button>
            {saved && <span className="text-muted-foreground text-sm">Saved. The watcher uses the new settings from its next check.</span>}
          </div>
        </form>
      )}
    </Page>
  );
}
