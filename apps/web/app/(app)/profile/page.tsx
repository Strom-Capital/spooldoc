import type { Metadata } from 'next';
import { ProfilePage } from '@/components/pages/profile-page';

export const metadata: Metadata = { title: 'Profile' };

/** The signed-in user's name, password and theme. */
export default function Page() {
  return <ProfilePage />;
}
