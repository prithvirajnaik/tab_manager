/**
 * Collapses bursts of calls into one, `ms` after the last. The pending timer is the only
 * in-memory state, and losing it is harmless: the next event, the new tab page or the
 * maintenance alarm triggers the same idempotent sync.
 */
export function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn();
    }, ms);
  };
}
