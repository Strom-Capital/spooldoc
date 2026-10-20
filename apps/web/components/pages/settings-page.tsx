'use client';

import { CopyIcon, MousePointerClickIcon, RefreshCwIcon, SaveIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { EmptyState, Loading } from '@/components/empty-state';
import { ErrorNote, Page } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { AI_PROVIDERS, aiProvider, DEFAULT_LOCAL_BASE_URL, EFFORTS, type AiProviderId, type Effort } from '@/lib/ai-providers';
import { api, errorText, isAbort } from '@/lib/client/api';
import { usageText } from '@/lib/client/format';
import type { AgentUsageView, AiSettingsView, CarboneCheck, RenderingView, SettingsView, UsageMonth } from '@/lib/types';

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
        <Select value={unit} onValueChange={(next) => update({ value, unit: next as Unit })}>
          <SelectTrigger aria-label={`${label} unit`} className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="s">seconds</SelectItem>
            <SelectItem value="min">minutes</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}

type Draft = Pick<SettingsView, 'pollSeconds' | 'safetyCheckSeconds' | 'retentionDays'>;

/** The agent's model as edited. The key field starts empty: a saved key is never sent to the page. */
interface AiDraft {
  provider: AiProviderId | null;
  model: string;
  effort: Effort;
  baseUrl: string;
  apiKey: string;
  removeKey: boolean;
  /** Mask values before they go to the model. */
  mask: boolean;
}

/** A provider's saved settings as a draft, or an empty one for no provider. */
function aiDraft(ai: AiSettingsView, provider: AiProviderId | null): AiDraft {
  if (!provider) {
    return { provider, model: '', effort: 'provider-default', baseUrl: '', apiKey: '', removeKey: false, mask: ai.mask };
  }
  const saved = ai.providers[provider];
  return {
    mask: ai.mask,
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
    mask: ai.mask,
    model: ai.model.trim() || undefined,
    effort: ai.effort,
    baseUrl: ai.provider === 'local' ? ai.baseUrl.trim() : undefined,
    apiKey: ai.removeKey ? null : ai.apiKey.trim() || undefined,
  };
}

