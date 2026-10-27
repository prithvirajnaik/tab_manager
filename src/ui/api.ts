import type { Command, CommandResponse } from '../core/messages';
import { migrate } from '../core/migrations';
import type { Store } from '../core/model';
import { STORE_KEY } from '../core/repo';

/** What the new tab page needs from the extension. Injected so components test without chrome. */
export type Api = {
  send(command: Command): Promise<CommandResponse>;
  subscribe(onStore: (load: LoadResult) => void): () => void;
  favicon(pageUrl: string): string;
  currentWindowId(): Promise<number | null>;
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
  subscribe(onStore) {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const change = changes[STORE_KEY];
      if (area === 'local' && change) onStore(parseStore(change.newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  },
  favicon(pageUrl) {
    // The browser's favicon cache: no network requests from this page.
    faviconBase ??= chrome.runtime.getURL('/_favicon/');
    return `${faviconBase}?${new URLSearchParams({ pageUrl, size: '32' }).toString()}`;
  },
  async currentWindowId() {
    try {
      const win = await chrome.windows.getCurrent();
      return win.id ?? null;
    } catch {
      return null;
    }
  },
};
