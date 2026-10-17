'use client';

import type { KeyboardEvent } from 'react';

/**
 * A plain monospace textarea. Tab inserts two spaces; Shift+Tab moves focus on.
 * CodeMirror can replace it later.
 */
export function CodeEditor({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Tab' || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
      return;
    }
    event.preventDefault();
    const el = event.currentTarget;
    const { selectionStart, selectionEnd } = el;
    const next = `${el.value.slice(0, selectionStart)}  ${el.value.slice(selectionEnd)}`;
    onChange(next);
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = selectionStart + 2;
    });
  }

  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      aria-label={label}
      placeholder={placeholder}
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      autoCorrect="off"
      wrap="off"
      className="h-full min-h-0 w-full flex-1 resize-none bg-background p-3 font-mono text-xs leading-5 outline-none"
    />
  );
}
