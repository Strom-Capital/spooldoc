'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useAppInfo } from '@/components/app-info';
import { Choice } from '@/components/jobs/inspectors';
import { ErrorNote } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { api, shownError, type ShownError } from '@/lib/client/api';
import { IF_EXISTS, IF_EXISTS_LABEL, type IfExists } from '@/lib/destination-config';
import type { DestinationView } from '@/lib/types';

/** A destination a user adds and changes: an IFS folder or email. */
export type EditableDestination = Extract<DestinationView, { kind: 'ifs' | 'email' }>;

type Kind = EditableDestination['kind'];

const DESCRIPTION: Record<Kind, string> = {
  ifs: 'Each run writes its files to a folder in the IFS. Spooldoc does not create the folder.',
  email: 'Each run sends one email per document, through the mail server in Settings. Each job sets To, Subject and the message.',
};

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
 * Add a destination (`destination` null), an IFS folder or email, or edit one. The kind
 * cannot be changed once saved. An IFS folder is on the server of each job that uses the
 * destination, so nothing is checked on the IBM i here.
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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '');
    const config =
      kind === 'ifs'
        ? { folder: value('folder'), ifExists: value('ifExists') as IfExists, keepCopy: value('keepCopy') === 'on' }
        : { testAddress: value('testAddress').trim() || null };
    setBusy(true);
    setError(null);
    try {
      const saved = destination
        ? await api<DestinationView>(`/api/destinations/${destination.id}`, { method: 'PATCH', body: { name: value('name'), config } })
        : await api<DestinationView>('/api/destinations', { method: 'POST', body: { kind, name: value('name'), config } });
      onSaved(saved);
    } catch (err) {
      setError(shownError(err));
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{destination ? `Edit ${destination.name}` : 'New destination'}</DialogTitle>
          <DialogDescription>{DESCRIPTION[kind]}</DialogDescription>
        </DialogHeader>
        <form id="destination-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          {!destination && (
            <div role="radiogroup" aria-label="Kind of destination" className="grid grid-cols-2 gap-3">
              <Choice selected={kind === 'ifs'} onSelect={() => setKind('ifs')} title="IFS folder">
                Write the files to a folder on the IBM i.
              </Choice>
              <Choice selected={kind === 'email'} onSelect={() => setKind('email')} title="Email">
                Send each document by email.
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
              placeholder={kind === 'ifs' ? 'Invoice folder' : 'Invoices by email'}
              autoComplete="off"
            />
          </div>
          {kind === 'ifs' ? (
            <IfsFields key="ifs" destination={destination?.kind === 'ifs' ? destination : null} />
          ) : (
            <EmailFields key="email" destination={destination?.kind === 'email' ? destination : null} />
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
    </Dialog>
  );
}
