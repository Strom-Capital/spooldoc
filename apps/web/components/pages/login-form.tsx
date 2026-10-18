'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { authClient } from '@/lib/client/auth';

/** Email and password; with `firstRun`, also a name, and it creates the account. */
export function LoginForm({ firstRun, next }: { firstRun: boolean; next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '');
    setBusy(true);
    setError(null);
    const result = firstRun
      ? await authClient.signUp.email({ name: value('name'), email: value('email'), password: value('password') })
      : await authClient.signIn.email({ email: value('email'), password: value('password') });
    if (result.error) {
      setError(result.error.message ?? 'Sign-in failed.');
      setBusy(false);
      return;
    }
    // A full page load, so nothing the router fetched while signed out is reused.
    window.location.assign(new URL(next, window.location.href));
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {firstRun && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required autoComplete="name" />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={firstRun ? 10 : undefined}
          autoComplete={firstRun ? 'new-password' : 'current-password'}
        />
        {firstRun && <p className="text-muted-foreground text-xs">At least 10 characters.</p>}
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy} className="mt-2">
        {busy && <Spinner />}
        {firstRun ? 'Create account' : 'Sign in'}
      </Button>
    </form>
  );
}
