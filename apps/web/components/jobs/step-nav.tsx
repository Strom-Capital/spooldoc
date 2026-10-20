'use client';

import { ChevronLeftIcon, ChevronRightIcon, SaveIcon } from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { STEP_TITLE, stepAfter, stepBefore, type Step } from '@/lib/client/job-steps';
import { nextVariant, type ForwardVariant } from '@/lib/client/step-status';
import { useJob } from './job-provider';
import { useStepStatuses } from './use-step-statuses';

interface StepNavState {
  /** Open the step, and give it the focus when it opens. */
  go(step: Step): void;
  /** Whether Back or Next opened the step that asks, once: the next call says false. */
  arrived(): boolean;
  /** Open Save version. */
  onSaveVersion(): void;
}

const StepNavContext = createContext<StepNavState | null>(null);

/** Back and Next for the steps, and Save version, which the job builder owns. */
export function StepNavProvider({ onSaveVersion, children }: { onSaveVersion(): void; children: ReactNode }) {
  const { setStep } = useJob();
  // Set when Back or Next changed the step, so the new step takes the focus.
  const moved = useRef(false);
  const value = useMemo<StepNavState>(
    () => ({
      go(step) {
        moved.current = true;
        setStep(step);
      },
      arrived() {
        const was = moved.current;
        moved.current = false;
        return was;
      },
      onSaveVersion,
    }),
    [setStep, onSaveVersion],
  );
  return <StepNavContext.Provider value={value}>{children}</StepNavContext.Provider>;
}

function useStepNav(): StepNavState {
  const context = useContext(StepNavContext);
  if (!context) throw new Error('useStepNav must be used inside StepNavProvider');
  return context;
}

/**
 * Focus `ref` when Back or Next opened this step, so the keyboard focus does not fall
 * back to the page when the button that had it goes away.
 */
export function useFocusOnArrival(ref: RefObject<HTMLElement | null>) {
  const { arrived } = useStepNav();
  useEffect(() => {
    if (arrived()) ref.current?.focus();
  }, [arrived, ref]);
}

/** How Next looks on the open step: primary when the step is ready and the pipeline is not. */
function useNextVariant(): ForwardVariant {
  const { step } = useJob();
  const { statuses, ready } = useStepStatuses();
  return nextVariant(statuses[step], ready);
}

/**
 * Back and Next at the end of a form step. On Finish, Next is Save version while the
 * draft has changes that no active version has. Save version looks as Next would, so it
 * is never primary next to a primary Run now.
 */
export function StepFooter() {
  const { step, job, viewing, draftDiffers } = useJob();
  const { go, onSaveVersion } = useStepNav();
  const variant = useNextVariant();
  const before = stepBefore(step);
  const after = stepAfter(step);
  const unsaved = viewing === 'draft' && (job.activeVersion === null || draftDiffers);
  return (
    <div className="flex items-center gap-2 border-t pt-4">
      {before && (
        <Button variant="ghost" size="sm" onClick={() => go(before)} title={`Back to ${STEP_TITLE[before]}`}>
          <ChevronLeftIcon />
          Back
        </Button>
      )}
      <div className="ml-auto">
        {after ? (
          <Button size="sm" variant={variant} onClick={() => go(after)}>
            Next: {STEP_TITLE[after]}
            <ChevronRightIcon />
          </Button>
        ) : (
          unsaved && (
            <Button size="sm" variant={variant} onClick={onSaveVersion}>
              <SaveIcon />
              Save version
            </Button>
          )
        )}
      </div>
    </div>
  );
}

/** Next in the header of Extract and Render, which fill the height and have no footer. */
export function NextStepButton() {
  const { step } = useJob();
  const { go } = useStepNav();
  const variant = useNextVariant();
  const ref = useRef<HTMLButtonElement>(null);
  useFocusOnArrival(ref);
  const after = stepAfter(step);
  if (!after) return null;
  return (
    <Button ref={ref} size="sm" variant={variant} className="ml-auto shrink-0" onClick={() => go(after)}>
      Next: {STEP_TITLE[after]}
      <ChevronRightIcon />
    </Button>
  );
}
