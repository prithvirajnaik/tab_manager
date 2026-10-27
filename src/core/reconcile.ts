import { RECENTLY_CLOSED_DAYS, type ClosedTab, type SavedTab, type Topic } from './model';
import type { LiveTab } from './ports';
import { isSaveable, toSavedTab } from './tabs';

const DAY = 86_400_000;

export type ReconcileOptions = {
  now: number;
  newId: () => string;
  ownNewTabUrl: string;
  /** Session links, tabId -> savedTabId. */
  tabLinks: Record<string, string>;
  /** Saved ids now open in another linked window: they moved, they were not closed. */
  elsewhere: Set<string>;
  /** Saved tabs of other topics, so a tab dragged in keeps its id and history. */
  foreign?: Map<string, SavedTab>;
  /** Maps a live group id to a section id of this topic, if any. */
  sectionForGroup?: (groupId: number) => string | undefined;
};

export type ReconcileResult = {
  topic: Topic;
  /** Links for the live tabs of this window. */
  tabLinks: Record<string, string>;
  /** Saved ids taken over from other topics (tabs dragged into this window). */
  adopted: string[];
  changed: boolean;
};

/**
 * Makes a topic match the live tabs of its window. Pure: the same inputs always give the
 * same topic. A saved tab missing from the window is never dropped: it moves to
 * recentlyClosed unless it is open in another linked window.
 */
export function reconcileTopic(
  topic: Topic,
  liveTabs: LiveTab[],
  opts: ReconcileOptions,
): ReconcileResult {
  const live = [...liveTabs]
    .sort((a, b) => a.index - b.index)
    .filter((t) => isSaveable(t.url, opts.ownNewTabUrl));
  const byId = new Map(topic.tabs.map((t) => [t.id, t]));
  const used = new Set<string>();
  const assigned = new Map<number, { id: string; previous?: SavedTab; foreign: boolean }>();

  // Pass 1: tabs we already know through session links.
  for (const t of live) {
    const savedId = opts.tabLinks[String(t.id)];
    if (!savedId || used.has(savedId)) continue;
    const own = byId.get(savedId);
    const foreign = own ? undefined : opts.foreign?.get(savedId);
    if (own || foreign) {
      used.add(savedId);
      assigned.set(t.id, { id: savedId, previous: own ?? foreign, foreign: !own });
    }
  }

  // Pass 2: unlinked tabs claim unclaimed saved tabs with the same URL, else become new.
  for (const t of live) {
    if (assigned.has(t.id)) continue;
    const match = topic.tabs.find(
      (s) => !used.has(s.id) && !opts.elsewhere.has(s.id) && s.url === t.url,
    );
    const id = match?.id ?? opts.newId();
    used.add(id);
    assigned.set(t.id, { id, previous: match, foreign: false });
  }

  const tabLinks: Record<string, string> = {};
  const adopted = [...assigned.values()].filter((a) => a.foreign).map((a) => a.id);
  const tabs = live.map((t) => {
    // Every live tab was assigned in pass 1 or 2.
    const a = assigned.get(t.id) ?? { id: opts.newId(), previous: undefined, foreign: false };
    tabLinks[String(t.id)] = a.id;
    const previous = a.foreign && a.previous ? { ...a.previous, sectionId: undefined } : a.previous;
    const saved = toSavedTab(t, a.id, opts.now, previous);
    const section = t.groupId >= 0 ? opts.sectionForGroup?.(t.groupId) : undefined;
    if (opts.sectionForGroup) {
      if (section) saved.sectionId = section;
      else delete saved.sectionId;
    }
    if (saved.sectionId === undefined) delete saved.sectionId;
    return saved;
  });

  const closed: ClosedTab[] = topic.tabs
    .filter((s) => !used.has(s.id) && !opts.elsewhere.has(s.id))
    .map((s) => ({ ...s, closedAt: opts.now }));
  const cutoff = opts.now - RECENTLY_CLOSED_DAYS * DAY;
  const recentlyClosed = [...closed, ...topic.recentlyClosed].filter((c) => c.closedAt >= cutoff);

  const changed =
    canonical(tabs) !== canonical(topic.tabs) ||
    recentlyClosed.length !== topic.recentlyClosed.length ||
    closed.length > 0;

  return {
    topic: changed ? { ...topic, tabs, recentlyClosed, updatedAt: opts.now } : topic,
    tabLinks,
    adopted,
    changed,
  };
}

/** JSON with sorted keys, so key order (ours vs. zod's) never reads as a change. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}
