'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The parts of the app's code boxes: the webhook call, the SFTP connection check and the
 * SFTP folder. Each is `rounded-md border bg-background` in Geist Mono, with a header row
 * in the chrome font and 20 px rows.
 */

/** One token of a line, colored by what it is. */
export type Token = { text: string; kind?: 'key' | 'string' | 'number' | 'literal' | 'punct' | 'muted' | 'name' | 'ok' | 'bad' };
export type Line = { text: string; tokens: Token[]; title?: string; flashes?: boolean };

export const TOKEN_CLASS: Record<NonNullable<Token['kind']>, string> = {
  key: 'text-[var(--syntax-property)]',
  string: 'text-[var(--syntax-string)]',
  number: 'text-[var(--syntax-number)]',
  literal: 'text-[var(--syntax-keyword)]',
  punct: 'opacity-60',
  muted: 'italic opacity-60',
  name: 'opacity-70',
  ok: 'font-semibold text-emerald-700 dark:text-emerald-400',
  bad: 'font-semibold text-destructive',
};

/** A line of plain text. */
export const plain = (text: string): Line => ({ text, tokens: [{ text }] });

/**
 * One line with its number in the gutter, 20 px high as in the app's code views. A long
 * line wraps at any character onto more 20 px rows, with a hanging indent so a wrapped
 * value stays under its key; the number shows on its first row only.
 */
export function CodeLine({ line, number, gutter, flash }: { line: Line; number: number; gutter: string; flash?: boolean }) {
  const hang = `${(/^ */.exec(line.text)?.[0].length ?? 0) + 2}ch`;
  return (
    <div className="flex min-w-0">
      <span aria-hidden className="shrink-0 select-none pr-3 pl-2 text-right text-muted-foreground opacity-70" style={{ width: gutter }}>
        {number}
      </span>
      <div className="min-h-5 min-w-0 flex-1 whitespace-pre-wrap pr-3 [overflow-wrap:anywhere]" style={{ paddingLeft: hang, textIndent: `-${hang}` }} title={line.title}>
        <span className={cn(flash && 'flash')}>
          {line.tokens.map((token, index) => (
            <span key={index} className={token.kind && TOKEN_CLASS[token.kind]}>
              {token.text}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

/** The width of a gutter that fits numbers up to `last`, with its padding. */
export const gutterWidth = (last: number) => `calc(${String(last).length}ch + 1.25rem)`;

/** A header row of a box, in the chrome font: what is shown on the left, a size, a time or a button on the right. */
export function BoxHeader({ left, right, className }: { left: ReactNode; right: ReactNode; className?: string }) {
  return (
    <div className={cn('tabular flex min-h-8 items-center justify-between gap-3 border-b bg-muted/40 px-3 py-1 font-sans text-muted-foreground text-xs', className)}>
      <span className="min-w-0">{left}</span>
      <span className="shrink-0">{right}</span>
    </div>
  );
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** True when the reader asked for less motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (change) => {
      const query = window.matchMedia(REDUCED_MOTION);
      query.addEventListener('change', change);
      return () => query.removeEventListener('change', change);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}
