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
