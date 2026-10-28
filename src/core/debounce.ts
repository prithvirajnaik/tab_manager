/**
 * Collapses bursts of calls into one, `ms` after the last, but never later than `maxWait`
 * after the first, so a page that keeps changing its title cannot hold syncing off. The
 * pending timer is the only in-memory state, and losing it is harmless: the next event, the
 * new tab page or the maintenance alarm triggers the same idempotent sync.
 */
export function debounce(fn: () => void, ms: number, maxWait = Infinity): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let first: number | undefined;
  const fire = () => {
    clearTimeout(timer);
    timer = undefined;
    first = undefined;
    fn();
  };
  return () => {
    const now = Date.now();
    first ??= now;
    clearTimeout(timer);
    timer = setTimeout(fire, Math.max(0, Math.min(ms, first + maxWait - now)));
  };
}
