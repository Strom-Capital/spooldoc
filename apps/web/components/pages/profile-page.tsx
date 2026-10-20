'use client';

import { KeyRoundIcon, SaveIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useAppInfo } from '@/components/app-info';
import { ErrorNote, Page } from '@/components/page';
import { ThemePicker } from '@/components/theme-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { accountErrorText, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, newPasswordProblem } from '@/lib/account';
import { authClient } from '@/lib/client/auth';

/** The name, saved with Better Auth, and the email, which cannot be changed here. */
function NameSection() {
  const router = useRouter();
  const { user } = useAppInfo();
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.updateUser({ name: trimmed });
      if (result.error) {
        setError(accountErrorText('save the name', result.error));
        return;
      }
      setName(trimmed);
      toast.success(`Saved the name ${trimmed}`);
      // The layout hands the user's name to the app.
      router.refresh();
    } catch (err) {
      setError(accountErrorText('save the name', err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border p-5">
      <h2 className="font-semibold">Name</h2>
      <p className="mt-0.5 mb-5 text-muted-foreground text-sm">How you are shown in the app. You sign in with your email.</p>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-name">Name</Label>
          <Input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} required autoComplete="name" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-email">Email</Label>
          <Input id="profile-email" type="email" value={user.email} readOnly className="bg-muted" />
          <p className="text-muted-foreground text-xs">Your email cannot be changed here.</p>
        </div>
      </div>
      {error && <ErrorNote className="mt-5">{error}</ErrorNote>}
      <Button type="submit" className="mt-5" disabled={busy || !trimmed || trimmed === user.name}>
        {busy ? <Spinner /> : <SaveIcon />}
        Save
      </Button>
    </form>
  );
}

/** The current password and a new one. Other sessions are signed out when it changes. */
function PasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = newPasswordProblem(next);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
      if (result.error) {
        setError(accountErrorText('change the password', result.error));
        return;
      }
      setCurrent('');
      setNext('');
      toast.success('Changed the password', { description: 'Your other sessions were signed out. This one stays signed in.' });
    } catch (err) {
      setError(accountErrorText('change the password', err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border p-5">
      <h2 className="font-semibold">Password</h2>
      <p className="mt-0.5 mb-5 text-muted-foreground text-sm">
        Changing the password signs you out everywhere else, such as on another computer or browser.
      </p>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="current-password">Current password</Label>
          <Input
            id="current-password"
            type="password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_LENGTH}
            autoComplete="new-password"
          />
          <p className="text-muted-foreground text-xs">At least {MIN_PASSWORD_LENGTH} characters.</p>
        </div>
      </div>
      {error && <ErrorNote className="mt-5">{error}</ErrorNote>}
      <Button type="submit" className="mt-5" disabled={busy || !current || !next}>
        {busy ? <Spinner /> : <KeyRoundIcon />}
        Change password
      </Button>
    </form>
  );
}

/** The signed-in user's name, password and theme. */
export function ProfilePage() {
  return (
    <Page title="Profile" description="Your name, password and theme." className="max-w-3xl">
      <div className="flex flex-col gap-6">
        <NameSection />
        <PasswordSection />
        <section className="rounded-lg border p-5">
          <h2 className="font-semibold">Theme</h2>
          <p className="mt-0.5 mb-5 text-muted-foreground text-sm">
            System follows your computer&apos;s light or dark setting. The choice is kept in this browser.
          </p>
          <ThemePicker />
        </section>
      </div>
    </Page>
  );
}
