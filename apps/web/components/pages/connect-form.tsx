'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText } from '@/lib/client/api';

/** Host, user, password and an optional library; POSTs `/api/session`. */
export function ConnectForm({ allowedHosts }: { allowedHosts: string[] }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '');
    setBusy(true);
    setError(null);
    try {
      await api('/api/session', {
        method: 'POST',
        body: { host: value('host'), user: value('user'), password: value('password'), library: value('library') },
      });
      // A full page load: the router may hold a /queues prefetched before sign-on, which redirected to /connect.
      window.location.assign(new URL('/queues', window.location.href));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="host">Host</Label>
        {allowedHosts.length > 0 ? (
          <select
            id="host"
            name="host"
            required
            defaultValue={allowedHosts[0]}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          >
            {allowedHosts.map((host) => (
              <option key={host} value={host}>
                {host}
              </option>
            ))}
          </select>
        ) : (
          <Input id="host" name="host" required autoComplete="off" placeholder="ibmi.example.com" spellCheck={false} />
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="user">User profile</Label>
        <Input id="user" name="user" required autoComplete="username" maxLength={10} spellCheck={false} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required autoComplete="current-password" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="library">
          Library <span className="font-normal text-muted-foreground">(optional, filters the queue list)</span>
        </Label>
        <Input id="library" name="library" maxLength={10} placeholder="MYLIB" spellCheck={false} className="uppercase placeholder:normal-case" />
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy} className="mt-2">
        {busy && <Spinner />}
        {busy ? 'Connecting...' : 'Connect'}
      </Button>
    </form>
  );
}
