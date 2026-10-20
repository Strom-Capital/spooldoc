/** A date and time in the browser's locale, such as "18 Oct 2026, 14:05". */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '';
  }
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** How long ago, such as "5 min ago" or "3 days ago". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) {
    return '';
  }
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** A duration in ms as "820 ms" or "4.2 s". */
export function duration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

/** A byte size as "12 KB" or "1.4 MB". */
export function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** A spooled file as "SPDINVOICE #3, job 123456/USER/NAME". */
export function splfLabel(splf: { name: string; number: number; jobNumber: string; jobUser: string; jobName: string }): string {
  return `${splf.name} #${splf.number}, job ${splf.jobNumber}/${splf.jobUser}/${splf.jobName}`;
}

const COMPACT = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/** A token count, short: "840", "84K", "1.2M". */
export function tokenCount(n: number): string {
  return COMPACT.format(n);
}

/** US dollars: "$0.42", or "$0.0031" below a cent so a small cost does not read as nothing. */
export function usd(amount: number): string {
  const digits = amount > 0 && amount < 0.01 ? 4 : 2;
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: digits }).format(amount);
}

/** What `usageText` reads: the agent's `UsageTotals`. */
export interface UsageLike {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  costUsd: number | null;
  costPartial: boolean;
}

/**
 * Tokens and cost in a line, such as "1.2M tokens in (800K cached), 84K out, $0.42".
 * Cached and reasoning tokens show only when there are some. The cost shows only when
 * every step reported one; when only some did, the line says so instead of a total.
 */
export function usageText(usage: UsageLike): string {
  const input = `${tokenCount(usage.inputTokens)} tokens in${usage.cachedInputTokens > 0 ? ` (${tokenCount(usage.cachedInputTokens)} cached)` : ''}`;
  const output = `${tokenCount(usage.outputTokens)} out${usage.reasoningTokens > 0 ? ` (${tokenCount(usage.reasoningTokens)} reasoning)` : ''}`;
  const cost = usage.costUsd !== null ? `, ${usd(usage.costUsd)}` : usage.costPartial ? ', cost not reported for every step' : '';
  return `${input}, ${output}${cost}`;
}
