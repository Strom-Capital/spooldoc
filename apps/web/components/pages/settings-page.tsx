'use client';

import { CheckIcon, MousePointerClickIcon, RefreshCwIcon, SaveIcon, SendIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useAppInfo } from '@/components/app-info';
import { DocsLink } from '@/components/docs-link';
import { Hint } from '@/components/hint';
import { EmptyState, Loading } from '@/components/empty-state';
import { ErrorNote, Page } from '@/components/page';
import { PublicKey } from '@/components/public-key';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { AI_PROVIDERS, aiProvider, DEFAULT_LOCAL_BASE_URL, EFFORTS, type AiProviderId, type Effort } from '@/lib/ai-providers';
import { alertAddressProblem } from '@/lib/alerts-config';
import { api, errorText, isAbort, shownError, type ShownError } from '@/lib/client/api';
import { usageText } from '@/lib/client/format';
import {
  COMMON_CURRENCIES,
  CURRENCIES,
  DATE_FORMATS,
  EXAMPLE_DATE,
  formatC,
  formatD,
  NUMBER_FORMATS,
  type DateFormat,
  type Formats,
  type NumberLang,
} from '@/lib/formats';
import { MAIL_SENDER_LABEL, MAIL_SENDERS, SMTP_DEFAULT_PORT, SMTP_SECURITY, SMTP_SECURITY_LABEL, type MailSenderKind, type SmtpSecurity } from '@/lib/mail-config';
import type { AgentUsageView, AiSettingsView, AlertsView, CarboneCheck, MailView, RenderingView, SettingsView, UsageMonth } from '@/lib/types';

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
                <Hint text={ai.removeKey ? 'Keep the saved key after all.' : 'Remove the saved key when you save. Nothing changes until then.'}>
                  <Button type="button" variant="outline" onClick={() => onChange({ ...ai, apiKey: '', removeKey: !ai.removeKey })}>
                    {ai.removeKey ? 'Keep key' : 'Remove key'}
                  </Button>
                </Hint>
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
        <div className="ml-auto">
          <Hint text="Try the saved settings against Carbone now. Save your changes first to check them.">
            <Button type="button" variant="outline" size="sm" onClick={onCheck} disabled={busy}>
              {busy ? <Spinner /> : <RefreshCwIcon />}
              Check again
            </Button>
          </Hint>
        </div>
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
            <PublicKey
              id="carbone-public-key"
              className="sm:col-span-2"
              value={saved.publicKey}
              label="Spooldoc's public key"
              help={
                <>
                  Set <code className="font-mono">CARBONE_AUTHENTICATION_PUBLIC_KEY</code> on the Carbone service to this value, with{' '}
                  <code className="font-mono">CARBONE_AUTHENTICATION=true</code>, and restart Carbone. Spooldoc signs each request with its private key,
                  which never leaves this server.
                </>
              }
            />
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
                <Hint text={draft.removeKey ? 'Keep the saved key after all.' : 'Remove the saved key when you save. Nothing changes until then.'}>
                  <Button type="button" variant="outline" onClick={() => onChange({ ...draft, apiKey: '', removeKey: !draft.removeKey })}>
                    {draft.removeKey ? 'Keep key' : 'Remove key'}
                  </Button>
                </Hint>
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

/** The mail server as edited. The password and secret fields start empty: a saved one is never sent to the page. */
interface MailDraft {
  sender: MailSenderKind;
  host: string;
  port: string;
  security: SmtpSecurity;
  user: string;
  password: string;
  removePassword: boolean;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  from: string;
  fromName: string;
}

const mailDraft = (saved: MailView): MailDraft => ({
  sender: saved.sender,
  host: saved.host,
  port: String(saved.port),
  security: saved.security,
  user: saved.user,
  password: '',
  removePassword: false,
  tenantId: saved.tenantId,
  clientId: saved.clientId,
  clientSecret: '',
  from: saved.from,
  fromName: saved.fromName,
});

/** The `mail` part of a settings change, or undefined when nothing changed. */
function mailChange(saved: MailView, draft: MailDraft) {
  const port = draft.port.trim() === '' ? null : Number(draft.port);
  const same =
    draft.sender === saved.sender &&
    draft.tenantId.trim() === saved.tenantId &&
    draft.clientId.trim() === saved.clientId &&
    draft.clientSecret === '' &&
    draft.host.trim() === saved.host &&
    port === saved.port &&
    draft.security === saved.security &&
    draft.user.trim() === saved.user &&
    draft.from.trim() === saved.from &&
    draft.fromName.trim() === saved.fromName &&
    draft.password === '' &&
    !draft.removePassword;
  if (same) return undefined;
  return {
    sender: draft.sender,
    host: draft.host.trim(),
    port,
    security: draft.security,
    user: draft.user.trim(),
    password: draft.removePassword ? null : draft.password || undefined,
    tenantId: draft.tenantId.trim(),
    clientId: draft.clientId.trim(),
    clientSecret: draft.clientSecret.trim() || undefined,
    from: draft.from.trim(),
    fromName: draft.fromName.trim(),
  };
}

