import { MAX_TITLE_LENGTH, MAX_URL_LENGTH, isOpenableUrl, type SavedTab } from './model';
import type { LiveTab } from './ports';

const BLANK_PAGES = new Set([
  '',
  'about:blank',
  'chrome://newtab/',
  'brave://newtab/',
  'chrome://new-tab-page/',
  'edge://newtab/',
]);

/**
 * Whether a live tab is worth saving. New tab pages (including this extension's own) and
 * URLs with blocked schemes are skipped.
 */
export function isSaveable(url: string, ownNewTabUrl: string): boolean {
  if (BLANK_PAGES.has(url)) return false;
  if (ownNewTabUrl && url.startsWith(ownNewTabUrl)) return false;
  return isOpenableUrl(url);
}

export function toSavedTab(live: LiveTab, id: string, now: number, previous?: SavedTab): SavedTab {
  const tab: SavedTab = {
    id,
    url: live.url,
    title: (live.title || previous?.title || live.url).slice(0, MAX_TITLE_LENGTH),
    pinned: live.pinned,
    lastActiveAt: Math.max(
      previous?.lastActiveAt ?? 0,
      live.lastAccessed ?? 0,
      live.active ? now : 0,
    ),
  };
  // Favicons are rendered from the browser's cache, so an oversized one is not worth keeping.
  const favIconUrl = live.favIconUrl || previous?.favIconUrl;
  if (favIconUrl && favIconUrl.length <= MAX_URL_LENGTH) tab.favIconUrl = favIconUrl;
  if (previous?.sectionId) tab.sectionId = previous.sectionId;
  if (previous?.openerTabId) tab.openerTabId = previous.openerTabId;
  if (tab.lastActiveAt === 0) tab.lastActiveAt = now;
  return tab;
}

/** Pinned tabs first (the browser enforces this), otherwise saved order. */
export function openOrder<T extends { pinned: boolean }>(tabs: T[]): T[] {
  return [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
}
