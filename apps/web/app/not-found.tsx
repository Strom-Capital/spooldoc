import Link from 'next/link';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';

/** An address that matches no page. Outside the app layout, so it shows without signing in. */
export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <Logo />
      <h1 className="font-semibold text-xl">Page not found</h1>
      <p className="max-w-sm text-muted-foreground text-sm">There is no page at this address.</p>
      <Button asChild>
        <Link href="/">Go to Home</Link>
      </Button>
    </main>
  );
}
