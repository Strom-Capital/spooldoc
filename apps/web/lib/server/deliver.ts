import 'server-only';

import type { EmailSpec, JobSpec, WebhookSpec } from '@/lib/job-spec';
import type { RunStep } from './db/schema';
import { storeRunFiles } from './destinations/store';
import type { DeliverInput, FoundDestination, RunDocument, RunFile } from './destinations';
import { StepError } from './step-error';

/** Where some of a run's documents go: a destination, with the job's email or webhook part for it. */
export interface DeliveryTarget {
  /** The route that sends the documents here; null when the job has no routes. */
  route: number | null;
  destinationId: string;
  email: EmailSpec | null;
  webhook: WebhookSpec | null;
  /** The documents this destination delivers, in the run's order. */
  documents: RunDocument[];
}

/** A target with its destination row, looked up before the render. */
export interface FoundTarget extends DeliveryTarget {
  destination: Promise<FoundDestination | null>;
}

/** Runs one deliver step of a run, recorded with the destination it delivers to. */
export type DeliverStep = (destination: RunStep['destination'], deliver: () => Promise<string>) => Promise<string>;

/** What every target's delivery shares: the run, its files, the job and the connection. */
export type DeliverBase = Omit<DeliverInput, 'files' | 'documents' | 'keepFiles' | 'destinationId' | 'route' | 'email' | 'webhook'> & {
  /** Every file of the run. */
  files: RunFile[];
  step: DeliverStep;
};

/** Where a run's documents go: every document to the job's destination. */
export function deliveryTargets(spec: JobSpec, documents: RunDocument[]): DeliveryTarget[] {
  const { destinationId, email, webhook } = spec.destination;
  return [{ route: null, destinationId: destinationId ?? '', email, webhook, documents }];
}

/** "1 more destination failed", "2 more destinations failed". */
const moreFailed = (n: number): string => `${n} more ${n === 1 ? 'destination' : 'destinations'} failed`;

/**
 * Deliver a run to each target, one after another, with a deliver step each. A target gets
 * only the files of its documents. A file is stored in Spooldoc once, when the first
 * destination that keeps files keeps it. A target that fails does not stop the next: when
 * all are done and any failed, the first failure is thrown, with how many more there are.
 *
 * @throws StepError when any target failed
 */
export async function deliverAll(targets: FoundTarget[], base: DeliverBase): Promise<void> {
  const { step, files, ...shared } = base;
  const stored = new Set<string>();
  const keepFiles = async (keep: RunFile[]) => {
    const fresh = keep.filter((file) => !stored.has(file.name));
    // Remembered before the write: a second call while the first stores them must not store them again.
    for (const file of fresh) stored.add(file.name);
    try {
      await storeRunFiles(shared.runId, fresh);
    } catch (err) {
      for (const file of fresh) stored.delete(file.name);
      throw err;
    }
  };

  const failures: unknown[] = [];
  for (const target of targets) {
    let found: FoundDestination | null = null;
    let lookupError: unknown = null;
    try {
      found = await target.destination;
    } catch (err) {
      lookupError = err;
    }
    const indexes = new Set(target.documents.map((document) => document.pageGroupIndex));
    try {
      await step(found ? { id: found.id, name: found.name, kind: found.kind } : undefined, async () => {
        if (lookupError) throw lookupError;
        if (!found) throw new Error('The destination is gone.');
        return found.open().deliver({
          ...shared,
          files: files.filter((file) => indexes.has(file.pageGroupIndex)),
          documents: target.documents,
          keepFiles,
          destinationId: target.destinationId,
          route: target.route,
          email: target.email,
          webhook: target.webhook,
        });
      });
    } catch (err) {
      failures.push(err);
    }
  }

  if (failures.length === 0) return;
  const first = failures[0];
  const message = first instanceof Error ? first.message : String(first);
  const detail = first instanceof StepError ? first.detail : undefined;
  const more = failures.length > 1 ? ` ${moreFailed(failures.length - 1)}. The Deliver steps say why.` : '';
  throw new StepError('deliver', `${message}${more}`, detail);
}
