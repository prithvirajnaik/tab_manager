import {
  SECTION_COLORS,
  type ClosedTab,
  type ParkedTab,
  type SectionColor,
  type Settings,
  type Store,
  type Topic,
} from '../core/model';
import { normalize } from '../core/search';
import { plural } from './format';

/**
 * Everything the page shows is derived here from the store, so no component adds up
 * arrays or invents numbers of its own.
 */

export type Counts = {
  topics: number;
  tabs: number;
  open: number;
  recentlyClosed: number;
  parked: number;
};

export function counts(store: Store): Counts {
  let tabs = 0;
  let open = 0;
  let recentlyClosed = 0;
  let parked = store.unsortedParked.length;
  for (const t of store.topics) {
    tabs += t.tabs.length;
    if (t.windowId !== null) open += 1;
    recentlyClosed += t.recentlyClosed.length;
    parked += t.parked.length;
  }
  return { topics: store.topics.length, tabs, open, recentlyClosed, parked };
}

/** A reminder shows when nothing was exported for this long. */
export const REMIND_AFTER_MS = 14 * 86_400_000;

export type BackupStatus =
  { kind: 'none' } | { kind: 'never' } | { kind: 'ok'; at: number } | { kind: 'stale'; at: number };

/** Local data is lost on a profile reset, so the page says how recent the last export is. */
export function backupStatus(
  lastExportAt: number | null,
  hasTopics: boolean,
  now: number,
): BackupStatus {
  if (!hasTopics) return { kind: 'none' };
  if (lastExportAt === null) return { kind: 'never' };
  return now - lastExportAt > REMIND_AFTER_MS
    ? { kind: 'stale', at: lastExportAt }
    : { kind: 'ok', at: lastExportAt };
}

/** Tabs of one topic; `topicId` is null for tabs parked from windows without a topic. */
export type TabGroup<T, Id extends string | null = string | null> = {
  topicId: Id;
  name: string;
  tabs: T[];
};

/** Recently closed tabs of every topic, newest first, topics ordered by their latest close. */
export function allRecentlyClosed(store: Store): TabGroup<ClosedTab, string>[] {
  return store.topics
    .filter((t) => t.recentlyClosed.length > 0)
    .map((t) => ({
      topicId: t.id,
      name: t.name,
      tabs: [...t.recentlyClosed].sort((a, b) => b.closedAt - a.closedAt),
    }))
    .sort((a, b) => (b.tabs[0]?.closedAt ?? 0) - (a.tabs[0]?.closedAt ?? 0));
}

/** Parked tabs by topic, in topic order, then the ones parked from windows without a topic. */
export function allParked(store: Store): TabGroup<ParkedTab>[] {
  const groups: TabGroup<ParkedTab>[] = store.topics
    .filter((t) => t.parked.length > 0)
    .map((t) => ({ topicId: t.id, name: t.name, tabs: t.parked }));
  if (store.unsortedParked.length > 0) {
    groups.push({ topicId: null, name: 'No topic', tabs: store.unsortedParked });
  }
  return groups;
}

export const SORTS = ['created', 'name', 'updated', 'tabs'] as const;
export type SortKey = (typeof SORTS)[number];

export const SORT_LABELS: Record<SortKey, string> = {
  created: 'Created',
  name: 'Name',
  updated: 'Last updated',
  tabs: 'Most tabs',
};

/** Sorts whose order changes while you browse; the page freezes them, so cards never jump. */
export const LIVE_SORTS: ReadonlySet<SortKey> = new Set(['updated', 'tabs']);

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** The store keeps topics in creation order, so "created" is the order as stored. */
export function sortTopics(topics: Topic[], key: SortKey): Topic[] {
  switch (key) {
    case 'created':
      return topics;
    case 'name':
      return [...topics].sort((a, b) => collator.compare(a.name, b.name));
    case 'updated':
      return [...topics].sort((a, b) => b.updatedAt - a.updatedAt);
    case 'tabs':
      return [...topics].sort((a, b) => b.tabs.length - a.tabs.length);
  }
}

/**
 * Puts topics in a previously computed order. Topics the order does not know yet (just
 * saved or imported) come first; removed ones are dropped.
 */
export function applyOrder(topics: Topic[], ids: string[]): Topic[] {
  const rank = new Map(ids.map((id, i) => [id, i]));
  const known = topics.filter((t) => rank.has(t.id));
  known.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return [...topics.filter((t) => !rank.has(t.id)), ...known];
}

/**
 * A stable colour per topic, from the tab group palette. Hashed from the id, not the name,
 * so renaming keeps the colour. Grey is left out: it reads as disabled.
 */
const ACCENTS = SECTION_COLORS.filter((c) => c !== 'grey');

export function topicAccent(id: string): SectionColor {
  // FNV-1a, 32-bit, then MurmurHash3's finaliser: FNV alone leaves the low bits that the
  // modulo below reads poorly mixed, so short ids landed on the same colour.
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ACCENTS[(h >>> 0) % ACCENTS.length] ?? 'blue';
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The first character as a reader sees it, so "日本語" gives 日 and an emoji stays whole. */
export function monogram(name: string): string {
  for (const { segment } of segmenter.segment(name.trim())) return segment.toLocaleUpperCase();
  return '?';
}

/** Topics whose name contains every word of the query, ignoring case and Latin accents. */
export function matchTopics(topics: Topic[], query: string): Topic[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return topics.filter((t) => {
    const name = normalize(t.name);
    return tokens.every((token) => name.includes(token));
  });
}

/** One line describing what auto-park does with the current settings. */
export function autoParkSummary(settings: Settings): string {
  switch (settings.autoParkMode) {
    case 'on':
      return `Auto-park is on: tabs idle for ${plural(settings.autoParkDays, 'day')} are parked.`;
    case 'dry-run':
      return 'Auto-park is set to preview only, so nothing is parked automatically.';
    case 'off':
      return 'Auto-park is off.';
  }
}

export type Site = {
  /** The host without "www.", or the protocol for pages that have none (file:, about:). */
  key: string;
  /** The first tab's URL, which the favicon is looked up with. */
  url: string;
  count: number;
};

function siteKey(url: string): string {
  try {
    const { host, protocol } = new URL(url);
    return (host || protocol).replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** One entry per website, most tabs first; sites with the same count keep their tab order. */
export function uniqueSites(tabs: { url: string }[]): Site[] {
  const sites = new Map<string, Site>();
  for (const { url } of tabs) {
    const key = siteKey(url);
    const site = sites.get(key);
    if (site) site.count += 1;
    else sites.set(key, { key, url, count: 1 });
  }
  return [...sites.values()].sort((a, b) => b.count - a.count);
}

/** Mac keyboards use ⌘ where others use Ctrl. */
export function isMac(platform: string): boolean {
  return /mac|iphone|ipad/i.test(platform);
}
