import type { SavedTab, Store } from './model';

export type TabList = 'tabs' | 'parked' | 'recentlyClosed';

export type SearchResult = {
  topicId: string;
  topicName: string;
  list: TabList;
  tab: SavedTab;
  score: number;
};

const LIST_WEIGHT: Record<TabList, number> = { tabs: 1, parked: 0.8, recentlyClosed: 0.6 };

/**
 * Lowercase, without Latin diacritics, so "jishō" finds "Jisho". Only U+0300 to U+036F are
 * folded: other scripts' marks (Japanese voicing, Devanagari vowels) change meaning.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLowerCase();
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function tokenScore(
  token: string,
  title: string,
  words: string[],
  host: string,
  url: string,
): number {
  if (words.some((w) => w.startsWith(token))) return 3;
  if (title.includes(token)) return 2;
  if (host.includes(token)) return 1.5;
  if (url.includes(token)) return 1;
  return 0;
}

/**
 * Searches every topic's tabs, parked and recently closed tabs by title and URL. Every word
 * must match; title word starts rank highest, then title, host, and anywhere in the URL.
 */
type Entry = {
  topicId: string;
  topicName: string;
  list: TabList;
  tab: SavedTab;
  title: string;
  words: string[];
  url: string;
  host: string;
};

/** Normalised text for every tab, built once per store so each keystroke only compares. */
export type SearchIndex = Entry[];

export function buildIndex(store: Store): SearchIndex {
  const entries: Entry[] = [];
  for (const topic of store.topics) {
    for (const list of ['tabs', 'parked', 'recentlyClosed'] as const) {
      for (const tab of topic[list]) {
        const title = normalize(tab.title);
        entries.push({
          topicId: topic.id,
          topicName: topic.name,
          list,
          tab,
          title,
          words: title.split(/[^\p{L}\p{N}]+/u).filter(Boolean),
          url: normalize(tab.url),
          host: normalize(hostOf(tab.url)),
        });
      }
    }
  }
  return entries;
}

export function searchTabs(
  source: Store | SearchIndex,
  query: string,
  limit = 100,
): SearchResult[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const index = Array.isArray(source) ? source : buildIndex(source);
  const results: SearchResult[] = [];
  for (const { topicId, topicName, list, tab, title, words, url, host } of index) {
    {
      {
        let score = 0;
        for (const token of tokens) {
          const s = tokenScore(token, title, words, host, url);
          if (s === 0) {
            score = 0;
            break;
          }
          score += s;
        }
        if (score > 0) {
          results.push({ topicId, topicName, list, tab, score: score * LIST_WEIGHT[list] });
        }
      }
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
