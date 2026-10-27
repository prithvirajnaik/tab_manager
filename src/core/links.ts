import type { KeyValueArea } from './ports';

export const LINKS_KEY = 'links';

/** A window flagged as closing is ignored by syncs for at most this long (a close can be cancelled). */
export const CLOSING_TTL_MS = 10_000;

/** Tabs a sync moved to Recently closed this recently are put back if their window turns out to be closing. */
export const REVERT_WINDOW_MS = 5_000;

/** Tabs one sync moved to Recently closed, kept briefly so a window close can undo it. */
export type RecentClose = {
  windowId: number;
  topicId: string;
  ids: string[];
  /** Saved tab order before the sync, to put them back where they were. */
  order: string[];
  at: number;
};

/**
 * Session-scoped bindings between browser ids and saved ids. Browser ids are only unique
 * within a browser session, so this lives in chrome.storage.session and is rebuilt by the
 * startup reconciler.
 */
export type Links = {
  /** windowId -> topicId */
  windows: Record<string, string>;
  /** tabId -> savedTabId, including tabs briefly in unlinked windows (mid-drag). */
  tabs: Record<string, string>;
  /** groupId -> sectionId */
  groups: Record<string, string>;
  /** windowId -> when its tabs started closing with it; their removals are not closes. */
  closing: Record<string, number>;
  /** Windows just relinked after a restart: their first sync adds tabs but closes none. */
  merging: number[];
  recentCloses: RecentClose[];
  /** Set once the startup reconciler has run in this browser session. */
  reconciledAt: number | null;
  /** Set once the relink grace period is over and stale topics were marked closed. */
  relinkDone: boolean;
  /**
   * topicId -> window it was linked to when deleted, so Undo can relink it. Session-scoped:
   * after a restart that window id may belong to an unrelated window.
   */
  deletedFrom: Record<string, number>;
};

export function emptyLinks(): Links {
  return {
    windows: {},
    tabs: {},
    groups: {},
    closing: {},
    merging: [],
    recentCloses: [],
    reconciledAt: null,
    relinkDone: false,
    deletedFrom: {},
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const strMap = (v: unknown): Record<string, string> =>
  isObj(v)
    ? Object.fromEntries(
        Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string'),
      )
    : {};

const numMap = (v: unknown): Record<string, number> =>
  isObj(v)
    ? Object.fromEntries(
        Object.entries(v).filter((e): e is [string, number] => typeof e[1] === 'number'),
      )
    : {};

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

function parseRecentClose(v: unknown): RecentClose[] {
  if (
    !isObj(v) ||
    typeof v.windowId !== 'number' ||
    typeof v.topicId !== 'string' ||
    typeof v.at !== 'number' ||
    !isStrings(v.ids) ||
    !isStrings(v.order)
  ) {
    return [];
  }
  return [{ windowId: v.windowId, topicId: v.topicId, ids: v.ids, order: v.order, at: v.at }];
}

export function parseLinks(raw: unknown): Links {
  if (!isObj(raw)) return emptyLinks();
  return {
    windows: strMap(raw.windows),
    tabs: strMap(raw.tabs),
    groups: strMap(raw.groups),
    closing: numMap(raw.closing),
    merging: Array.isArray(raw.merging)
      ? raw.merging.filter((n): n is number => typeof n === 'number')
      : [],
    recentCloses: Array.isArray(raw.recentCloses) ? raw.recentCloses.flatMap(parseRecentClose) : [],
    reconciledAt: typeof raw.reconciledAt === 'number' ? raw.reconciledAt : null,
    relinkDone: raw.relinkDone === true,
    deletedFrom: numMap(raw.deletedFrom),
  };
}

export function isClosing(links: Links, windowId: number, now: number): boolean {
  const at = links.closing[String(windowId)];
  return at !== undefined && now - at < CLOSING_TTL_MS;
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
  const closing = { ...links.closing };
  delete closing[String(windowId)];
  return {
    ...links,
    windows,
    tabs,
    closing,
    merging: links.merging.filter((w) => w !== windowId),
  };
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
