'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type SessionInfo } from '@/lib/client/api';

interface SessionState {
  /** Null until the first answer. */
  session: SessionInfo | null;
  refresh(): Promise<void>;
  disconnect(): Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

/** Holds `GET /api/session` for the shell and the pages. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSession(await api<SessionInfo>('/api/session'));
    } catch {
      setSession({ connected: false, model: null, masking: true, pdf: false });
    }
  }, []);

  const disconnect = useCallback(async () => {
    await api('/api/session', { method: 'DELETE' }).catch(() => undefined);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    api<SessionInfo>('/api/session').then(
      (info) => {
        if (!cancelled) setSession(info);
      },
      () => {
        if (!cancelled) setSession({ connected: false, model: null, masking: true, pdf: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return <SessionContext.Provider value={{ session, refresh, disconnect }}>{children}</SessionContext.Provider>;
}

/** The session info and actions. */
export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('useSession needs a SessionProvider');
  }
  return value;
}
