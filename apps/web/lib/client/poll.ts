/**
 * Call `fn` every `ms` while the tab is visible, and once more when it becomes visible
 * again, so a page left open in a background tab does not keep asking the server.
 *
 * @param fn - What to run, such as fetching the list again
 * @param ms - The interval
 * @returns The function that stops it, for an effect's cleanup
 */
export function pollWhileVisible(fn: () => void, ms: number): () => void {
  const visible = () => document.visibilityState === 'visible';
  const timer = setInterval(() => {
    if (visible()) fn();
  }, ms);
  const onChange = () => {
    if (visible()) fn();
  };
  document.addEventListener('visibilitychange', onChange);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onChange);
  };
}
