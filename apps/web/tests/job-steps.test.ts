import { describe, expect, it } from 'vitest';
import { STEP_TITLE, STEPS, stepAfter, stepBefore, type Step } from '@/lib/client/job-steps';

describe('job steps', () => {
  it('walks the pipeline from Source to Finish', () => {
    const walked = [STEPS[0]!];
    for (let next = stepAfter(walked[0]!); next; next = stepAfter(next)) walked.push(next);
    expect(walked).toEqual(['source', 'trigger', 'extract', 'lookups', 'render', 'destination', 'finish']);
  });

  it('walks back from Finish to Source', () => {
    const walked: Step[] = ['finish'];
    for (let back = stepBefore('finish'); back; back = stepBefore(back)) walked.unshift(back);
    expect(walked).toEqual([...STEPS]);
  });

  it('has nothing before Source or after Finish', () => {
    expect(stepBefore('source')).toBeNull();
    expect(stepAfter('finish')).toBeNull();
  });

  it('names every step', () => {
    expect(STEPS.map((step) => STEP_TITLE[step])).toEqual(['Source', 'Trigger', 'Extract', 'Lookups', 'Render', 'Destination', 'Finish']);
  });
});