type MailFieldsProps = { saved: MailView; draft: MailDraft; onChange(draft: MailDraft): void };

/** The SMTP server: host, security, port, and the sign-in. */
function SmtpFields({ saved, draft, onChange }: MailFieldsProps) {
  return (
    <>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="mail-host">Host</Label>
        <Input
          id="mail-host"
          value={draft.host}
          onChange={(event) => onChange({ ...draft, host: event.target.value })}
          placeholder="smtp.example.com"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-muted-foreground text-xs">The Spooldoc server connects to it, so it must be reachable from there. Empty turns email off.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mail-security">Security</Label>
        <Select
          value={draft.security}
          onValueChange={(next) => {
            const security = next as SmtpSecurity;
            // A port that was the old choice's usual one follows the new choice.
            const usual = Object.values(SMTP_DEFAULT_PORT).map(String).includes(draft.port) || draft.port === '';
            onChange({ ...draft, security, port: usual ? String(SMTP_DEFAULT_PORT[security]) : draft.port });
          }}
        >
          <SelectTrigger id="mail-security" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SMTP_SECURITY.map((security) => (
              <SelectItem key={security} value={security}>
                {SMTP_SECURITY_LABEL[security]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          {draft.security === 'none'
            ? 'Email goes over the network unencrypted. Use it only for a relay on your own network.'
            : draft.security === 'tls'
              ? 'Encrypted from the start, usually on port 465.'
              : 'Encrypted after the server greets, usually on port 587.'}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mail-port">Port</Label>
        <Input
          id="mail-port"
          type="number"
          min={1}
          max={65535}
          value={draft.port}
          onChange={(event) => onChange({ ...draft, port: event.target.value })}
          className="w-28"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mail-user">
          User name <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="mail-user"
          value={draft.user}
          onChange={(event) => onChange({ ...draft, user: event.target.value })}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mail-password">Password</Label>
        <Input
          id="mail-password"
          type="password"
          value={draft.password}
          onChange={(event) => onChange({ ...draft, password: event.target.value, removePassword: false })}
          placeholder={saved.hasPassword && !draft.removePassword ? 'Saved. Leave empty to keep it.' : undefined}
          autoComplete="new-password"
          disabled={!draft.user.trim()}
        />
        <div className="flex items-start justify-between gap-3">
          <p className="text-muted-foreground text-xs">
            {draft.removePassword
              ? 'The saved password is removed when you save.'
              : !draft.user.trim()
                ? 'Enter the user name first. A server that takes email without a sign-in needs neither.'
                : 'Stored encrypted on the server and never shown again. Some services want an app password here.'}
          </p>
          {saved.hasPassword && (
            <Hint text={draft.removePassword ? 'Keep the saved password after all.' : 'Remove the saved password when you save. Nothing changes until then.'}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => onChange({ ...draft, password: '', removePassword: !draft.removePassword })}
              >
                {draft.removePassword ? 'Keep password' : 'Remove password'}
              </Button>
            </Hint>
          )}
        </div>
      </div>
    </>
  );
}

/** Microsoft 365: the app registration Spooldoc signs in as, by the client credentials flow. */
function M365Fields({ saved, draft, onChange }: MailFieldsProps) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mail-tenant">Directory (tenant) ID</Label>
        <Input
          id="mail-tenant"
          value={draft.tenantId}
          onChange={(event) => onChange({ ...draft, tenantId: event.target.value })}
          placeholder="00000000-0000-0000-0000-000000000000"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-muted-foreground text-xs">A GUID, or a domain such as contoso.onmicrosoft.com. Empty turns email off.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mail-client">Application (client) ID</Label>
        <Input
          id="mail-client"
          value={draft.clientId}
          onChange={(event) => onChange({ ...draft, clientId: event.target.value })}
          placeholder="00000000-0000-0000-0000-000000000000"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-muted-foreground text-xs">Both IDs are on the Overview page of the app registration in Microsoft Entra ID.</p>
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="mail-secret">Client secret</Label>
        <Input
          id="mail-secret"
          type="password"
          value={draft.clientSecret}
          onChange={(event) => onChange({ ...draft, clientSecret: event.target.value })}
          placeholder={saved.hasClientSecret ? 'Saved. Leave empty to keep it.' : undefined}
          autoComplete="new-password"
          spellCheck={false}
        />
        <p className="text-muted-foreground text-xs">
          The secret&apos;s value, not its ID, from Certificates &amp; secrets. Stored encrypted on the server and never shown again. Make a new one before it expires.
        </p>
      </div>
    </>
  );
}

