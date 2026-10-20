/**
 * The statuses of a spooled file, as `QSYS2.OUTPUT_QUEUE_ENTRIES` returns them, with
 * the word and the tone the app shows for each. The common ones come first.
 */
export const SPOOLED_FILE_STATUSES = [
  'READY',
  'HELD',
  'OPEN',
  'SAVED',
  'WRITING',
  'PENDING',
  'PRINTING',
  'SENDING',
  'MESSAGE',
  'DEFERRED',
  'CLOSED',
  'FINISHED',
] as const;

export type SpooledFileStatus = (typeof SPOOLED_FILE_STATUSES)[number];

/**
 * - `ready`: a job picks it up.
 * - `held`: waits until it is released, or a job that takes held files picks it up.
 * - `busy`: still being written, or a printer or writer is working on it.
 * - `message`: waits for a reply to a message.
 * - `neutral`: done, kept, or a status Spooldoc does not know.
 */
export type SpooledFileTone = 'ready' | 'held' | 'busy' | 'message' | 'neutral';

const TONE: Record<SpooledFileStatus, SpooledFileTone> = {
  READY: 'ready',
  HELD: 'held',
  OPEN: 'busy',
  WRITING: 'busy',
  PENDING: 'busy',
  PRINTING: 'busy',
  SENDING: 'busy',
  MESSAGE: 'message',
  SAVED: 'neutral',
  DEFERRED: 'neutral',
  CLOSED: 'neutral',
  FINISHED: 'neutral',
};

const isKnown = (status: string): status is SpooledFileStatus => Object.hasOwn(TONE, status);

/** The tone of a status; one Spooldoc does not know is neutral. */
export function spooledFileTone(status: string): SpooledFileTone {
  const upper = status.trim().toUpperCase();
  return isKnown(upper) ? TONE[upper] : 'neutral';
}

/** A status as a word in sentence case, "Ready" for READY. One Spooldoc does not know shows as it came. */
export function spooledFileStatusLabel(status: string): string {
  const upper = status.trim().toUpperCase();
  return isKnown(upper) ? upper[0] + upper.slice(1).toLowerCase() : status.trim() || 'Unknown';
}

/** What the Status filter button says: "Status", one word, two words, or a count. */
export function statusFilterLabel(selected: readonly string[]): string {
  if (selected.length === 0 || selected.length === SPOOLED_FILE_STATUSES.length) return 'Status';
  if (selected.length <= 2) return orderStatuses(selected).map(spooledFileStatusLabel).join(', ');
  return `${selected.length} statuses`;
}

/** The statuses in the order the filter lists them. */
export function orderStatuses(selected: readonly string[]): string[] {
  const rank = (status: string) => {
    const at = SPOOLED_FILE_STATUSES.indexOf(status as SpooledFileStatus);
    return at === -1 ? SPOOLED_FILE_STATUSES.length : at;
  };
  return [...selected].sort((a, b) => rank(a) - rank(b));
}

/**
 * The `status` query value for the files API, such as `READY,HELD`. Nothing picked, or
 * every status picked, means any status: no value.
 */
export function statusParam(selected: readonly string[]): string | undefined {
  if (selected.length === 0 || selected.length >= SPOOLED_FILE_STATUSES.length) return undefined;
  return orderStatuses(selected).join(',');
}
