'use client';

import { PlusIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { errorText } from '@/lib/client/api';
import { createJob } from '@/lib/client/jobs';

export type NewJobSource = { serverId: string; library: string; queue: string };

/**
 * Creates a job (optionally reading from a queue) and opens it in the job builder.
 * `creating` is the source of the job being created, `{}` for one without, until the
 * builder opens. `create` returns the error text when it failed.
 */
export function useNewJob() {
  const router = useRouter();
  const [creating, setCreating] = useState<Partial<NewJobSource> | null>(null);
  const create = useCallback(
    async (source?: NewJobSource): Promise<string | null> => {
      setCreating(source ?? {});
      try {
        router.push(`/jobs/${await createJob(source)}`);
        return null;
      } catch (err) {
        setCreating(null);
        return errorText(err);
      }
    },
    [router],
  );
  return { create, creating };
}

/** A button that creates a job and opens it; it shows why when that fails. */
export function NewJobButton({
  source,
  label = 'New job',
  variant = 'default',
  size = 'default',
  onError,
}: {
  source?: NewJobSource;
  label?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm';
  onError?(message: string): void;
}) {
  const { create, creating } = useNewJob();
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    const failed = await create(source);
    if (failed) {
      if (onError) onError(failed);
      else setError(failed);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
      <Button variant={variant} size={size} onClick={onClick} disabled={creating !== null}>
        {creating ? <Spinner /> : <PlusIcon />}
        {label}
      </Button>
    </span>
  );
}
