'use client';

import { SaveIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ErrorNote, Page } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { AI_PROVIDERS, aiProvider, DEFAULT_LOCAL_BASE_URL, EFFORTS, type AiProviderId, type Effort } from '@/lib/ai-providers';
import { api, errorText } from '@/lib/client/api';
import type { AiSettingsView, SettingsView } from '@/lib/types';

type Unit = 's' | 'min';

const selectClass = 'h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30';

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
          className={selectClass}
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

/** The chat model as edited. The key field starts empty: a saved key is never sent to the page. */
interface AiDraft {
  provider: AiProviderId | null;
  model: string;
  effort: Effort;
  baseUrl: string;
  apiKey: string;
  removeKey: boolean;
}

/** A provider's saved settings as a draft, or an empty one for no provider. */
function aiDraft(ai: AiSettingsView, provider: AiProviderId | null): AiDraft {
  if (!provider) {
    return { provider, model: '', effort: 'provider-default', baseUrl: '', apiKey: '', removeKey: false };
  }
  const saved = ai.providers[provider];
  return {
    provider,
    model: saved.model ?? aiProvider(provider).defaultModel,
    effort: saved.effort,
    baseUrl: saved.baseUrl ?? (provider === 'local' ? DEFAULT_LOCAL_BASE_URL : ''),
    apiKey: '',
    removeKey: false,
  };
}

/** The draft as the `ai` part of a settings change. */
function aiChange(ai: AiDraft) {
  if (!ai.provider) {
    return { provider: null };
  }
  return {
    provider: ai.provider,
    model: ai.model.trim() || undefined,
    effort: ai.effort,
    baseUrl: ai.provider === 'local' ? ai.baseUrl.trim() : undefined,
    apiKey: ai.removeKey ? null : ai.apiKey.trim() || undefined,
  };
}

/** The provider, key, model and effort the workbench chat uses. */
function AiSection({ saved, ai, onChange }: { saved: AiSettingsView; ai: AiDraft; onChange(ai: AiDraft): void }) {
  const meta = ai.provider ? aiProvider(ai.provider) : null;
  const hasKey = ai.provider ? saved.providers[ai.provider].hasKey : false;
  return (
    <section className="rounded-lg border p-5">
      <h2 className="font-semibold">AI model</h2>
      <p className="mt-0.5 mb-5 text-muted-foreground text-sm">
        The model the job workbench chat uses. Each provider keeps its own key, model and effort, so you can switch back and forth.
      </p>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-provider">Provider</Label>
          <select
            id="ai-provider"
            value={ai.provider ?? ''}
            onChange={(event) => onChange(aiDraft(saved, (event.target.value || null) as AiProviderId | null))}
            className={selectClass}
          >
            <option value="">None (chat off)</option>
            {AI_PROVIDERS.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
        </div>
        {meta && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai-effort">Effort</Label>
            <select id="ai-effort" value={ai.effort} onChange={(event) => onChange({ ...ai, effort: event.target.value as Effort })} className={selectClass}>
              {EFFORTS.map((effort) => (
                <option key={effort.id} value={effort.id}>
                  {effort.label}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground text-xs">How much the model thinks before it answers. Models that do not reason ignore it.</p>
          </div>
        )}
        {meta && ai.provider === 'local' && (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="ai-base-url">Base URL</Label>
            <Input
              id="ai-base-url"
              type="url"
              value={ai.baseUrl}
              onChange={(event) => onChange({ ...ai, baseUrl: event.target.value })}
              placeholder={DEFAULT_LOCAL_BASE_URL}
              spellCheck={false}
            />
            <p className="text-muted-foreground text-xs">
              An OpenAI-compatible endpoint, such as Ollama, LM Studio or vLLM. The Spooldoc server calls it, so it must be reachable from there.
            </p>
          </div>
        )}
        {meta && (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="ai-model">Model</Label>
            <Input
              id="ai-model"
              list="ai-models"
              value={ai.model}
              onChange={(event) => onChange({ ...ai, model: event.target.value })}
              placeholder={meta.defaultModel || 'Model id'}
              autoComplete="off"
              spellCheck={false}
            />
            <datalist id="ai-models">
              {meta.models.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            <p className="text-muted-foreground text-xs">Pick a suggested model or type any model id the provider offers.</p>
          </div>
        )}
        {meta && (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="ai-key">
              API key {!meta.needsKey && <span className="font-normal text-muted-foreground">(optional)</span>}
            </Label>
            <div className="flex gap-2">
              <Input
                id="ai-key"
                type="password"
                value={ai.apiKey}
                onChange={(event) => onChange({ ...ai, apiKey: event.target.value, removeKey: false })}
                placeholder={hasKey && !ai.removeKey ? 'Saved. Leave empty to keep it.' : undefined}
                autoComplete="new-password"
                spellCheck={false}
              />
              {hasKey && (
                <Button type="button" variant="outline" onClick={() => onChange({ ...ai, apiKey: '', removeKey: !ai.removeKey })}>
                  {ai.removeKey ? 'Keep key' : 'Remove key'}
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-xs">
              {ai.removeKey
                ? 'The saved key is removed when you save.'
                : meta.needsKey && !hasKey && !ai.apiKey
                  ? `No key saved yet: the chat stays off until you add one. ${meta.keyHint}`
                  : `Stored encrypted on the server and never shown again. ${meta.keyHint}`}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/** What the last cleanup did, in a sentence. */
function cleanupText(cleanup: NonNullable<SettingsView['cleanup']>): string {
  const at = new Date(cleanup.at).toLocaleString();
  if (cleanup.error) return `The last cleanup, at ${at}, failed: ${cleanup.error}`;
  const runs = `${cleanup.runs} ${cleanup.runs === 1 ? 'run' : 'runs'}`;
  const samples = `${cleanup.samples} ${cleanup.samples === 1 ? 'spooled file' : 'spooled files'}`;
  return `The last cleanup, at ${at}, deleted ${runs} and ${samples}.`;
}

/** App-wide settings: the watcher intervals, how long runs are kept and the chat model. */
export function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ai, setAi] = useState<AiDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<SettingsView>('/api/settings').then(
      (data) => {
        setSettings(data);
        setDraft({ pollSeconds: data.pollSeconds, safetyCheckSeconds: data.safetyCheckSeconds, retentionDays: data.retentionDays });
        setAi(aiDraft(data.ai, data.ai.provider));
      },
      (err) => setError(errorText(err)),
    );
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft || !ai) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<SettingsView>('/api/settings', { method: 'PUT', body: { ...draft, ai: aiChange(ai) } });
      setSettings(data);
      setAi(aiDraft(data.ai, data.ai.provider));
      toast.success('Settings saved', { description: 'The watcher uses them from its next check, the chat from its next message.' });
      // The layout tells the chat panel which model is set up.
      router.refresh();
    } catch (err) {
      toast.error('Settings not saved', { description: errorText(err) });
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
      {draft && ai && settings && (
        <form onSubmit={onSubmit} className="flex flex-col gap-6">
          <AiSection saved={settings.ai} ai={ai} onChange={setAi} />
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
          </div>
        </form>
      )}
    </Page>
  );
}
