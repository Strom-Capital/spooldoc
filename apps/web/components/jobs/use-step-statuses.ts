'use client';

import { useMemo } from 'react';
import { useAppInfo } from '@/components/app-info';
import { useWorkbench } from '@/components/workbench/workbench-provider';
import type { Step } from '@/lib/client/job-steps';
import { allReady, stepStatuses, type StepStatus } from '@/lib/client/step-status';
import { useJob } from './job-provider';

/**
 * The status of each step, from the spec, the job and the latest workbench render, and
 * whether every step is ready. The pipeline shows them; Next and Run now follow them.
 * Use it inside the job builder, which has the job and the workbench around it.
 */
export function useStepStatuses(): { statuses: Record<Step, StepStatus>; ready: boolean } {
  const { spec, job, servers, destinations } = useJob();
  const { render } = useWorkbench();
  const { rendering } = useAppInfo();
  const serverError = servers.find((s) => s.id === spec.source.serverId)?.lastError ?? null;
  const destination = destinations.find((d) => d.id === spec.destination.destinationId);
  // An email destination is set once the job says where each email goes.
  const hasDestination = !!destination && (destination.kind !== 'email' || !!spec.destination.email?.to.trim());
  return useMemo(() => {
    const statuses = stepStatuses({ spec, job, serverError, hasDestination, render, rendering });
    return { statuses, ready: allReady(statuses) };
  }, [spec, job, serverError, hasDestination, render, rendering]);
}