/** The provider, key, model and effort the agent uses, and whether values are masked. */
function AiSection({ saved, ai, onChange }: { saved: AiSettingsView; ai: AiDraft; onChange(ai: AiDraft): void }) {
  const meta = ai.provider ? aiProvider(ai.provider) : null;
  const hasKey = ai.provider ? saved.providers[ai.provider].hasKey : false;
  return (
    <section className="rounded-lg border p-5">
      <h2 className="font-semibold">Agent</h2>
      <p className="mt-0.5 mb-5 text-muted-foreground text-sm">
        The model the agent in the job builder uses. Each provider keeps its own key, model and effort, so you can switch back and forth.
      </p>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-provider">Provider</Label>
          <Select
            value={ai.provider ?? 'none'}
            onValueChange={(next) => onChange({ ...aiDraft(saved, (next === 'none' ? null : next) as AiProviderId | null), mask: ai.mask })}
          >
            <SelectTrigger id="ai-provider" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None (agent off)</SelectItem>
              {AI_PROVIDERS.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {meta && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai-effort">Effort</Label>
            <Select value={ai.effort} onValueChange={(next) => onChange({ ...ai, effort: next as Effort })}>
              <SelectTrigger id="ai-effort" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EFFORTS.map((effort) => (
                  <SelectItem key={effort.id} value={effort.id}>
                    {effort.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                  ? `No key saved yet: the agent stays off until you add one. ${meta.keyHint}`
                  : `Stored encrypted on the server and never shown again. ${meta.keyHint}`}
            </p>
          </div>
        )}
        {meta && (
          <div className="flex items-start justify-between gap-3 rounded-lg border p-4 sm:col-span-2">
            <div>
              <Label htmlFor="ai-mask" className="font-medium">
                Mask values
              </Label>
              <p className="text-muted-foreground text-xs">
                {ai.mask
                  ? 'Digits become 9 and letters X or x before page text and tool results go to the model. It sees the layout, not the customer, and reads and designs less well from values it cannot read.'
                  : `The model sees values as printed, which helps it read the pages and design templates. ${ai.provider === 'local' ? 'A local model keeps them on your network.' : 'The provider processes them under its own terms; a local model keeps them on your network.'}`}
              </p>
            </div>
            <Switch id="ai-mask" checked={ai.mask} onCheckedChange={(mask) => onChange({ ...ai, mask })} />
          </div>
        )}
      </div>
      <AgentUsage />
    </section>
  );
}

/** A `YYYY-MM` month as "October 2026". */
function monthName(month: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** One month's usage: a line per provider and model. */
function UsageMonthList({ title, month }: { title: string; month: UsageMonth }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="font-medium text-xs">
        {title} <span className="font-normal text-muted-foreground">({monthName(month.month)})</span>
      </h4>
      {month.lines.length === 0 ? (
        <p className="text-muted-foreground text-xs">The agent was not used.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {month.lines.map((line) => (
            <li key={`${line.provider}/${line.model}`} className="flex flex-wrap justify-between gap-x-4 text-sm">
              <span className="min-w-0 break-all">
                {AI_PROVIDERS.find((provider) => provider.id === line.provider)?.label ?? line.provider}, {line.model}
              </span>
              <span className="text-muted-foreground tabular-nums">{usageText(line)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The tokens the agent used this month and last month, and the cost where the provider
 * reported it. Read-only: it loads on its own and is not part of the settings form.
 */
function AgentUsage() {
  const [usage, setUsage] = useState<AgentUsageView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    api<AgentUsageView>(`/api/settings/agent-usage?tz=${encodeURIComponent(tz)}`, { signal: controller.signal }).then(setUsage, (err: unknown) => {
      if (!isAbort(err)) setError(errorText(err));
    });
    return () => controller.abort();
  }, []);

  return (
    <div className="mt-6 flex flex-col gap-3 border-t pt-5">
      <div>
        <h3 className="font-medium text-sm">Usage</h3>
        <p className="text-muted-foreground text-xs">
          Tokens the agent used, per provider and model. A cost shows only where the provider reports it: OpenRouter and the Vercel AI Gateway.
          Usage is deleted with the retention below.
        </p>
      </div>
      {error && <ErrorNote>Could not load the usage: {error}</ErrorNote>}
      {!usage && !error && <Loading>Loading usage...</Loading>}
      {usage &&
        (usage.thisMonth.lines.length === 0 && usage.lastMonth.lines.length === 0 ? (
          <EmptyState icon={MousePointerClickIcon} title="No usage yet" description="Tokens show here once the agent has answered in a job." className="py-6" />
        ) : (
          <>
            <UsageMonthList title="This month" month={usage.thisMonth} />
            <UsageMonthList title="Last month" month={usage.lastMonth} />
          </>
        ))}
    </div>
  );
}

/** The rendering settings as edited. The key field starts empty: a saved key is never sent to the page. */
interface RenderingDraft {
  mode: RenderingView['mode'];
  url: string;
  apiKey: string;
  removeKey: boolean;
}

const renderingDraft = (saved: RenderingView): RenderingDraft => ({ mode: saved.mode, url: saved.url, apiKey: '', removeKey: false });

/** The `rendering` part of a settings change, or undefined when nothing changed (saving then does not check Carbone again). */
function renderingChange(saved: RenderingView, draft: RenderingDraft) {
  const url = draft.url.trim();
  const changed = draft.mode !== saved.mode || url !== saved.url || draft.apiKey.trim() !== '' || draft.removeKey;
  if (!changed) return undefined;
  return {
    mode: draft.mode,
    ...(draft.mode === 'onprem' ? { url } : {}),
    apiKey: draft.removeKey ? null : draft.apiKey.trim() || undefined,
  };
}

const EDITIONS: Record<NonNullable<CarboneCheck['edition']>, string> = {
  enterprise: 'Enterprise Edition',
  community: 'Community Edition',
  cloud: 'Carbone Cloud',
};

/** The last connection check: the version and edition, or what went wrong. */
function CarboneStatus({ check, busy, onCheck }: { check: CarboneCheck | null; busy: boolean; onCheck(): void }) {
  return (
    <div className="mb-5 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {check?.ok ? (
          <>
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-emerald-950">Connected</Badge>
            <span>
              Carbone {check.version}
              {check.edition && `, ${EDITIONS[check.edition]}`}
            </span>
          </>
        ) : (
          <Badge variant="destructive">{check ? 'Not working' : 'Not checked yet'}</Badge>
        )}
        {check && <span className="text-muted-foreground text-xs">Checked {new Date(check.at).toLocaleString()}</span>}
        <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={onCheck} disabled={busy}>
          {busy ? <Spinner /> : <RefreshCwIcon />}
          Check again
        </Button>
      </div>
      {check?.ok && check.edition === 'community' && (
        <p className="text-muted-foreground text-xs">
          Carbone runs as the Community Edition. If you have a licence, check Carbone&apos;s startup log: a licence Carbone does not accept looks the
          same as none.
        </p>
      )}
      {check && !check.ok && check.error && <ErrorNote detail={check.detail}>{check.error}</ErrorNote>}
    </div>
  );
}

/** The value of Spooldoc's public key, with a Copy button. */
function PublicKey({ value }: { value: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copied the public key');
    } catch {
      toast.error('Could not copy. Select the text and copy it instead.');
    }
  }
  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <Label htmlFor="carbone-public-key">Spooldoc&apos;s public key</Label>
      <pre id="carbone-public-key" tabIndex={0} className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">
        {value}
      </pre>
      <div className="flex flex-wrap items-start gap-2">
        <p className="flex-1 text-muted-foreground text-xs">
          Set <code className="font-mono">CARBONE_AUTHENTICATION_PUBLIC_KEY</code> on the Carbone service to this value, with{' '}
          <code className="font-mono">CARBONE_AUTHENTICATION=true</code>, and restart Carbone. Spooldoc signs each request with its private key,
          which never leaves this server.
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={() => void copy()}>
          <CopyIcon />
          Copy
        </Button>
      </div>
    </div>
  );
}

/** Where documents are rendered: a Carbone server of the user's own, or Carbone Cloud. */
function RenderingSection({
  saved,
  draft,
  busy,
  onChange,
  onCheck,
}: {
  saved: RenderingView;
  draft: RenderingDraft;
  busy: boolean;
  onChange(draft: RenderingDraft): void;
  onCheck(): void;
}) {
  return (
    <section id="rendering" className="scroll-mt-4 rounded-lg border p-5">
      <h2 className="font-semibold">Rendering</h2>
      <p className="mt-0.5 mb-5 text-muted-foreground text-sm">
        Spooldoc renders every document with Carbone: your own Carbone server, such as the carbone service in the Compose file, or Carbone Cloud.
      </p>
      <CarboneStatus check={saved.check} busy={busy} onCheck={onCheck} />
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="carbone-mode">Carbone server</Label>
          <Select value={draft.mode} onValueChange={(mode) => onChange({ ...draft, mode: mode as RenderingDraft['mode'] })}>
            <SelectTrigger id="carbone-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="onprem">Carbone on-prem</SelectItem>
              <SelectItem value="cloud">Carbone Cloud</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {draft.mode === 'onprem' ? (
          <>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="carbone-url">URL</Label>
              <Input
                id="carbone-url"
                type="url"
                value={draft.url}
                onChange={(event) => onChange({ ...draft, url: event.target.value })}
                placeholder="http://carbone:4000"
                spellCheck={false}
              />
              <p className="text-muted-foreground text-xs">
                The Spooldoc server calls it, so it must be reachable from there. In the Compose file it is http://carbone:4000.
              </p>
            </div>
            <PublicKey value={saved.publicKey} />
          </>
        ) : (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="carbone-key">API key</Label>
            <div className="flex gap-2">
              <Input
                id="carbone-key"
                type="password"
                value={draft.apiKey}
                onChange={(event) => onChange({ ...draft, apiKey: event.target.value, removeKey: false })}
                placeholder={saved.hasApiKey && !draft.removeKey ? 'Saved. Leave empty to keep it.' : undefined}
                autoComplete="new-password"
                spellCheck={false}
              />
              {saved.hasApiKey && (
                <Button type="button" variant="outline" onClick={() => onChange({ ...draft, apiKey: '', removeKey: !draft.removeKey })}>
                  {draft.removeKey ? 'Keep key' : 'Remove key'}
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-xs">
              {draft.removeKey
                ? 'The saved key is removed when you save.'
                : 'Your own key from your Carbone account. Stored encrypted on the server and never shown again. Document data goes to Carbone Cloud to be rendered, and each document counts toward your Carbone plan.'}
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
  const parts = [
    runs,
    samples,
    cleanup.templateFiles > 0 && `${cleanup.templateFiles} unused Word ${cleanup.templateFiles === 1 ? 'template' : 'templates'}`,
    cleanup.agentUsage > 0 && `${cleanup.agentUsage} agent usage ${cleanup.agentUsage === 1 ? 'record' : 'records'}`,
  ].filter((part): part is string => typeof part === 'string');
  return `The last cleanup, at ${at}, deleted ${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}.`;
}

/** App-wide settings: the Carbone connection, the agent's model, the watcher intervals and how long runs are kept. */
export function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ai, setAi] = useState<AiDraft | null>(null);
  const [rendering, setRendering] = useState<RenderingDraft | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<SettingsView>('/api/settings').then(
      (data) => {
        setSettings(data);
        setDraft({ pollSeconds: data.pollSeconds, safetyCheckSeconds: data.safetyCheckSeconds, retentionDays: data.retentionDays });
        setAi(aiDraft(data.ai, data.ai.provider));
        setRendering(renderingDraft(data.rendering));
      },
      (err) => setError(errorText(err)),
    );
  }, []);

  /** Check the Carbone connection again, such as after Carbone was given the public key. */
  async function onCheck() {
    setChecking(true);
    try {
      const view = await api<RenderingView>('/api/settings/rendering', { method: 'POST' });
      setSettings((current) => (current ? { ...current, rendering: view } : current));
      if (view.check?.ok) toast.success('Carbone works', { description: `Carbone ${view.check.version}` });
      else toast.error('Carbone does not work yet', { description: view.check?.error });
      // The layout tells the workbench and the setup checklist whether Carbone works.
      router.refresh();
    } catch (err) {
      toast.error('Could not check Carbone', { description: errorText(err) });
    } finally {
      setChecking(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft || !ai || !rendering || !settings) return;
    setBusy(true);
    setError(null);
    try {
      const change = renderingChange(settings.rendering, rendering);
      const data = await api<SettingsView>('/api/settings', { method: 'PUT', body: { ...draft, ai: aiChange(ai), ...(change ? { rendering: change } : {}) } });
      setSettings(data);
      setAi(aiDraft(data.ai, data.ai.provider));
      setRendering(renderingDraft(data.rendering));
      if (change && !data.rendering.check?.ok) {
        toast.error('Saved the settings, but Carbone does not work yet', { description: data.rendering.check?.error });
      } else {
        toast.success('Settings saved', { description: 'The watcher uses them from its next check, the agent from its next message.' });
      }
      // The layout tells the agent which model is set up, and the workbench whether Carbone works.
      router.refresh();
    } catch (err) {
      toast.error('Could not save the settings', { description: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Settings" description="Settings for the whole app." className="max-w-3xl">
      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
      {!draft && !error && (
        <Loading>Loading settings...</Loading>
      )}
      {draft && ai && rendering && settings && (
        <form onSubmit={onSubmit} className="flex flex-col gap-6">
          <RenderingSection saved={settings.rendering} draft={rendering} busy={checking} onChange={setRendering} onCheck={() => void onCheck()} />
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
                1 to 3650 days. Preview samples no job uses and the agent&apos;s usage are deleted after the same time. Old runs are cleaned up once an hour.
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
