import type { Command, CommandResponse } from '../core/messages';
import { migrate } from '../core/migrations';
import type { Store } from '../core/model';
import { LINKS_KEY, parseLinks } from '../core/links';
import { STORE_KEY } from '../core/repo';

/** What the new tab page needs from the extension. Injected so components test without chrome. */
export type Api = {
  send(command: Command): Promise<CommandResponse>;
  /** `onLinks` fires when windows are linked or unlinked. */
  subscribe(onStore: (load: LoadResult) => void, onLinks?: () => void): () => void;
  favicon(pageUrl: string): string;
  /** The topic linked to the window this page is in, from session links. */
  currentTopicId(): Promise<string | null>;
  /** Saves text as a file in the user's downloads. */
  download(filename: string, text: string): void;
  /** The stored data exactly as it is, for the "cannot be read" screen. */
  rawStore(): Promise<string>;
};

export type LoadResult = { ok: true; store: Store } | { ok: false; error: string };

export function parseStore(raw: unknown): LoadResult {
  try {
    return { ok: true, store: migrate(raw) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The page's single storage read before first render. */
export async function loadStore(): Promise<LoadResult> {
  const { [STORE_KEY]: raw } = await chrome.storage.local.get(STORE_KEY);
  return parseStore(raw);
}

let faviconBase: string | undefined;

export const chromeApi: Api = {
  async send(command) {
    try {
      const res = (await chrome.runtime.sendMessage(command)) as CommandResponse | undefined;
      return res ?? { ok: false, error: 'The extension did not respond.' };
    } catch {
      return { ok: false, error: 'The extension did not respond. Try reloading this page.' };
    }
  },
  subscribe(onStore, onLinks) {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const change = changes[STORE_KEY];
      if (area === 'local' && change) onStore(parseStore(change.newValue));
      if (area === 'session' && changes[LINKS_KEY]) onLinks?.();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  },
  favicon(pageUrl) {
    // The browser's favicon cache: no network requests from this page.
    faviconBase ??= chrome.runtime.getURL('/_favicon/');
    return `${faviconBase}?${new URLSearchParams({ pageUrl, size: '32' }).toString()}`;
  },
  download(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
  async rawStore() {
    const all = await chrome.storage.local.get(null);
    return JSON.stringify(all, null, 2);
  },
  async currentTopicId() {
    try {
      const [win, stored] = await Promise.all([
        chrome.windows.getCurrent(),
        chrome.storage.session.get(LINKS_KEY),
      ]);
      if (win.id === undefined) return null;
      return parseLinks(stored[LINKS_KEY]).windows[String(win.id)] ?? null;
    } catch {
      return null;
    }
  },
};
