import type { RunStep } from './db/schema';

/** A run step that failed, with a message for the Job log and the system's own text. */
export class StepError extends Error {
  constructor(
    readonly step: RunStep['step'],
    message: string,
    /** The system's own text, such as Carbone's or the IBM i's, kept for support. */
    readonly detail?: string,
  ) {
    super(message);
  }
}
