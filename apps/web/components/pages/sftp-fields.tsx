'use client';

import { AlertTriangleIcon, CheckIcon, FileUpIcon, PlugZapIcon, ShieldCheckIcon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { BoxHeader, useReducedMotion } from '@/components/code-box';
import { Hint } from '@/components/hint';
import { Choice } from '@/components/jobs/inspectors';
import { ErrorNote } from '@/components/page';
import { PublicKey } from '@/components/public-key';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { CopyButton } from '@/components/workbench/json-view';
import { api, shownError, type ShownError } from '@/lib/client/api';
import { duration } from '@/lib/client/format';
import { IF_EXISTS, IF_EXISTS_LABEL, type IfExists, type SftpAuth, type SftpKeyType } from '@/lib/destination-config';
import type { DestinationView, SftpCheckStage, SftpCheckView, SftpKeyView } from '@/lib/types';
import { cn } from '@/lib/utils';

type SftpDestination = Extract<DestinationView, { kind: 'sftp' }>;

/** The SFTP part of the destination dialog, as the person fills it in. */
export interface SftpDraft {
  host: string;
  port: string;
  username: string;
  auth: SftpAuth;
  folder: string;
  testFolder: string;
  ifExists: IfExists;
  tempName: boolean;
  keepCopy: boolean;
  /** A key made in this dialog; the private key stays sealed. */
  made: SftpKeyView | null;
  privateKey: string;
  passphrase: string;
  password: string;
  /** The token of the host key a check trusted, and the host and port it is for. */
  trust: { token: string; for: string } | null;
}

/** The dialog's SFTP part for a new destination, or one being edited. */
export function sftpDraft(destination: SftpDestination | null): SftpDraft {
  const config = destination?.config;
  return {
    host: config?.host ?? '',
    port: String(config?.port ?? 22),
    username: config?.username ?? '',
    auth: config?.auth ?? 'spooldoc-key',
    folder: config?.folder ?? '',
    testFolder: config?.testFolder ?? '',
    ifExists: config?.ifExists ?? 'replace',
    tempName: config?.tempName ?? true,
    keepCopy: config?.keepCopy ?? true,
    made: null,
    privateKey: '',
    passphrase: '',
    password: '',
    trust: null,
  };
}

const targetOf = (draft: Pick<SftpDraft, 'host' | 'port'>) => `${draft.host.trim()}:${draft.port.trim()}`;

/** What the dialog sends to save the destination, or to check it. */
export function sftpPayload(draft: SftpDraft) {
  const secrets = {
    ...(draft.auth === 'password' && draft.password ? { password: draft.password } : {}),
    ...(draft.auth === 'own-key' && draft.privateKey.trim() ? { privateKey: draft.privateKey } : {}),
    ...(draft.auth === 'own-key' && draft.passphrase ? { passphrase: draft.passphrase } : {}),
  };
  return {
    config: {
      host: draft.host,
      port: Number(draft.port) || draft.port,
      username: draft.username,
      auth: draft.auth,
      folder: draft.folder,
      testFolder: draft.testFolder.trim() || null,
      ifExists: draft.ifExists,
      tempName: draft.tempName,
      keepCopy: draft.keepCopy,
    },
    secrets,
    ...(draft.auth === 'spooldoc-key' && draft.made ? { sealedKey: draft.made.sealed } : {}),
    ...(draft.trust && draft.trust.for === targetOf(draft) ? { hostKeyToken: draft.trust.token } : {}),
  };
}

/** The check prints its lines one by one, this fast, as the webhook answer does. */
const PRINT_MS = 60;

/** The words of a failed line, before the error itself. */
function failedLabel(stage: SftpCheckStage, draft: SftpDraft): string {
  if (stage.stage === 'reach') return `Reach ${draft.host.trim()} on port ${draft.port.trim()}`;
  if (stage.stage === 'hostKey') return 'Check the host key';
  if (stage.stage === 'signIn') return `Sign in as ${draft.username.trim()}`;
  if (stage.stage === 'testFolder') return `Find ${draft.testFolder.trim()}`;
  return `Find ${draft.folder.trim()}`;
}

/** One line of the connection box: an icon, the text, and the time on the right. */
function CheckLine({ icon, tone, children, ms }: { icon: 'ok' | 'warn' | 'bad' | 'trusted'; tone?: 'bad'; children: React.ReactNode; ms?: number }) {
  const Icon = { ok: CheckIcon, warn: AlertTriangleIcon, bad: XIcon, trusted: ShieldCheckIcon }[icon];
  return (
    <div className="flex min-h-5 min-w-0 items-start gap-2 px-3">
      <Icon
        aria-hidden
        className={cn(
          'mt-[3px] size-3.5 shrink-0',
          icon === 'ok' && 'text-emerald-700 dark:text-emerald-400',
          icon === 'warn' && 'text-amber-700 dark:text-amber-400',
          icon === 'bad' && 'text-destructive',
          icon === 'trusted' && 'text-primary',
        )}
      />
      <div className={cn('min-w-0 flex-1 [overflow-wrap:anywhere]', tone === 'bad' && 'text-destructive')}>{children}</div>
      {ms !== undefined && <span className="tabular shrink-0 font-sans text-muted-foreground">{duration(ms)}</span>}
    </div>
  );
}

/**
 * The connection box: Check connection, and its lines as an SSH session prints them, one
 * by one. It stops at a host key Spooldoc does not trust, with the key's fingerprint and
 * the command to compare it on the server, and Trust this key.
 */
function ConnectionBox({
  draft,
  destination,
  onTrust,
}: {
  draft: SftpDraft;
  destination: SftpDestination | null;
  onTrust(trust: SftpDraft['trust']): void;
}) {
  const reduced = useReducedMotion();
  const [state, setState] = useState<{ checking: boolean; view: SftpCheckView | null; error: ShownError | null; seq: number; for: string }>({
    checking: false,
    view: null,
    error: null,
    seq: 0,
    for: '',
  });
  const [confirmChanged, setConfirmChanged] = useState(false);
  const [printed, setPrinted] = useState({ seq: 0, count: 0 });

  // A check is about the host and port it ran for: another one makes it stale.
  const stale = state.view !== null && state.for !== targetOf(draft);

  async function check(trust?: string) {
    setState((current) => ({ ...current, checking: true, error: null }));
    const payload = sftpPayload(draft);
    const token = trust ?? payload.hostKeyToken;
    try {
      const view = await api<SftpCheckView>('/api/destinations/sftp-check', {
        method: 'POST',
        body: { destinationId: destination?.id ?? null, config: payload.config, secrets: payload.secrets, sealedKey: payload.sealedKey, trust: token ?? null },
      });
      if (view.trusted) onTrust({ token: view.trusted.token, for: targetOf(draft) });
      setState((current) => ({ checking: false, view, error: null, seq: current.seq + 1, for: targetOf(draft) }));
    } catch (err) {
      setState((current) => ({ ...current, checking: false, error: shownError(err) }));
    }
  }

  const view = stale ? null : state.view;
  const stages = useMemo(() => view?.stages ?? [], [view]);
  useEffect(() => {
    if (!view || reduced) return;
    const seq = state.seq;
    const timers = view.stages.map((_, index) => setTimeout(() => setPrinted({ seq, count: index + 1 }), (index + 1) * PRINT_MS));
    return () => timers.forEach(clearTimeout);
  }, [view, state.seq, reduced]);
  const shown = reduced ? stages.length : printed.seq === state.seq ? printed.count : 0;

  const failed = stages.find((stage) => stage.status === 'failed');
  const untrusted = view?.hostKey;
  const announcement = state.checking
    ? 'Checking the connection.'
    : view
      ? failed
        ? `Check failed: ${failed.text}`
        : untrusted
          ? untrusted.state === 'new'
            ? `New host key ${untrusted.fingerprint}. Compare it, then trust it.`
            : 'The host key changed.'
          : 'The connection works.'
      : '';

  return (
    <section aria-label="Connection" className="flex min-w-0 flex-col gap-2">
      <div className="min-w-0 overflow-hidden rounded-md border bg-background font-mono text-foreground text-xs leading-5" aria-busy={state.checking || undefined}>
        <BoxHeader
          left="Connection"
          right={
            <Hint text="Connects, checks the host key, signs in and looks for the folders. It writes nothing, and saves nothing.">
              <Button type="button" variant="outline" size="xs" onClick={() => void check()} disabled={state.checking}>
                {state.checking ? <Spinner /> : <PlugZapIcon />}
                {state.checking ? 'Checking...' : 'Check connection'}
              </Button>
            </Hint>
          }
        />
        <div className="flex flex-col gap-0.5 py-2">
          {!view && !state.checking && (
            <p className="px-3 font-sans text-muted-foreground">
              {stale ? 'The server changed. Check the connection again.' : 'Check connection signs in and looks for the folders. It writes nothing.'}
            </p>
          )}
          {!view && state.checking && <p className="px-3 font-sans text-muted-foreground">Connecting to {draft.host.trim() || 'the server'}...</p>}
          {stages.slice(0, shown).map((stage, index) => {
            if (stage.stage === 'hostKey' && stage.status === 'ok' && view?.trusted) {
              return (
                <CheckLine key={index} icon="trusted">
                  <span className="font-sans">Trusted {view.trusted.type} key </span>
                  {view.trusted.fingerprint}
                </CheckLine>
              );
            }
            if (stage.stage === 'hostKey' && (stage.status === 'new' || stage.status === 'changed') && untrusted) {
              const changed = untrusted.state === 'changed';
              return (
                <div key={index} className="flex flex-col gap-1">
                  <CheckLine icon={changed ? 'bad' : 'warn'} tone={changed ? 'bad' : undefined}>
                    <span className="font-sans font-medium">{changed ? 'The host key changed' : 'New host key'}</span>{' '}
                    <span className="font-sans text-muted-foreground">
                      {untrusted.type} {untrusted.bits}
                    </span>
                  </CheckLine>
                  <div className="flex flex-col gap-1 pr-3 pl-[calc(0.75rem+0.875rem+0.5rem)]">
                    {changed && untrusted.trustedFingerprint && (
                      <div className="text-destructive">
                        <span className="font-sans">Trusted </span>
                        {untrusted.trustedFingerprint}
                      </div>
                    )}
                    <div className={cn(changed && 'text-destructive')}>
                      {changed && <span className="font-sans">Now </span>}
                      {untrusted.fingerprint}
                    </div>
                    {view?.compare && (
                      <div className="flex min-w-0 items-center gap-1 font-sans text-muted-foreground">
                        <span className="min-w-0">
                          Compare it on the server: <code className="font-mono text-foreground">{view.compare}</code>
                        </span>
                        <CopyButton text={view.compare} label="Copy the command" hint="Copy the command to the clipboard" className="shrink-0" />
                      </div>
                    )}
                    {changed && (
                      <p className="font-sans text-destructive">
                        If the server&apos;s admin changed it, trust the new key. If not, do not: something may be between Spooldoc and the server.
                      </p>
                    )}
                    <div className="py-1 font-sans">
                      <Button
                        type="button"
                        size="sm"
                        variant={changed ? 'destructive' : 'default'}
                        onClick={() => (changed ? setConfirmChanged(true) : void check(untrusted.token))}
                        disabled={state.checking}
                      >
                        <ShieldCheckIcon />
                        {changed ? 'Trust the new key' : 'Trust this key'}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            }
            if (stage.status === 'failed') {
              return (
                <div key={index} className="flex flex-col gap-1">
                  <CheckLine icon="bad" tone="bad" ms={stage.ms}>
                    <span className="font-sans">{failedLabel(stage, draft)}</span>
                  </CheckLine>
                  <div className="px-3 font-sans">
                    <ErrorNote detail={stage.detail}>{stage.text}</ErrorNote>
                  </div>
                </div>
              );
            }
            return (
              <CheckLine key={index} icon="ok" ms={stage.ms}>
                <SftpLineText text={stage.text} />
              </CheckLine>
            );
          })}
          {/* Room for the lines still to print, so the box does not jump. */}
          {shown < stages.length && <div aria-hidden style={{ height: (stages.length - shown) * 20 }} />}
        </div>
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
      {state.error && <ErrorNote detail={state.error.detail}>{state.error.message}</ErrorNote>}
      <AlertDialog open={confirmChanged} onOpenChange={setConfirmChanged}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trust the new host key?</AlertDialogTitle>
            <AlertDialogDescription>
              Only trust it if the server&apos;s admin says the key changed. A key that changed without a reason can mean that something is between Spooldoc
              and the server.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmChanged(false);
                if (untrusted) void check(untrusted.token);
              }}
            >
              Trust the new key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** A check line's text: the words in the UI font, the strings that exist on the server in mono. */
function SftpLineText({ text }: { text: string }) {
  // "Reached sftp.example.com on port 22", "Signed in as MYUSER with the key", "Found /in/invoices, 312 files".
  const match = /^(Reached |Signed in as |Found )(\S+)(.*)$/.exec(text);
  if (!match) return <span className="font-sans">{text}</span>;
  return (
    <>
      <span className="font-sans">{match[1]}</span>
      {match[2]}
      <span className="font-sans">{match[3]}</span>
    </>
  );
}

/**
 * The fields of an SFTP destination: the server, the user and how to sign in, the folder
 * and the test folder, the same-name rule and the safe write, and the connection box.
 */
export function SftpFields({
  destination,
  draft,
  onDraft,
  nameOf,
}: {
  destination: SftpDestination | null;
  draft: SftpDraft;
  onDraft: Dispatch<SetStateAction<SftpDraft>>;
  /** The destination's name as typed, for the comment of a key Spooldoc makes. */
  nameOf(): string;
}) {
  const set = (change: Partial<SftpDraft>) => onDraft((current) => ({ ...current, ...change }));
  const saved = destination?.config ?? null;
  const [making, setMaking] = useState(false);
  const [keyError, setKeyError] = useState<ShownError | null>(null);
  const [confirmNewKey, setConfirmNewKey] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const savedKey = saved?.auth === 'spooldoc-key' && saved.hasKey && saved.publicKey ? saved.publicKey : null;
  const keyType: SftpKeyType = draft.made?.key.type === 'RSA' ? 'rsa' : 'ed25519';

  async function makeKey(type: SftpKeyType) {
    setMaking(true);
    setKeyError(null);
    try {
      const made = await api<SftpKeyView>('/api/destinations/sftp-key', { method: 'POST', body: { type, name: nameOf() } });
      set({ made });
    } catch (err) {
      setKeyError(shownError(err));
    }
    setMaking(false);
  }

  // The key Spooldoc makes is made on first pick, so it can be added to the server and checked before saving.
  const wantsKey = draft.auth === 'spooldoc-key' && !draft.made && !savedKey;
  const asked = useRef(false);
  useEffect(() => {
    if (!wantsKey || asked.current) return;
    asked.current = true;
    void makeKey('ed25519');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsKey]);

  async function readFile(file: File) {
    set({ privateKey: await file.text() });
  }

  const user = draft.username.trim() || 'the user';
  const publicKey = draft.made?.publicKey ?? savedKey;
  const ownSaved = saved?.auth === 'own-key' && saved.hasKey ? saved.key : null;
  const passwordSaved = saved?.auth === 'password' && saved.hasPassword;

  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sftp-host">Server</Label>
          <Input
            id="sftp-host"
            required
            value={draft.host}
            onChange={(event) => set({ host: event.target.value })}
            placeholder="sftp.example.com"
            autoComplete="off"
            spellCheck={false}
            className="font-mono placeholder:font-sans"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sftp-port">Port</Label>
          <Input
            id="sftp-port"
            required
            inputMode="numeric"
            value={draft.port}
            onChange={(event) => set({ port: event.target.value.replace(/[^0-9]/g, '') })}
            autoComplete="off"
            className="tabular font-mono"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sftp-user">User</Label>
        <Input
          id="sftp-user"
          required
          value={draft.username}
          onChange={(event) => set({ username: event.target.value })}
          placeholder="MYUSER"
          autoComplete="off"
          spellCheck={false}
          className="font-mono placeholder:font-sans"
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-medium text-sm" id="sftp-auth">
          Sign in with
        </span>
        <div role="radiogroup" aria-labelledby="sftp-auth" className="grid gap-2 sm:grid-cols-3">
          <Choice selected={draft.auth === 'spooldoc-key'} onSelect={() => set({ auth: 'spooldoc-key' })} title="Key Spooldoc makes">
            Nobody handles a private key.
          </Choice>
          <Choice selected={draft.auth === 'own-key'} onSelect={() => set({ auth: 'own-key' })} title="Your key">
            A private key you have.
          </Choice>
          <Choice selected={draft.auth === 'password'} onSelect={() => set({ auth: 'password' })} title="Password">
            When the server takes no key.
          </Choice>
        </div>

        {draft.auth === 'spooldoc-key' &&
          (publicKey ? (
            <PublicKey
              id="sftp-public-key"
              value={publicKey}
              label={<span className="sr-only">Public key</span>}
              help={
                <>
                  Add this line to <code className="font-mono">~/.ssh/authorized_keys</code> of {user} on the server, or send it to the server&apos;s admin.
                  The private key never leaves Spooldoc.
                </>
              }
              actions={
                draft.made ? (
                  <Hint text={`Makes ${keyType === 'rsa' ? 'an Ed25519' : 'an RSA 4096'} key in place of this one, for a server that refuses ${keyType === 'rsa' ? 'RSA' : 'Ed25519'}.`}>
                    <button
                      type="button"
                      onClick={() => void makeKey(keyType === 'rsa' ? 'ed25519' : 'rsa')}
                      disabled={making}
                      className="rounded-sm text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
                    >
                      {making ? 'Making the key...' : keyType === 'rsa' ? 'Make an Ed25519 key instead' : 'Make an RSA key instead'}
                    </button>
                  </Hint>
                ) : (
                  <Hint text="Makes a new key for this destination. Runs use it once you save.">
                    <button
                      type="button"
                      onClick={() => setConfirmNewKey(true)}
                      disabled={making}
                      className="rounded-sm text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
                    >
                      Make a new key
                    </button>
                  </Hint>
                )
              }
            />
          ) : keyError ? (
            <ErrorNote
              detail={keyError.detail}
              action={
                <Button type="button" variant="outline" size="sm" onClick={() => void makeKey('ed25519')}>
                  Try again
                </Button>
              }
            >
              Could not make the key. {keyError.message}
            </ErrorNote>
          ) : (
            <p className="flex items-center gap-2 rounded-md bg-muted p-3 text-muted-foreground text-xs">
              <Spinner /> Making a key...
            </p>
          ))}

        {draft.auth === 'own-key' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="sftp-private-key">Private key</Label>
                <input
                  ref={fileInput}
                  type="file"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void readFile(file);
                    event.target.value = '';
                  }}
                />
                <Hint text="Reads a key file in the browser and puts it in the box. The file is sent only when you save.">
                  <Button type="button" variant="ghost" size="sm" onClick={() => fileInput.current?.click()}>
                    <FileUpIcon />
                    Choose file
                  </Button>
                </Hint>
              </div>
              <Textarea
                id="sftp-private-key"
                value={draft.privateKey}
                onChange={(event) => set({ privateKey: event.target.value })}
                placeholder={ownSaved ? 'Saved. Leave empty to keep it.' : '-----BEGIN OPENSSH PRIVATE KEY-----'}
                spellCheck={false}
                autoComplete="off"
                rows={4}
                className="font-mono text-xs placeholder:font-sans"
                aria-describedby="sftp-private-key-hint"
              />
              <p id="sftp-private-key-hint" className="text-muted-foreground text-xs">
                {ownSaved ? (
                  <>
                    Saved: {ownSaved.type} key <span className="font-mono">{ownSaved.fingerprint}</span>. Paste another to replace it.
                  </>
                ) : (
                  'An OpenSSH, PEM or PuTTY private key. It is stored encrypted and never shown again.'
                )}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sftp-passphrase">
                Passphrase <span className="font-normal text-muted-foreground">(if the key has one)</span>
              </Label>
              <Input
                id="sftp-passphrase"
                type="password"
                value={draft.passphrase}
                onChange={(event) => set({ passphrase: event.target.value })}
                placeholder={ownSaved ? 'Saved. Leave empty to keep it.' : ''}
                autoComplete="new-password"
              />
            </div>
          </div>
        )}

        {draft.auth === 'password' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sftp-password">Password</Label>
            <Input
              id="sftp-password"
              type="password"
              value={draft.password}
              onChange={(event) => set({ password: event.target.value })}
              placeholder={passwordSaved ? 'Saved. Leave empty to keep it.' : ''}
              autoComplete="new-password"
              aria-describedby="sftp-password-hint"
            />
            <p id="sftp-password-hint" className="text-muted-foreground text-xs">
              Stored encrypted, and sent only to this server and user. Spooldoc also gives it when the server asks for it as a prompt.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sftp-folder">Folder</Label>
        <Input
          id="sftp-folder"
          required
          value={draft.folder}
          onChange={(event) => set({ folder: event.target.value })}
          placeholder="/in/invoices"
          autoComplete="off"
          spellCheck={false}
          className="font-mono placeholder:font-sans"
          aria-describedby="sftp-folder-hint"
        />
        <p id="sftp-folder-hint" className="text-muted-foreground text-xs">
          On the server. A folder that does not start with / is in the user&apos;s home folder. Spooldoc does not create the folder.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sftp-test-folder">
          Upload all files to <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="sftp-test-folder"
          value={draft.testFolder}
          onChange={(event) => set({ testFolder: event.target.value })}
          placeholder="/test/in"
          autoComplete="off"
          spellCheck={false}
          className="font-mono placeholder:font-sans"
          aria-describedby="sftp-test-folder-hint"
        />
        <p id="sftp-test-folder-hint" className="text-muted-foreground text-xs">
          While this is set, runs and Upload test write here instead of the folder, marked as a test.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sftp-if-exists">When a file with the same name exists</Label>
        <Select value={draft.ifExists} onValueChange={(value) => set({ ifExists: value as IfExists })}>
          <SelectTrigger id="sftp-if-exists" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {IF_EXISTS.map((choice) => (
              <SelectItem key={choice} value={choice}>
                {IF_EXISTS_LABEL[choice]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox id="sftp-temp-name" checked={draft.tempName} onCheckedChange={(checked) => set({ tempName: checked === true })} className="mt-0.5" />
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="sftp-temp-name" className="font-normal">
            Write each file under a temporary name first
          </Label>
          <p className="text-muted-foreground text-xs">
            Each file is renamed when it is whole, so the receiver sees whole files only. Turn it off for a server that refuses renames, or that picks up
            each file as soon as it is closed.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox id="sftp-keep-copy" checked={draft.keepCopy} onCheckedChange={(checked) => set({ keepCopy: checked === true })} className="mt-0.5" />
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="sftp-keep-copy" className="font-normal">
            Keep a copy in Spooldoc
          </Label>
          <p className="text-muted-foreground text-xs">The files can then be downloaded from the Job log, even when the upload fails.</p>
        </div>
      </div>

      <ConnectionBox draft={draft} destination={destination} onTrust={(trust) => set({ trust })} />

      <AlertDialog open={confirmNewKey} onOpenChange={setConfirmNewKey}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make a new key?</AlertDialogTitle>
            <AlertDialogDescription>
              Spooldoc uses the new key from the next run. Add it to the server first, or runs fail to sign in. The old key stays on the server until its
              admin removes it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmNewKey(false);
                void makeKey('ed25519');
              }}
            >
              Make a new key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
