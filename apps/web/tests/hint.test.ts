import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Hint, isDisabled } from '@/components/hint';
import { TooltipProvider } from '@/components/ui/tooltip';

/** The markup of a hint around a button, as the server renders it. */
function render(text: string | undefined, button: { disabled?: boolean }): string {
  const props = { text } as Parameters<typeof Hint>[0];
  const hint: ReactElement = createElement(Hint, props, createElement('button', { type: 'button', ...button }, 'Upload template'));
  return renderToStaticMarkup(createElement(TooltipProvider, null, hint));
}

describe('Hint', () => {
  it('puts the hint on the button itself', () => {
    const html = render('Choose a file.', {});
    expect(html).toMatch(/^<button[^>]*data-state="closed"/);
    expect(html).not.toContain('tabindex');
  });

  it('puts a disabled button in a focusable span, so its hint can still show', () => {
    const html = render('Wait for the file to finish.', { disabled: true });
    expect(html).toMatch(/^<span tabindex="0"[^>]*data-state="closed"[^>]*><button[^>]*disabled/);
  });

  it('adds no span and no tab stop without text', () => {
    const html = render(undefined, { disabled: true });
    expect(html).toMatch(/^<button/);
    expect(html).not.toContain('tabindex');
  });

  it('tells a disabled control from an enabled one', () => {
    expect(isDisabled(createElement('button', { disabled: true }))).toBe(true);
    expect(isDisabled(createElement('button', { disabled: false }))).toBe(false);
    expect(isDisabled(createElement('button'))).toBe(false);
    expect(isDisabled('text')).toBe(false);
  });
});