/** How email destinations send (an SMTP server or Microsoft 365), the From address, and a test email to yourself. */
function MailSection({ saved, draft, onChange }: { saved: MailView; draft: MailDraft; onChange(draft: MailDraft): void }) {
  const { user } = useAppInfo();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: true; to: string } | { ok: false; error: ShownError } | null>(null);
  const changed = mailChange(saved, draft) !== undefined;
  const m365 = draft.sender === 'm365';

  async function onTest() {
    setSending(true);
    setResult(null);
    try {
      const sent = await api<{ to: string }>('/api/settings/mail', { method: 'POST' });
      setResult({ ok: true, to: sent.to });
    } catch (err) {
      setResult({ ok: false, error: shownError(err) });
    } finally {
      setSending(false);
    }
  }

  return (
    <section id="mail" className="scroll-mt-4 rounded-lg border p-5">
      <h2 className="font-semibold">Mail server</h2>
      <p className="mt-0.5 mb-5 text-muted-foreground text-sm">
        {m365 ? (
          <>
            Email destinations send through Microsoft 365 with Microsoft Graph, as the mailbox below. Spooldoc signs in as an app registered in Microsoft
            Entra ID.{' '}
            <DocsLink page="configuration" anchor="microsoft-365">
              How to register the app
            </DocsLink>
          </>
        ) : (
          'Email destinations send through this SMTP server, such as your own mail server or a sending service. Every email comes from the address below.'
        )}
      </p>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="mail-sender">Send with</Label>
          <Select value={draft.sender} onValueChange={(next) => onChange({ ...draft, sender: next as MailSenderKind })}>
            <SelectTrigger id="mail-sender" className="w-full sm:w-[calc(50%-0.75rem)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MAIL_SENDERS.map((sender) => (
                <SelectItem key={sender} value={sender}>
                  {MAIL_SENDER_LABEL[sender]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {m365 ? <M365Fields saved={saved} draft={draft} onChange={onChange} /> : <SmtpFields saved={saved} draft={draft} onChange={onChange} />}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mail-from">From address</Label>
          <Input
            id="mail-from"
            type="email"
            value={draft.from}
            onChange={(event) => onChange({ ...draft, from: event.target.value })}
            placeholder="invoices@example.com"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-muted-foreground text-xs">
            {m365 ? 'The mailbox Spooldoc sends as. The app must be allowed to send from it.' : 'An address the mail server lets this user send from.'}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mail-from-name">
            From name <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input id="mail-from-name" value={draft.fromName} onChange={(event) => onChange({ ...draft, fromName: event.target.value })} placeholder="Example Co" />
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-2 border-t pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <Hint
            text={
              changed
                ? 'Save your changes first: the test email uses the saved mail server.'
                : !saved.configured
                  ? saved.sender === 'm365'
                    ? 'Set the tenant ID, the client ID, the client secret and the From address, and save, first.'
                    : 'Set the host and the From address, and save, first.'
                  : `Send an email to ${user.email} ${saved.sender === 'm365' ? 'through Microsoft 365' : 'with the saved mail server'}, to check that it works.`
            }
          >
            <Button type="button" variant="outline" size="sm" onClick={() => void onTest()} disabled={sending || changed || !saved.configured}>
              {sending ? <Spinner /> : <SendIcon />}
              Send test email
            </Button>
          </Hint>
          {result?.ok && (
            <span className="flex items-center gap-1.5 text-emerald-700 text-sm dark:text-emerald-400" role="status">
              <CheckIcon className="size-4" aria-hidden />
              Test email sent to {result.to}.
            </span>
          )}
        </div>
        {result && !result.ok && <ErrorNote detail={result.error.detail}>{result.error.message}</ErrorNote>}
      </div>
    </section>
  );
}

/** The alert addresses as edited. */
interface AlertsDraft {
  to: string;
}

const alertsDraft = (saved: AlertsView): AlertsDraft => ({ to: saved.to });

