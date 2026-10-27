import type { KeyValueArea } from './ports';

export const LINKS_KEY = 'links';

/**
 * Session-scoped bindings between browser ids and saved ids. Browser ids are only unique
 * within a browser session, so this lives in chrome.storage.session and is rebuilt by the
 * startup reconciler.
 */
export type Links = {
  /** windowId -> topicId */
  windows: Record<string, string>;
  /** tabId -> savedTabId */
  tabs: Record<string, string>;
  /** groupId -> sectionId */
  groups: Record<string, string>;
  /** Windows whose tabs are being closed with the window; their removals are not closes. */
  closing: number[];
  /** Set once the startup reconciler has run in this browser session. */
  reconciledAt: number | null;
  /**
   * topicId -> window it was linked to when deleted, so Undo can relink it. Session-scoped:
   * after a restart that window id may belong to an unrelated window.
   */
  deletedFrom: Record<string, number>;
};

export function emptyLinks(): Links {
  return { windows: {}, tabs: {}, groups: {}, closing: [], reconciledAt: null, deletedFrom: {} };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const strMap = (v: unknown): Record<string, string> =>
  isObj(v)
    ? Object.fromEntries(
        Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string'),
      )
    : {};

export function parseLinks(raw: unknown): Links {
  if (!isObj(raw)) return emptyLinks();
  return {
    windows: strMap(raw.windows),
    tabs: strMap(raw.tabs),
    groups: strMap(raw.groups),
    closing: Array.isArray(raw.closing)
      ? raw.closing.filter((n): n is number => typeof n === 'number')
      : [],
    reconciledAt: typeof raw.reconciledAt === 'number' ? raw.reconciledAt : null,
    deletedFrom: isObj(raw.deletedFrom)
      ? Object.fromEntries(
          Object.entries(raw.deletedFrom).filter(
            (e): e is [string, number] => typeof e[1] === 'number',
          ),
        )
      : {},
  };
}

export function windowForTopic(links: Links, topicId: string): number | null {
  for (const [w, t] of Object.entries(links.windows)) if (t === topicId) return Number(w);
  return null;
}

export function unbindWindow(links: Links, windowId: number, tabIds: number[] = []): Links {
  const windows = { ...links.windows };
  delete windows[String(windowId)];
  const tabs = { ...links.tabs };
  for (const id of tabIds) delete tabs[String(id)];
  return { ...links, windows, tabs, closing: links.closing.filter((w) => w !== windowId) };
}

export type LinkStore = {
  read(): Promise<Links>;
  write(links: Links): Promise<void>;
};

export function createLinkStore(kv: KeyValueArea): LinkStore {
  return {
    async read() {
      const { [LINKS_KEY]: raw } = await kv.get([LINKS_KEY]);
      return parseLinks(raw);
    },
    async write(links) {
      await kv.set({ [LINKS_KEY]: links });
    },
  };
}
