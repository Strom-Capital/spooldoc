'use client';

import { XIcon } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';

/**
 * A list of short names: type one and press Enter or comma; Backspace in the empty box
 * removes the last one. Names are upper-cased, as IBM i names are.
 */
export function TagInput({
  id,
  value,
  onChange,
  placeholder,
  maxLength = 10,
}: {
  id?: string;
  value: string[];
  onChange(next: string[]): void;
  placeholder?: string;
  maxLength?: number;
}) {
  const [text, setText] = useState('');

  function commit(raw: string) {
    const names = raw
      .split(/[\s,]+/)
      .map((name) => name.trim().toUpperCase())
      .filter(Boolean);
    if (names.length > 0) {
      onChange([...new Set([...value, ...names])]);
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
          <button
            type="button"
            onClick={() => onChange(value.filter((other) => other !== name))}
            className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
            aria-label={`Remove ${name}`}
          >
            <XIcon className="size-3" />
          </button>
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
        className="h-6 min-w-24 flex-1 bg-transparent px-1 font-mono text-sm uppercase outline-none placeholder:font-sans placeholder:normal-case placeholder:text-muted-foreground"
      />
    </div>
  );
}
