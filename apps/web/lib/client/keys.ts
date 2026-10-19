/**
 * A keyboard shortcut as the platform writes it: ⌘B on a Mac, Ctrl+B elsewhere. Call it
 * only in the browser, such as in a tooltip's content.
 *
 * @param key - The key pressed with the modifier
 */
export function shortcut(key: string): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return mac ? `⌘${key}` : `Ctrl+${key}`;
}
