'use client';

import { isValidElement, useState, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Whether a child is a disabled control, which gets no pointer or focus events of its own. */
export function isDisabled(child: ReactNode): boolean {
  return isValidElement<{ disabled?: unknown }>(child) && !!child.props.disabled;
}

/**
 * A short explanation on a control: what it does, what it changes, or why it is disabled.
 * It shows when the pointer rests on the control and when the control has keyboard focus.
 * A disabled control sits in a focusable span, so the hint still says why it is disabled.
 * Without `text`, nothing shows, so a hint can come and go with the control's state.
 *
 * @param text - One or two short sentences
 * @param side - Where the hint shows, above the control by default
 * @param children - One control, such as a `Button`, that takes a ref and props
 */
export function Hint({
  text,
  side,
  children,
}: {
  text: ReactNode;
  side?: ComponentProps<typeof TooltipContent>['side'];
  children: ReactElement;
}) {
  const empty = text === undefined || text === null || text === false || text === '';
  const disabled = !empty && isDisabled(children);
  const [open, setOpen] = useState(false);
  // Without text it stays a tooltip that never opens, so the control keeps its place in the tree and its focus.
  return (
    <Tooltip open={open && !empty} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        {disabled ? (
          // In a button group the span takes the button's place, so the button takes the span's corners.
          <span
            tabIndex={0}
            className="inline-flex rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50 in-data-[slot=button-group]:[&>*]:rounded-[inherit]! in-data-[slot=button-group]:not-first:[&>*]:border-l-0"
          >
            {children}
          </span>
        ) : (
          children
        )}
      </TooltipTrigger>
      {!empty && (
        <TooltipContent side={side} className="max-w-72 text-pretty">
          {text}
        </TooltipContent>
      )}
    </Tooltip>
  );
}
