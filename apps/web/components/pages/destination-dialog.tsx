'use client';

import { PlusIcon, Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { useAppInfo } from '@/components/app-info';
import { Hint } from '@/components/hint';
import { Choice } from '@/components/jobs/inspectors';
import { ErrorNote } from '@/components/page';
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { CopyButton } from '@/components/workbench/json-view';
import { api, shownError, type ShownError } from '@/lib/client/api';
import { IF_EXISTS, IF_EXISTS_LABEL, type IfExists } from '@/lib/destination-config';
import type { DestinationView } from '@/lib/types';

/** A destination a user adds and changes: an IFS folder, email or a webhook. */
export type EditableDestination = Extract<DestinationView, { kind: 'ifs' | 'email' | 'webhook' }>;

/** A saved destination, with the signing secret when it was just made. */
type Saved = DestinationView & { revealedSecret?: string };

type Kind = EditableDestination['kind'];

const DESCRIPTION: Record<Kind, string> = {
  ifs: 'Each run writes its files to a folder in the IFS. Spooldoc does not create the folder.',
  email: 'Each run sends one email per document, through the mail server in Settings. Each job sets To, Subject and the message.',
  webhook: 'Each run posts one call per document to a URL, as JSON with its data and files, signed so the receiver can check it came from Spooldoc.',
};

/** A header row of the dialog. A `saved` row has a value Spooldoc keeps; an empty field keeps it. */
interface HeaderRow {
  key: number;
  name: string;
  value: string;
  saved: boolean;
}

/** True for a URL that is plain http, so the call and its files are not encrypted. */
const isPlainHttp = (value: string) => /^http:\/\//i.test(value.trim());

/** The fields of a webhook destination: the URL, the test URL and the headers. */
function WebhookFields({
  destination,
  headers,
  onHeaders,
}: {
  destination: Extract<DestinationView, { kind: 'webhook' }> | null;
  headers: HeaderRow[];
  onHeaders(rows: HeaderRow[]): void;
}) {
  const [url, setUrl] = useState(destination?.config.url ?? '');
  const next = useRef(headers.length);
  const set = (key: number, change: Partial<HeaderRow>) => onHeaders(headers.map((row) => (row.key === key ? { ...row, ...change } : row)));
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="destination-url">URL</Label>
        <Input
          id="destination-url"
          name="url"
          type="url"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://hooks.example.com/spooldoc"
          autoComplete="off"
          spellCheck={false}
          className="font-mono placeholder:font-sans"
          aria-describedby="destination-url-hint"
        />
        <p id="destination-url-hint" className="text-muted-foreground text-xs">
          Each call is a POST of JSON. Spooldoc does not follow redirects, and waits 30 seconds for an answer.
        </p>
        {isPlainHttp(url) && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            This URL is http, not https: each call and its files travel unencrypted. Use https unless the receiver is on your own network.
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="destination-test-url">
          Send all calls to <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="destination-test-url"
          name="testUrl"
          type="url"
          defaultValue={destination?.config.testUrl ?? ''}
          placeholder="https://inspect.example.com/abc"
          autoComplete="off"
          spellCheck={false}
          className="font-mono placeholder:font-sans"
          aria-describedby="destination-test-url-hint"
        />
        <p id="destination-test-url-hint" className="text-muted-foreground text-xs">
          While this is set, runs and tests post here instead, marked as a test and without the header values. A public request inspector shows the
          sample&apos;s values to anyone with the link.
        </p>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 font-medium text-sm">
          Headers <span className="font-normal text-muted-foreground">(optional)</span>
        </legend>
        {headers.map((row, index) => (
          <div key={row.key} className="flex items-center gap-2">
            <Input
              aria-label={`Name of header ${index + 1}`}
              value={row.name}
              onChange={(event) => set(row.key, { name: event.target.value })}
              placeholder="Authorization"
              autoComplete="off"
              spellCheck={false}
              className="w-2/5 font-mono placeholder:font-sans"
            />
            <Input
              aria-label={`Value of header ${index + 1}`}
              type="password"
              value={row.value}
              onChange={(event) => set(row.key, { value: event.target.value })}
              placeholder={row.saved ? 'Saved. Leave empty to keep it.' : 'Value'}
              autoComplete="new-password"
              spellCheck={false}
              className="min-w-0 flex-1 font-mono placeholder:font-sans"
            />
            <Hint text="Remove the header when you save.">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove header ${row.name || index + 1}`}
                onClick={() => onHeaders(headers.filter((other) => other.key !== row.key))}
              >
                <Trash2Icon />
              </Button>
            </Hint>
          </div>
        ))}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => onHeaders([...headers, { key: next.current++, name: '', value: '', saved: false }])}>
            <PlusIcon />
            Add header
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Sent with every call, such as an API key the receiver asks for. The values are stored encrypted and never shown again.
        </p>
      </fieldset>
    </>
  );
}

/** The signing secret, shown once after it was made. */
function RevealedSecret({ secret }: { secret: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="destination-secret">Signing secret</Label>
      <div className="flex items-center gap-2">
        <Input
          id="destination-secret"
          readOnly
          value={secret}
          className="font-mono text-xs"
          onFocus={(event) => event.target.select()}
          aria-describedby="destination-secret-hint"
        />
        <CopyButton text={secret} label="Copy the signing secret" hint="Copy the signing secret to the clipboard" className="shrink-0" />
      </div>
      <p id="destination-secret-hint" className="text-muted-foreground text-xs">
        Shown once. The receiver uses it to check each call.{' '}
        <Link href="/docs/destinations#checking-the-signature" className="text-primary hover:underline">
          How to check it
        </Link>
      </p>
    </div>
  );
}

/** The fields of an IFS folder. */
function IfsFields({ destination }: { destination: Extract<DestinationView, { kind: 'ifs' }> | null }) {
  const [ifExists, setIfExists] = useState<IfExists>(destination?.config.ifExists ?? 'replace');
  const [keepCopy, setKeepCopy] = useState(destination?.config.keepCopy ?? true);
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="destination-folder">Folder</Label>
        <Input
          id="destination-folder"
          name="folder"
          required
          defaultValue={destination?.config.folder ?? ''}
          placeholder="/home/docs/out"
          autoComplete="off"
          spellCheck={false}
          className="font-mono placeholder:font-sans"
          aria-describedby="destination-folder-hint"
        />
        <p id="destination-folder-hint" className="text-muted-foreground text-xs">
          On the server of each job that uses it. The server&apos;s user profile needs *WX authority on it.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="destination-if-exists">When a file with the same name exists</Label>
        <input type="hidden" name="ifExists" value={ifExists} />
        <Select value={ifExists} onValueChange={(value) => setIfExists(value as IfExists)}>
          <SelectTrigger id="destination-if-exists" className="w-full">
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
        <input type="hidden" name="keepCopy" value={keepCopy ? 'on' : ''} />
        <Checkbox id="destination-keep-copy" checked={keepCopy} onCheckedChange={(checked) => setKeepCopy(checked === true)} className="mt-0.5" />
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="destination-keep-copy" className="font-normal">
            Keep a copy in Spooldoc
          </Label>
          <p className="text-muted-foreground text-xs">The files can then be downloaded from the Job log, even when the write fails.</p>
        </div>
      </div>
    </>
  );
}

/** The fields of an email destination: the test address. */
function EmailFields({ destination }: { destination: Extract<DestinationView, { kind: 'email' }> | null }) {
  const { mail, user } = useAppInfo();
  return (
    <>
      {!mail && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          No mail server is set yet, so nothing can be sent.{' '}
          <Link href="/settings#mail" className="text-primary hover:underline">
            Set one in Settings
          </Link>
          .
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="destination-test-address">Send all email to</Label>
        <Input
          id="destination-test-address"
          name="testAddress"
          type="email"
          defaultValue={destination ? (destination.config.testAddress ?? '') : user.email}
          placeholder="you@example.com"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="destination-test-address-hint"
        />
        <p id="destination-test-address-hint" className="text-muted-foreground text-xs">
          While this is set, every email goes only to this address, marked as a test. Empty it to send to the addresses each job sets.
        </p>
      </div>
    </>
  );
}

/**
 * Add a destination (`destination` null), an IFS folder, email or a webhook, or edit one.
 * The kind cannot be changed once saved. An IFS folder is on the server of each job that
 * uses the destination, so nothing is checked on the IBM i here. A new webhook, or one
 * whose secret is rotated, shows its signing secret once before the dialog closes.
 */
export function DestinationDialog({
  destination,
  onClose,
  onSaved,
}: {
  destination: EditableDestination | null;
  onClose(): void;
  onSaved(destination: DestinationView): void;
}) {
  const [kind, setKind] = useState<Kind>(destination?.kind ?? 'ifs');
  const [error, setError] = useState<ShownError | null>(null);
  const [busy, setBusy] = useState(false);
  const [headers, setHeaders] = useState<HeaderRow[]>(() =>
    destination?.kind === 'webhook' ? destination.config.headers.map((header, key) => ({ key, name: header.name, value: '', saved: true })) : [],
  );
  // A secret to show once: after adding a webhook (with the destination to hand back on Done), or after rotating.
  const [revealed, setRevealed] = useState<{ secret: string; saved: DestinationView | null } | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);

  async function rotate() {
    if (!destination) return;
    setConfirmRotate(false);
    setBusy(true);
    setError(null);
    try {
      const saved = await api<Saved>(`/api/destinations/${destination.id}`, { method: 'PATCH', body: { rotateSecret: true } });
      if (saved.revealedSecret) setRevealed({ secret: saved.revealedSecret, saved: null });
    } catch (err) {
      setError(shownError(err));
    }
    setBusy(false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '');
    const config =
      kind === 'ifs'
        ? { folder: value('folder'), ifExists: value('ifExists') as IfExists, keepCopy: value('keepCopy') === 'on' }
        : kind === 'email'
          ? { testAddress: value('testAddress').trim() || null }
          : { url: value('url'), testUrl: value('testUrl').trim() || null };
    // Rows with neither a name nor a value are left out; a saved value left empty is kept.
    const rows = headers.filter((row) => row.name.trim() || row.value);
    const extra =
      kind !== 'webhook'
        ? {}
        : destination
          ? { headers: rows.map((row) => ({ name: row.name.trim(), value: row.saved && !row.value ? null : row.value })) }
          : { headers: rows.map((row) => ({ name: row.name.trim(), value: row.value })) };
    setBusy(true);
    setError(null);
    try {
      const saved = destination
        ? await api<Saved>(`/api/destinations/${destination.id}`, { method: 'PATCH', body: { name: value('name'), config, ...extra } })
        : await api<Saved>('/api/destinations', { method: 'POST', body: { kind, name: value('name'), config, ...extra } });
      if (saved.revealedSecret) {
        const { revealedSecret, ...view } = saved;
        setRevealed({ secret: revealedSecret, saved: view as DestinationView });
        setBusy(false);
        return;
      }
      onSaved(saved);
    } catch (err) {
      setError(shownError(err));
      setBusy(false);
    }
  }

  if (revealed) {
    const done = () => (revealed.saved ? onSaved(revealed.saved) : setRevealed(null));
    return (
      <Dialog open onOpenChange={(open) => !open && done()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{revealed.saved ? `Added ${revealed.saved.name}` : 'New signing secret'}</DialogTitle>
            <DialogDescription>
              {revealed.saved
                ? 'Give the receiver this secret, so it can check that each call comes from Spooldoc.'
                : 'Give the receiver this secret. The old one no longer works.'}
            </DialogDescription>
          </DialogHeader>
          <RevealedSecret secret={revealed.secret} />
          <DialogFooter>
            <Button onClick={done}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className={kind === 'webhook' ? 'sm:max-w-xl' : 'sm:max-w-lg'}>
        <DialogHeader>
          <DialogTitle>{destination ? `Edit ${destination.name}` : 'New destination'}</DialogTitle>
          <DialogDescription>{DESCRIPTION[kind]}</DialogDescription>
        </DialogHeader>
        <form id="destination-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          {!destination && (
            <div role="radiogroup" aria-label="Kind of destination" className="grid gap-3 sm:grid-cols-3">
              <Choice selected={kind === 'ifs'} onSelect={() => setKind('ifs')} title="IFS folder">
                Write the files to a folder on the IBM i.
              </Choice>
              <Choice selected={kind === 'email'} onSelect={() => setKind('email')} title="Email">
                Send each document by email.
              </Choice>
              <Choice selected={kind === 'webhook'} onSelect={() => setKind('webhook')} title="Webhook">
                Send each document to a URL as JSON.
              </Choice>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="destination-name">Name</Label>
            <Input
              id="destination-name"
              name="name"
              required
              defaultValue={destination?.name ?? ''}
              placeholder={kind === 'ifs' ? 'Invoice folder' : kind === 'email' ? 'Invoices by email' : 'Order system'}
              autoComplete="off"
            />
          </div>
          {kind === 'ifs' ? (
            <IfsFields key="ifs" destination={destination?.kind === 'ifs' ? destination : null} />
          ) : kind === 'email' ? (
            <EmailFields key="email" destination={destination?.kind === 'email' ? destination : null} />
          ) : (
            <WebhookFields key="webhook" destination={destination?.kind === 'webhook' ? destination : null} headers={headers} onHeaders={setHeaders} />
          )}
          {destination?.kind === 'webhook' && (
            <div className="flex flex-col gap-1.5">
              <span className="font-medium text-sm">Signing secret</span>
              <div className="flex flex-wrap items-center gap-3">
                <Hint text="Makes a new secret and shows it once. The old secret stops working at once, so the receiver needs the new one.">
                  <Button type="button" variant="outline" size="sm" onClick={() => setConfirmRotate(true)} disabled={busy}>
                    Rotate secret
                  </Button>
                </Hint>
                <span className="text-muted-foreground text-xs">{destination.config.hasSecret ? 'Every call is signed.' : 'Calls are not signed. Rotate to make a secret.'}</span>
              </div>
            </div>
          )}
          {error && <ErrorNote detail={error.detail}>{error.message}</ErrorNote>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="destination-form" disabled={busy}>
            {busy && <Spinner />}
            {busy ? 'Saving...' : destination ? 'Save' : 'Add destination'}
          </Button>
        </DialogFooter>
      </DialogContent>
      <AlertDialog open={confirmRotate} onOpenChange={setConfirmRotate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate the signing secret?</AlertDialogTitle>
            <AlertDialogDescription>
              Spooldoc makes a new secret and shows it once. The old secret stops working at once: until the receiver has the new one, it refuses every call.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={rotate}>Rotate secret</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
