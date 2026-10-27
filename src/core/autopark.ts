import type { LiveTab } from './ports';
import { isSaveable } from './tabs';

const DAY = 86_400_000;

export type IdleRuleInput = {
  tabs: LiveTab[];
  now: number;
  /** Park tabs idle for at least this many days. */
  days: number;
  ownNewTabUrl: string;
  /** tabId -> lastActiveAt we recorded for the saved tab it is linked to. */
  savedActivity: Map<number, number>;
  /** Windows to leave alone (closing, or still being relinked after a restart). */
  skipWindows: Set<number>;
};

/**
 * The auto-park rule, as a pure function of live tabs and a clock. A tab is parked when it
 * has not been active for `days`. Never parked: pinned, active or audible tabs, new tab
 * pages, tabs whose URL cannot be saved, and tabs whose last activity is unknown.
 */
export function selectIdleTabs(input: IdleRuleInput): LiveTab[] {
  const cutoff = input.now - input.days * DAY;
  return input.tabs.filter((t) => {
    if (t.pinned || t.active || t.audible) return false;
    if (input.skipWindows.has(t.windowId)) return false;
    if (!isSaveable(t.url, input.ownNewTabUrl)) return false;
    const seen = Math.max(t.lastAccessed ?? 0, input.savedActivity.get(t.id) ?? 0);
    if (seen === 0) return false;
    return seen <= cutoff;
  });
}
