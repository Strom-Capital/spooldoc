'use client';

import { XIcon } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { Hint } from '@/components/hint';
import { cn } from '@/lib/utils';

/**
 * A list of short names: type one and press Enter or comma; Backspace in the empty box
 * removes the last one. Names are upper-cased, as IBM i names are. With `text`, they are
 * values as typed, which may hold spaces, and only Enter and comma end one. With `max`,
 * no more are taken once there are that many.
 */
export function TagInput({
  id,
  value,
  onChange,
  placeholder,
  maxLength = 10,
  text: plain = false,
  max,
  disabled,
  label,
}: {
  id?: string;
  value: string[];
  onChange(next: string[]): void;
  placeholder?: string;
  maxLength?: number;
  text?: boolean;
  max?: number;
  disabled?: boolean;
  /** The input's accessible name, when no label points at `id`. */
  label?: string;
}) {
  const [text, setText] = useState('');
  const full = max !== undefined && value.length >= max;

  function commit(raw: string) {
    const names = raw
      .split(plain ? /,/ : /[\s,]+/)
      .map((name) => (plain ? name.trim() : name.trim().toUpperCase()))
      .filter(Boolean);
    if (names.length > 0) {
      const next = [...new Set([...value, ...names])];
      onChange(max === undefined ? next : next.slice(0, max));
    }
    setText('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit(text);
    } else if (event.key === 'Backspace' && text === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
      {value.map((name) => (
        <span key={name} className="inline-flex items-center gap-0.5 rounded-md bg-muted py-0.5 pr-0.5 pl-1.5 font-mono text-xs">
          {name}
          <Hint text={`Remove ${name}`}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(value.filter((other) => other !== name))}
              className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
              aria-label={`Remove ${name}`}
            >
              <XIcon className="size-3" />
            </button>
          </Hint>
        </span>
      ))}
      <input
        id={id}
        value={text}
        onChange={(event) => setText(event.target.value.slice(0, maxLength))}
        onKeyDown={onKeyDown}
        onBlur={() => commit(text)}
        placeholder={value.length === 0 ? placeholder : undefined}
        spellCheck={false}
        disabled={disabled || full}
        aria-label={label}
        className={cn(
          'h-6 min-w-24 flex-1 bg-transparent px-1 font-mono text-sm outline-none placeholder:font-sans placeholder:normal-case placeholder:text-muted-foreground disabled:cursor-not-allowed',
          !plain && 'uppercase',
        )}
      />
    </div>
  );
}
