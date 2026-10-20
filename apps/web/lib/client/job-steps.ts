/** A pipeline step of the job builder. */
export type Step = 'source' | 'trigger' | 'extract' | 'render' | 'destination' | 'finish';

/** The steps in pipeline order. */
export const STEPS: readonly Step[] = ['source', 'trigger', 'extract', 'render', 'destination', 'finish'];

/** The name of each step, as the pipeline and the Back and Next buttons show it. */
export const STEP_TITLE: Record<Step, string> = {
  source: 'Source',
  trigger: 'Trigger',
  extract: 'Extract',
  render: 'Render',
  destination: 'Destination',
  finish: 'Finish',
};

/** The step after `step`, or null after Finish. */
export function stepAfter(step: Step): Step | null {
  return STEPS[STEPS.indexOf(step) + 1] ?? null;
}

/** The step before `step`, or null before Source. */
export function stepBefore(step: Step): Step | null {
  const index = STEPS.indexOf(step);
  return index > 0 ? STEPS[index - 1]! : null;
}
