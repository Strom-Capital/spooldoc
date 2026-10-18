import { redirect } from 'next/navigation';

/** The first page is the server list. */
export default function Home() {
  redirect('/servers');
}
