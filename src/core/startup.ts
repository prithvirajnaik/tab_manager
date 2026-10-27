import { RECENTLY_CLOSED_DAYS, TRASH_DAYS, type Store, type Topic } from './model';

const DAY = 86_400_000;

/**
 * A window counts as a topic's restored window when its URL set is nearly the same
 * (Jaccard >= 0.8), or clearly overlapping (>= 0.5) with at least two shared URLs. One shared
 * URL out of two is not enough: a fresh window with one common site would match.
 */
export const STRONG_MATCH = 0.8;
export const MATCH_THRESHOLD = 0.5;
export const MIN_SHARED = 2;

export type WindowUrls = { windowId: number; urls: string[] };

function similarity(a: Set<string>, b: Set<string>): { score: number; shared: number } {
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  const union = a.size + b.size - shared;
  return { score: union === 0 ? 0 : shared / union, shared };
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
      const { score, shared } = similarity(urls, new Set(t.tabs.map((s) => s.url)));
      if (score >= STRONG_MATCH || (score >= MATCH_THRESHOLD && shared >= MIN_SHARED)) {
        pairs.push({ windowId: w.windowId, topicId: t.id, score });
      }
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
