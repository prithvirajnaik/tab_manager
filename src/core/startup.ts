import { RECENTLY_CLOSED_DAYS, TRASH_DAYS, type Store, type Topic } from './model';

const DAY = 86_400_000;

/** Minimum Jaccard similarity of URL sets for a window to count as a topic's window. */
export const MATCH_THRESHOLD = 0.5;

export type WindowUrls = { windowId: number; urls: string[] };

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * After a browser restart window ids are new, so topics that were open are matched to the
 * restored windows by URL similarity. Greedy on the best score; each side is used once.
 */
export function matchWindows(topics: Topic[], windows: WindowUrls[]): Map<number, string> {
  const candidates = topics.filter((t) => t.windowId !== null && t.tabs.length > 0);
  const pairs: { windowId: number; topicId: string; score: number }[] = [];
  for (const w of windows) {
    const urls = new Set(w.urls);
    for (const t of candidates) {
      const score = jaccard(urls, new Set(t.tabs.map((s) => s.url)));
      if (score >= MATCH_THRESHOLD) pairs.push({ windowId: w.windowId, topicId: t.id, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const result = new Map<number, string>();
  const usedTopics = new Set<string>();
  for (const p of pairs) {
    if (result.has(p.windowId) || usedTopics.has(p.topicId)) continue;
    result.set(p.windowId, p.topicId);
    usedTopics.add(p.topicId);
  }
  return result;
}

/** Drops Recently closed entries and trash older than 30 days. Parked tabs never expire. */
export function pruneExpired(store: Store, now: number): Store {
  const closedCutoff = now - RECENTLY_CLOSED_DAYS * DAY;
  const trashCutoff = now - TRASH_DAYS * DAY;
  let changed = false;
  const topics = store.topics.map((t) => {
    const recentlyClosed = t.recentlyClosed.filter((c) => c.closedAt >= closedCutoff);
    if (recentlyClosed.length === t.recentlyClosed.length) return t;
    changed = true;
    return { ...t, recentlyClosed };
  });
  const trash = store.trash.filter((e) => e.deletedAt >= trashCutoff);
  if (trash.length !== store.trash.length) changed = true;
  return changed ? { ...store, topics, trash } : store;
}