/** The `alerts` part of a settings change, or undefined when nothing changed. */
function alertsChange(saved: AlertsView, draft: AlertsDraft) {
  const to = draft.to.trim();
  return to === saved.to ? undefined : { to };
}

/** Who gets an email when a run fails or watching stops, a test alert, and how the last alert went. */
function AlertsSection({ saved, draft, mailReady, onChange }: { saved: AlertsView; draft: AlertsDraft; mailReady: boolean; onChange(draft: AlertsDraft): void }) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: true; to: string } | { ok: false; error: ShownError } | null>(null);
  const changed = alertsChange(saved, draft) !== undefined;
  const problem = alertAddressProblem(draft.to);

  async function onTest() {
    setSending(true);
    setResult(null);
    try {
      const sent = await api<{ to: string }>('/api/settings/alerts', { method: 'POST' });
      setResult({ ok: true, to: sent.to });
    } catch (err) {
      setResult({ ok: false, error: shownError(err) });
    } finally {
      setSending(false);
    }
  }

  const error = saved.error;
  return (
    <section id="alerts" className="scroll-mt-4 rounded-lg border p-5">
      <h2 className="font-semibold">Alerts</h2>
      <p className="mt-0.5 mb-5 text-muted-foreground text-sm">
        Email when a run fails or ends with a warning, a server cannot be reached, or a queue is polled because real-time watching stopped. One email when a
        problem starts and one when it is fixed.{' '}
        <DocsLink page="configuration" anchor="alerts">
          How alerts work
        </DocsLink>
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="alerts-to">Email alerts to</Label>
        <Input
          id="alerts-to"
          value={draft.to}
          onChange={(event) => onChange({ ...draft, to: event.target.value })}
          placeholder="ops@example.com"
          aria-invalid={!!problem || undefined}
          aria-describedby="alerts-to-hint"
          autoComplete="off"
          spellCheck={false}
        />
        <p id="alerts-to-hint" className={problem ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}>
          {problem ?? 'Addresses separated by commas. Empty turns alerts off.'}
        </p>
        {!mailReady && (
          <p className="text-muted-foreground text-xs">
            Alerts send through the mail server.{' '}
            <a href="#mail" className="font-medium text-primary underline-offset-4 hover:underline">
              Set one above.
            </a>
          </p>
        )}
      </div>
      <div className="mt-5 flex flex-col gap-2 border-t pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <Hint
            text={
              changed
                ? 'Save your changes first: the test alert goes to the saved addresses.'
                : !mailReady
                  ? 'Set a mail server above, and save, first: alerts send through it.'
                  : !saved.to
                    ? 'Enter the addresses, and save, first.'
                    : `Send a test alert to ${saved.to}, to check that alerts arrive.`
            }
          >
            <Button type="button" variant="outline" size="sm" onClick={() => void onTest()} disabled={sending || changed || !mailReady || !saved.to}>
              {sending ? <Spinner /> : <SendIcon />}
              Send test alert
            </Button>
          </Hint>
          {result?.ok && (
            <span className="flex items-center gap-1.5 text-emerald-700 text-sm dark:text-emerald-400" role="status">
              <CheckIcon className="size-4" aria-hidden />
              Test alert sent to {result.to}.
            </span>
          )}
        </div>
        {result && !result.ok && <ErrorNote detail={result.error.detail}>{result.error.message}</ErrorNote>}
        {error ? (
          <ErrorNote detail={error.detail ?? undefined}>
            Could not send alerts at {new Date(error.at).toLocaleString()}: {/[.!?]$/.test(error.message) ? error.message : `${error.message}.`} The next try
            is at {new Date(error.nextTryAt).toLocaleTimeString()}.
          </ErrorNote>
        ) : (
          saved.sentAt && <p className="text-muted-foreground text-xs">Last alert sent at {new Date(saved.sentAt).toLocaleString()}.</p>
        )}
      </div>
    </section>
  );
}

/** The formats as edited. An empty currency is the number format's own. */
interface FormatsDraft {
  numberFormat: NumberLang;
  dateFormat: DateFormat;
  currency: string;
}

const formatsDraft = (saved: Formats): FormatsDraft => ({ ...saved, currency: saved.currency ?? '' });

