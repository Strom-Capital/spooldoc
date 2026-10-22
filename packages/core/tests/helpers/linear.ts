import { expect } from "vitest";

/** The number of calls on a part of the input that one call on the whole input is timed against. */
const PARTS = 64;

/**
 * Options for a test that checks timing. The checks count CPU time, so a busy runner
 * only makes them slower on the clock.
 */
export const TIMING = { timeout: 30_000 };

/**
 * The CPU time of one run, in ms. Unlike the time on the clock, it leaves out the
 * time the test waits while other work on the runner has the CPU.
 */
function time(fn: () => unknown): number {
  const started = process.cpuUsage();
  fn();
  const { user, system } = process.cpuUsage(started);
  return (user + system) / 1000;
}

/**
 * Expects `fn` to take linear time in the size of its input, whatever the speed of the
 * machine. One call on the whole input, `input(n)`, is timed against 64 calls on a 64th
 * of it, so both do the same work: a linear search takes about as long either way, a
 * quadratic one 64 times as long on the whole input. It may take at most eight times
 * as long, which leaves noise room on both sides. Both inputs run once first, so
 * warming up does not count. The runs take turns and the shortest of each counts, so
 * garbage collection in one run does not count. Times under 1 ms count as 1 ms.
 */
export function linear<T>(input: (n: number) => T, fn: (input: T) => unknown, n: number): void {
  const part = Math.ceil(n / PARTS);
  const small = input(part);
  const large = input(part * PARTS);
  fn(small);
  fn(large);
  let whole = Infinity;
  let parts = Infinity;
  for (let run = 0; run < 5; run++) {
    whole = Math.min(whole, time(() => fn(large)));
    parts = Math.min(
      parts,
      time(() => {
        for (let call = 0; call < PARTS; call++) fn(small);
      }),
    );
  }
  expect(whole / Math.max(parts, 1)).toBeLessThan(8);
}
