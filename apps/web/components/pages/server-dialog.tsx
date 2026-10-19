'use client';

import { useState, type FormEvent } from 'react';
import { ErrorNote } from '@/components/page';
import { TagInput } from '@/components/tag-input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { api, shownError, type ShownError } from '@/lib/client/api';
import type { ServerView } from '@/lib/types';

const selectClass =
  'h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30';

/**
 * Add a server (`server` null) or edit one. Saving signs on first, so a wrong password
 * or an unreachable host is reported here. When editing, an empty password keeps the
 * saved one, unless the host or user changes: the saved password is never sent elsewhere.
 */
export function ServerDialog({
  server,
  allowedHosts,
  onClose,
  onSaved,
}: {
  server: ServerView | null;
  allowedHosts: string[];
  onClose(): void;
  onSaved(server: ServerView): void;
}) {
  const [libraries, setLibraries] = useState<string[]>(server?.libraries ?? []);
  const [error, setError] = useState<ShownError | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '');
    const body: Record<string, unknown> = { name: value('name'), host: value('host'), user: value('user'), libraries };
    if (value('password') || !server) {
      body.password = value('password');
    }
    setBusy(true);
    setError(null);
    try {
      const saved = server
        ? await api<ServerView>(`/api/servers/${server.id}`, { method: 'PATCH', body })
        : await api<ServerView>('/api/servers', { method: 'POST', body });
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
          <DialogTitle>{server ? `Edit ${server.name}` : 'Add server'}</DialogTitle>
          <DialogDescription>Spooldoc signs on to check the details before it saves them.</DialogDescription>
        </DialogHeader>
        <form id="server-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="server-name">Name</Label>
            <Input id="server-name" name="name" required defaultValue={server?.name ?? ''} placeholder="Production" autoComplete="off" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="server-host">Host</Label>
            {allowedHosts.length > 0 ? (
              <select id="server-host" name="host" required defaultValue={server?.host ?? allowedHosts[0]} className={selectClass}>
                {allowedHosts.map((host) => (
                  <option key={host} value={host}>
                    {host}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id="server-host"
                name="host"
                required
                defaultValue={server?.host ?? ''}
                autoComplete="off"
                placeholder="ibmi.example.com"
                spellCheck={false}
              />
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="server-user">User profile</Label>
              <Input
                id="server-user"
                name="user"
                required
                defaultValue={server?.user ?? ''}
                autoComplete="off"
                maxLength={10}
                spellCheck={false}
                className="uppercase"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="server-password">Password</Label>
              <Input
                id="server-password"
                name="password"
                type="password"
                required={!server}
                autoComplete="new-password"
                placeholder={server ? 'Unchanged (enter it for a new host or user)' : undefined}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="server-libraries">
              Libraries <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <TagInput id="server-libraries" value={libraries} onChange={setLibraries} placeholder="All libraries. Type a name and press Enter." />
            <p className="text-muted-foreground text-xs">Only output queues in these libraries are listed. Leave it empty to list every library.</p>
          </div>
          {error && <ErrorNote detail={error.detail}>{error.message}</ErrorNote>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="server-form" disabled={busy}>
            {busy && <Spinner />}
            {busy ? 'Signing on...' : server ? 'Save' : 'Add server'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