/** How numbers, amounts and dates print in documents and email fields. */
function FormatsSection({ draft, onChange }: { draft: FormatsDraft; onChange(draft: FormatsDraft): void }) {
  const own = NUMBER_FORMATS.find((format) => format.lang === draft.numberFormat)?.currency ?? 'USD';
  const code = draft.currency.trim().toUpperCase();
  const known = code === '' || code in CURRENCIES;
  const example = formatC(1234.5, 2, { numberFormat: draft.numberFormat, currency: code && known ? code : null });
  return (
    <section id="formats" className="scroll-mt-4 rounded-lg border p-5">
      <h2 className="font-semibold">Formats</h2>
      <p className="mt-0.5 mb-5 text-muted-foreground text-sm">
        How numbers, amounts and dates print: in documents, through formatN, formatC and formatD in templates, and in email fields.
      </p>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="formats-number">Number format</Label>
          <Select value={draft.numberFormat} onValueChange={(next) => onChange({ ...draft, numberFormat: next as NumberLang })}>
            <SelectTrigger id="formats-number" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NUMBER_FORMATS.map((format) => (
                <SelectItem key={format.lang} value={format.lang}>
                  <span className="tabular">{format.example}</span>
                  <span className="text-muted-foreground">{format.language} month names</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">The separators of numbers and amounts, and the language of month and day names in formatD.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="formats-date">Date format</Label>
          <Select value={draft.dateFormat} onValueChange={(next) => onChange({ ...draft, dateFormat: next as DateFormat })}>
            <SelectTrigger id="formats-date" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_FORMATS.map((pattern) => (
                <SelectItem key={pattern} value={pattern}>
                  <span className="tabular">{formatD(EXAMPLE_DATE, pattern)}</span>
                  <span className="text-muted-foreground">{pattern}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">A date field in an email, without formatD. In a template, formatD sets the pattern.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="formats-currency">Currency</Label>
          <Input
            id="formats-currency"
            list="formats-currencies"
            value={draft.currency}
            onChange={(event) => onChange({ ...draft, currency: event.target.value.toUpperCase().slice(0, 3) })}
            placeholder={`${own}, the number format's own`}
            aria-invalid={!known || undefined}
            autoComplete="off"
            spellCheck={false}
            className="w-56 uppercase placeholder:normal-case"
          />
          <datalist id="formats-currencies">
            {[...COMMON_CURRENCIES, ...Object.keys(CURRENCIES).filter((c) => !(COMMON_CURRENCIES as readonly string[]).includes(c))].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <p className="text-muted-foreground text-xs">
            {known
              ? `The currency formatC prints, such as ${example}. Empty is ${own}, the currency of the number format.`
              : `Carbone does not know ${code}. Pick one of ${Object.keys(CURRENCIES).join(', ')}.`}
          </p>
        </div>
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
    cleanup.alerts > 0 && `${cleanup.alerts} closed ${cleanup.alerts === 1 ? 'alert' : 'alerts'}`,
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
  const [mail, setMail] = useState<MailDraft | null>(null);
  const [formats, setFormats] = useState<FormatsDraft | null>(null);
  const [alerts, setAlerts] = useState<AlertsDraft | null>(null);
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
        setMail(mailDraft(data.mail));
        setFormats(formatsDraft(data.formats));
        setAlerts(alertsDraft(data.alerts));
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
    if (!draft || !ai || !rendering || !mail || !formats || !alerts || !settings) return;
    setBusy(true);
    setError(null);
    try {
      const change = renderingChange(settings.rendering, rendering);
      const mailPart = mailChange(settings.mail, mail);
      const alertsPart = alertsChange(settings.alerts, alerts);
      const data = await api<SettingsView>('/api/settings', {
        method: 'PUT',
        body: { ...draft, ai: aiChange(ai), ...(change ? { rendering: change } : {}), ...(mailPart ? { mail: mailPart } : {}), ...(alertsPart ? { alerts: alertsPart } : {}), formats },
      });
      setSettings(data);
      setAi(aiDraft(data.ai, data.ai.provider));
      setRendering(renderingDraft(data.rendering));
      setMail(mailDraft(data.mail));
      setFormats(formatsDraft(data.formats));
      setAlerts(alertsDraft(data.alerts));
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
      {draft && ai && rendering && mail && formats && alerts && settings && (
        <form onSubmit={onSubmit} className="flex flex-col gap-6">
          <RenderingSection saved={settings.rendering} draft={rendering} busy={checking} onChange={setRendering} onCheck={() => void onCheck()} />
          <FormatsSection draft={formats} onChange={setFormats} />
          <MailSection saved={settings.mail} draft={mail} onChange={setMail} />
          <AlertsSection saved={settings.alerts} draft={alerts} mailReady={settings.mail.configured} onChange={setAlerts} />
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
