'use client';

import { PlusIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { errorText } from '@/lib/client/api';
import { createJob } from '@/lib/client/jobs';

/** Creates a job (optionally reading from a queue) and opens it in the job builder. */
export function NewJobButton({
  source,
  label = 'New job',
  variant = 'default',
  size = 'default',
  onError,
}: {
  source?: { serverId: string; library: string; queue: string };
  label?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm';
  onError?(message: string): void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      router.push(`/jobs/${await createJob(source)}`);
    } catch (err) {
      setBusy(false);
      if (onError) onError(errorText(err));
      else setError(errorText(err));
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
      <Button variant={variant} size={size} onClick={onClick} disabled={busy}>
        {busy ? <Spinner /> : <PlusIcon />}
        {label}
      </Button>
    </span>
  );
}
