'use client';

import { createContext, useContext, type ReactNode } from 'react';

/** What the pages need to know about the signed-in user and the server. */
export interface AppInfo {
  user: { id: string; email: string; name: string };
  /** The chat model, never its key. */
  model: { provider: string; id: string } | null;
  /** Values are masked before page text goes to the model (Settings, AI model). */
  masking: boolean;
  /** The last check found a working Carbone server, so documents can be rendered. */
  rendering: boolean;
}

const AppInfoContext = createContext<AppInfo | null>(null);

/** Hands the server's `AppInfo` to client components. */
export function AppInfoProvider({ value, children }: { value: AppInfo; children: ReactNode }) {
  return <AppInfoContext.Provider value={value}>{children}</AppInfoContext.Provider>;
}

/** The signed-in user, the model and whether Carbone works. */
export function useAppInfo(): AppInfo {
  const value = useContext(AppInfoContext);
  if (!value) {
    throw new Error('useAppInfo needs an AppInfoProvider');
  }
  return value;
}
