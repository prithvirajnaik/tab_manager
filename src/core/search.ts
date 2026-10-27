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

/** Lowercase, without diacritics, so "jishō" finds "Jisho". */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
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
export function searchTabs(store: Store, query: string, limit = 100): SearchResult[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const results: SearchResult[] = [];
  for (const topic of store.topics) {
    for (const list of ['tabs', 'parked', 'recentlyClosed'] as const) {
      for (const tab of topic[list]) {
        const title = normalize(tab.title);
        const words = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        const url = normalize(tab.url);
        const host = normalize(hostOf(tab.url));
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
          results.push({
            topicId: topic.id,
            topicName: topic.name,
            list,
            tab,
            score: score * LIST_WEIGHT[list],
          });
        }
      }
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
