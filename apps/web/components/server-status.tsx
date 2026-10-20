'use client';

import { CheckCircle2Icon, CircleAlertIcon, CircleDashedIcon, RefreshCwIcon, RotateCcwIcon, XCircleIcon, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorNote } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText, type ShownError } from '@/lib/client/api';
import { ago } from '@/lib/client/format';
import type { ServerView } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The state of the connection to a server, one word each wherever it shows. */
export type ServerState = 'connected' | 'unchecked' | 'connecting' | 'unreachable' | 'signOnFailed';

type StateFields = Pick<ServerView, 'lastError' | 'errorCode' | 'errorSince' | 'lastCheckedAt' | 'vrm' | 'ccsid'>;

/**
 * The state of a server's connection from what was last recorded: a sign-on error is
 * "Sign-on failed", any other error "Cannot reach", and a server never reached "Not checked".
 */
export function serverState(server: Pick<ServerView, 'lastError' | 'errorCode' | 'lastCheckedAt'>, connecting = false): ServerState {
  if (connecting) return 'connecting';
  if (server.lastError) return server.errorCode === 'auth' ? 'signOnFailed' : 'unreachable';
  return server.lastCheckedAt ? 'connected' : 'unchecked';
}

const STATES: Record<ServerState, { word: string; icon: LucideIcon | null; color: string }> = {
  connected: { word: 'Connected', icon: CheckCircle2Icon, color: 'text-emerald-600 dark:text-emerald-400' },
  unchecked: { word: 'Not checked', icon: CircleDashedIcon, color: 'text-muted-foreground' },
  connecting: { word: 'Connecting...', icon: null, color: 'text-muted-foreground' },
  unreachable: { word: 'Cannot reach', icon: CircleAlertIcon, color: 'text-amber-700 dark:text-amber-400' },
  signOnFailed: { word: 'Sign-on failed', icon: XCircleIcon, color: 'text-destructive' },
};

/** The word for a state, such as "Cannot reach". */
export function stateWord(state: ServerState): string {
  return STATES[state].word;
}

/** What Spooldoc does next about a server it cannot use. */
const NEXT: Partial<Record<ServerState, string>> = {
  unreachable: 'Spooldoc tries again by itself.',
  signOnFailed: 'Spooldoc does not sign on again until you edit the password or press Reconnect, so the user profile is not disabled.',
};

/** "10:42" for a time today, else "18 Oct, 10:42", in the browser's locale. */
export function sinceTime(iso: string): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return at.toDateString() === new Date().toDateString() ? time : `${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}

/** The icon of a state, in its colour; a spinner while connecting. */
export function ServerStateIcon({ state, className }: { state: ServerState; className?: string }) {
  const { icon: Icon, color } = STATES[state];
  if (!Icon) return <Spinner className={cn('shrink-0', color, className)} aria-hidden />;
  return <Icon className={cn('size-4 shrink-0', color, className)} aria-hidden />;
}

/**
 * The connection state of a server: Connected, Not checked, Connecting..., Cannot reach
 * or Sign-on failed. `full` adds the system, when it was checked, why it fails and what
 * Spooldoc does next; `inline` is the icon and the word, with since when it fails;
 * `icon` is the icon, with the word for screen readers.
 */
export function ServerStatus({
  server,
  connecting = false,
  variant = 'full',
  className,
}: {
  server: StateFields;
  connecting?: boolean;
  variant?: 'full' | 'inline' | 'icon';
  className?: string;
}) {
  const state = serverState(server, connecting);
  const { word } = STATES[state];
  const since = server.errorSince && (state === 'unreachable' || state === 'signOnFailed') ? ` since ${sinceTime(server.errorSince)}` : '';

  if (variant === 'icon') {
    return (
      <span className={cn('inline-flex', className)}>
        <ServerStateIcon state={state} />
        <span className="sr-only">{word}</span>
      </span>
    );
  }
  if (variant === 'inline') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-sm', className)}>
        <ServerStateIcon state={state} />
        <span>
          {word}
          {since}
        </span>
      </span>
    );
  }
  return (
    <div className={cn('flex max-w-sm items-start gap-1.5', className)}>
      <ServerStateIcon state={state} className="mt-0.5" />
      <div className="min-w-0">
        <div>
          {word}
          {since}
          {state === 'connected' && (server.vrm || server.ccsid) && (
            <span className="text-muted-foreground">
              {server.vrm ? `, ${server.vrm}` : ''}
              {server.ccsid ? `, CCSID ${server.ccsid}` : ''}
            </span>
          )}
        </div>
        {server.lastError && state !== 'connecting' && <p className="mt-0.5 break-words text-xs">{server.lastError}</p>}
        {NEXT[state] && <p className="mt-0.5 text-muted-foreground text-xs">{NEXT[state]}</p>}
        {state === 'connected' && server.lastCheckedAt && <p className="mt-0.5 text-muted-foreground text-xs">Checked {ago(server.lastCheckedAt)}</p>}
      </div>
    </div>
  );
}

/**
 * Reconnect to a server: sign on again from scratch, record the result and say it in a
 * toast. `pending` is the id of the server being reconnected.
 *
 * @param onDone - Gets the server as it is now, or null when Reconnect failed
 */
export function useReconnect(onDone?: (server: ServerView | null) => void): {
  reconnect(server: { id: string; name: string }): Promise<void>;
  pending: string | null;
} {
  const [pending, setPending] = useState<string | null>(null);
  async function reconnect(server: { id: string; name: string }): Promise<void> {
    setPending(server.id);
    let view: ServerView | null = null;
    try {
      view = await api<ServerView>(`/api/servers/${server.id}/reconnect`, { method: 'POST' });
      toast.success(`Connected to ${view.name}`);
    } catch (err) {
      // The error is also recorded on the server, where its status shows it.
      toast.error(`Could not connect to ${server.name}`, { description: errorText(err) });
    } finally {
      setPending(null);
    }
    onDone?.(view);
  }
  return { reconnect, pending };
}

/** The Reconnect button for one server. */
export function ReconnectButton({
  server,
  onDone,
  variant = 'outline',
}: {
  server: { id: string; name: string };
  onDone?(server: ServerView | null): void;
  variant?: 'outline' | 'ghost';
}) {
  const { reconnect, pending } = useReconnect(onDone);
  return (
    <Button variant={variant} size="sm" onClick={() => void reconnect(server)} disabled={pending !== null}>
      {pending ? <Spinner /> : <RefreshCwIcon />}
      Reconnect
    </Button>
  );
}

/**
 * An `ErrorNote` for a failed call to a server. When the server cannot be reached or the
 * sign-on failed, it offers Reconnect, and loads again once that works; for any other
 * error, Try again loads again.
 */
export function ServerErrorNote({
  error,
  server,
  onRetry,
  className,
}: {
  error: ShownError;
  server: { id: string; name: string } | null;
  onRetry(): void;
  className?: string;
}) {
  const reconnect = server && (error.code === 'host' || error.code === 'auth');
  return (
    <ErrorNote
      className={className}
      detail={error.detail}
      action={
        reconnect ? (
          <ReconnectButton server={server} onDone={(view) => view && onRetry()} />
        ) : (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCcwIcon />
            Try again
          </Button>
        )
      }
    >
      {error.message}
    </ErrorNote>
  );
}
