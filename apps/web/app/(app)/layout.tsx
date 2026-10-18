import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppInfoProvider } from '@/components/app-info';
import { AppShell } from '@/components/app-shell';
import { currentUser } from '@/lib/server/auth';
import { getConfig } from '@/lib/server/config';
import { describeModel } from '@/lib/server/models';
import { pdfAvailable } from '@/lib/server/pdf';

export const dynamic = 'force-dynamic';

/** Every page but the login: the sidebar, and a signed-in user or a redirect to /login. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  if (!user) {
    redirect('/login');
  }
  // The sidebar starts as an icon rail until the user expands it (the sidebar keeps the choice in this cookie).
  const sidebarOpen = (await cookies()).get('sidebar_state')?.value === 'true';
  const info = { user, model: describeModel(), masking: getConfig().mask, pdf: await pdfAvailable() };
  return (
    <AppInfoProvider value={info}>
      <AppShell sidebarOpen={sidebarOpen}>{children}</AppShell>
    </AppInfoProvider>
  );
}
