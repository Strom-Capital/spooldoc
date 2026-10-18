import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * The horizontal Spooldoc logo (public/brand/spooldoc-horizontal-*.svg) drawn inline,
 * so the wordmark uses the Montserrat 600 loaded by the page and the ink follows the
 * theme through `currentColor`. The folded corner keeps the brand accent.
 *
 * @param mark - Draw only the mark, cropped square, for the collapsed sidebar
 */
export function Logo({ className, mark = false }: { className?: string; mark?: boolean }) {
  const mask = `perforations-${useId().replace(/:/g, '')}`;
  return (
    <svg
      viewBox={mark ? '18 8 84 84' : '0 0 455 104'}
      role="img"
      aria-label="Spooldoc"
      className={cn('w-auto text-foreground', className)}
    >
      <g transform="translate(16 8) scale(0.68)">
        <defs>
          <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="128" height="128">
            <rect width="128" height="128" fill="white" />
            <circle cx="17" cy="44" r="3.8" fill="black" />
            <circle cx="18" cy="59" r="3.8" fill="black" />
            <circle cx="19" cy="74" r="3.8" fill="black" />
            <circle cx="21" cy="89" r="3.8" fill="black" />
          </mask>
        </defs>
        <g fill="currentColor">
          <path d="M 9,32 L 21,32 C 25,48 24,77 31,95 C 35,105 43,109 51,111 L 34,111 C 18,109 14,97 12,80 Z" mask={`url(#${mask})`} />
          <path d="M 27,24 L 41,24 C 44,44 41,79 48,92 C 51,99 57,102 66,104 L 48,104 C 32,102 30,91 29,72 Z" />
          <path d="M 45,16 L 61,16 L 61,83 C 61,94 67,98 77,99 L 61,99 C 46,98 45,88 45,74 Z" />
          <path d="M 65,8 L 95,8 L 120,33 L 120,95 L 79,95 C 70,95 65,90 65,81 Z" />
        </g>
        <path fill="#3159E8" d="M 98,9 L 119,30 L 100,30 Q 98,30 98,27 Z" />
      </g>
      {!mark && (
        <text
          x="112"
          y="83"
          fill="currentColor"
          fontFamily="var(--font-montserrat), Montserrat, sans-serif"
          fontSize="64"
          fontWeight="600"
          letterSpacing="-2.8"
        >
          Spooldoc
        </text>
      )}
    </svg>
  );
}
