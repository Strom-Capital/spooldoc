'use client';

import { useState, type FormEvent } from 'react';
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

type IfsDestination = Extract<DestinationView, { kind: 'ifs' }>;

/**
 * Add an IFS destination (`destination` null) or edit one. The folder is on the server of
 * each job that uses the destination, so nothing is checked on the IBM i here.
 */
export function DestinationDialog({
  destination,
  onClose,
  onSaved,
}: {
  destination: IfsDestination | null;
  onClose(): void;
  onSaved(destination: DestinationView): void;
}) {
  const [ifExists, setIfExists] = useState<IfExists>(destination?.config.ifExists ?? 'replace');
  const [keepCopy, setKeepCopy] = useState(destination?.config.keepCopy ?? true);
  const [error, setError] = useState<ShownError | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '');
    const config = { folder: value('folder'), ifExists, keepCopy };
    setBusy(true);
    setError(null);
    try {
      const saved = destination
        ? await api<DestinationView>(`/api/destinations/${destination.id}`, { method: 'PATCH', body: { name: value('name'), config } })
        : await api<DestinationView>('/api/destinations', { method: 'POST', body: { kind: 'ifs', name: value('name'), config } });
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
          <DialogTitle>{destination ? `Edit ${destination.name}` : 'New IFS destination'}</DialogTitle>
          <DialogDescription>Each run writes its files to a folder in the IFS. Spooldoc does not create the folder.</DialogDescription>
        </DialogHeader>
        <form id="destination-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="destination-name">Name</Label>
            <Input id="destination-name" name="name" required defaultValue={destination?.name ?? ''} placeholder="Invoice folder" autoComplete="off" />
          </div>
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
            <Checkbox id="destination-keep-copy" checked={keepCopy} onCheckedChange={(checked) => setKeepCopy(checked === true)} className="mt-0.5" />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="destination-keep-copy" className="font-normal">
                Keep a copy in Spooldoc
              </Label>
              <p className="text-muted-foreground text-xs">The files can then be downloaded from the Job log, even when the write fails.</p>
            </div>
          </div>
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
