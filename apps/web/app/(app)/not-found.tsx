import { SearchXIcon } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { Page } from '@/components/page';
import { Button } from '@/components/ui/button';

/** A page or a record that does not exist, such as a deleted job, inside the app. */
export default function NotFound() {
  return (
    <Page title="Not found">
      <EmptyState icon={SearchXIcon} title="Nothing here" description="The page does not exist, or what it showed was deleted.">
        <Button asChild>
          <Link href="/">Go to Home</Link>
        </Button>
      </EmptyState>
    </Page>
  );
}
