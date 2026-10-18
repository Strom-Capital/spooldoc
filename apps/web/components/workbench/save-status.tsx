'use client';

import { useJob } from '@/components/jobs/job-provider';
import { Spinner } from '@/components/ui/spinner';

/** "Saved", "Saving..." or the save error, or "Read-only" when a version is shown. */
export function SaveStatus() {
  const { saveState, saveError, readOnly, viewing } = useJob();
  if (readOnly) {
    return <span>v{viewing}, read-only</span>;
  }
  if (saveState === 'saving') {
    return (
      <span className="inline-flex items-center gap-1">
        <Spinner className="size-3" /> Saving...
      </span>
    );
  }
  if (saveState === 'error') {
    return <span className="text-destructive" title={saveError ?? undefined}>Not saved: {saveError}</span>;
  }
  return <span>Saved to the draft</span>;
}
