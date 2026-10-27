import { emptyLinks, unbindWindow, windowForTopic, type LinkStore, type Links } from './links';
import { TRASH_DAYS, isOpenableUrl, type SavedTab, type Store, type Topic } from './model';
import type { BrowserPort, Clock, LiveTab } from './ports';
import { createWriteQueue } from './queue';
import { reconcileTopic } from './reconcile';
import type { Repo } from './repo';
import { matchWindows, pruneExpired } from './startup';
import { isBlankPage, isSaveable, openOrder, toSavedTab } from './tabs';

const DAY = 86_400_000;

/** An error whose message is safe and useful to show to the user. */
export class UserError extends Error {
  override name = 'UserError';
}

export type ServiceDeps = {
  browser: BrowserPort;
  repo: Repo;
  links: LinkStore;
  now: Clock;
  newId: () => string;
  /** URL of this extension's new tab page; such tabs are never saved. */
  ownNewTabUrl: string;
};

/** How long after a restart restored windows may still be matched to their topics. */
export const RELINK_GRACE_MS = 2 * 60_000;

export type RestoreSource = 'recentlyClosed' | 'parked';

export type Service = ReturnType<typeof createService>;

function findTopic(store: Store, topicId: string): Topic {
  const topic = store.topics.find((t) => t.id === topicId);
  if (!topic) throw new UserError('Topic not found.');
  return topic;
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new UserError('Give the topic a name.');
  if (trimmed.length > 200) throw new UserError('Topic names are limited to 200 characters.');
  return trimmed;
}

export function createService(deps: ServiceDeps) {
  const { browser, repo, links: linkStore, now, newId, ownNewTabUrl } = deps;
  // Commands and syncs run one at a time so browser calls, links and store stay consistent.
  const queue = createWriteQueue();

  /**
   * Relinks windows after a browser restart (session storage is cleared on restart, update
   * and reload). Topics that were open are matched to open, unlinked windows by URL
   * similarity. Browsers may restore windows after the extension starts, so matching is
   * retried for RELINK_GRACE_MS; after that, topics still unmatched are marked closed, keeping
   * every tab. A snapshot is taken first.
   */
  async function relinkRestoredWindows(): Promise<void> {
    let links = await linkStore.read();
    const at = now();
    if (links.reconciledAt === null) {
      const store = await repo.read();
      if (store.topics.some((t) => t.windowId !== null))
        await repo.update((x) => x, { snapshot: true });
      links = { ...emptyLinks(), reconciledAt: at };
      await linkStore.write(links);
    }
    const linked = new Set(Object.values(links.windows));
    const store = await repo.read();
    const stale = store.topics.filter((t) => t.windowId !== null && !linked.has(t.id));
    if (stale.length === 0) return;

    if (at - (links.reconciledAt ?? at) > RELINK_GRACE_MS) {
      const ids = new Set(stale.map((t) => t.id));
      await repo.update((x) => {
        for (const t of x.topics) if (ids.has(t.id)) t.windowId = null;
        return x;
      });
      return;
    }

    const urls = new Map<number, string[]>();
    for (const t of await browser.listTabs()) {
      if (links.windows[String(t.windowId)] || !isSaveable(t.url, ownNewTabUrl)) continue;
      const list = urls.get(t.windowId);
      if (list) list.push(t.url);
      else urls.set(t.windowId, [t.url]);
    }
    const windows = [...urls].map(([windowId, list]) => ({ windowId, urls: list }));
    const matched = matchWindows(stale, windows);
    if (matched.size === 0) return;
    await linkStore.write({
      ...links,
      windows: {
        ...links.windows,
        ...Object.fromEntries([...matched].map(([w, topicId]) => [String(w), topicId])),
      },
    });
  }

  /** Every command and sync: serialized, and only after restored windows are relinked. */
  function run<T>(task: () => Promise<T>): Promise<T> {
    return queue.run(async () => {
      await relinkRestoredWindows();
      return task();
    });
  }

  async function liveWindowFor(links: Links, topicId: string): Promise<number | null> {
    const windowId = windowForTopic(links, topicId);
    if (windowId === null) return null;
    return (await browser.listWindowIds()).includes(windowId) ? windowId : null;
  }

  /** Brings every linked topic in line with its window. Must run inside the queue. */
  async function syncLinked(): Promise<void> {
    const links = await linkStore.read();
    const openWindows = new Set(await browser.listWindowIds());
    const live = await browser.listTabs();
    const byWindow = new Map<number, LiveTab[]>();
    for (const t of live) {
      const list = byWindow.get(t.windowId);
      if (list) list.push(t);
      else byWindow.set(t.windowId, [t]);
    }

    const nextLinks: Links = {
      ...links,
      windows: { ...links.windows },
      tabs: {},
      closing: links.closing.filter((w) => openWindows.has(w)),
    };
    await repo.update((store) => {
      const topicIds = new Set(store.topics.map((t) => t.id));
      // Windows that will be reconciled: open, not closing, linked to an existing topic.
      const adopting = new Set<number>();
      for (const [w, topicId] of Object.entries(links.windows)) {
        const windowId = Number(w);
        if (
          topicIds.has(topicId) &&
          openWindows.has(windowId) &&
          !links.closing.includes(windowId)
        ) {
          adopting.add(windowId);
        }
      }
      // savedId -> the window whose topic will adopt it. Only saveable tabs are adopted.
      const adoptedIn = new Map<string, number>();
      for (const t of live) {
        const savedId = links.tabs[String(t.id)];
        if (savedId && adopting.has(t.windowId) && isSaveable(t.url, ownNewTabUrl)) {
          adoptedIn.set(savedId, t.windowId);
        }
      }
      const foreign = new Map<string, SavedTab>();
      for (const t of store.topics) for (const s of t.tabs) foreign.set(s.id, s);
      const adoptedBy = new Map<string, string>();

      for (const [w, topicId] of Object.entries(links.windows)) {
        const windowId = Number(w);
        const index = store.topics.findIndex((t) => t.id === topicId);
        const topic = store.topics[index];
        if (!topic) {
          delete nextLinks.windows[w];
          continue;
        }
        if (!openWindows.has(windowId)) {
          // The window closed with its tabs: the topic keeps them, now unlinked.
          delete nextLinks.windows[w];
          if (topic.windowId === windowId) store.topics[index] = { ...topic, windowId: null };
          continue;
        }
        // Mid-close: tabs are disappearing because the window is, not because they were closed.
        if (links.closing.includes(windowId)) continue;
        const elsewhere = new Set<string>();
        for (const [savedId, adopter] of adoptedIn)
          if (adopter !== windowId) elsewhere.add(savedId);
        const result = reconcileTopic(topic, byWindow.get(windowId) ?? [], {
          now: now(),
          newId,
          ownNewTabUrl,
          tabLinks: links.tabs,
          elsewhere,
          foreign,
        });
        Object.assign(nextLinks.tabs, result.tabLinks);
        for (const id of result.adopted) adoptedBy.set(id, topicId);
        store.topics[index] =
          result.topic.windowId === windowId ? result.topic : { ...result.topic, windowId };
      }

      // A tab dragged into another topic's window now lives there; the topic it came from
      // (whose window may have closed with the drag) lets go of it.
      if (adoptedBy.size) {
        store.topics = store.topics.map((t) => {
          const tabs = t.tabs.filter((s) => (adoptedBy.get(s.id) ?? t.id) === t.id);
          return tabs.length === t.tabs.length ? t : { ...t, tabs, updatedAt: now() };
        });
      }
      return store;
    });
    await linkStore.write(nextLinks);
  }

  return {
    /** Saves a window as a new topic and links them. */
    saveWindow(windowId: number, name: string): Promise<Topic> {
      return run(async () => {
        const topicName = cleanName(name);
        if (!(await browser.listWindowIds()).includes(windowId)) {
          throw new UserError('That window is no longer open.');
        }
        const links = await linkStore.read();
        const existing = links.windows[String(windowId)];
        if (existing) {
          const store = await repo.read();
          const linked = store.topics.find((t) => t.id === existing);
          if (linked) throw new UserError(`This window is already saved as "${linked.name}".`);
        }
        const live = (await browser.listTabs(windowId)).filter((t) =>
          isSaveable(t.url, ownNewTabUrl),
        );
        const at = now();
        const tabLinks: Record<string, string> = {};
        const tabs = live.map((t) => {
          const id = newId();
          tabLinks[String(t.id)] = id;
          return toSavedTab(t, id, at);
        });
        const topic: Topic = {
          id: newId(),
          name: topicName,
          windowId,
          tabs,
          sections: [],
          recentlyClosed: [],
          parked: [],
          createdAt: at,
          updatedAt: at,
        };
        await repo.update((store) => ({ ...store, topics: [...store.topics, topic] }));
        await linkStore.write({
          ...links,
          windows: { ...links.windows, [String(windowId)]: topic.id },
          tabs: { ...links.tabs, ...tabLinks },
        });
        return topic;
      });
    },

    /**
     * Focuses the topic's window, or opens the topic in a new window. Tabs the browser refuses
     * to open move to the topic's Parked list, where they are kept without expiring.
     */
    openTopic(topicId: string): Promise<{ failed: number }> {
      return run(async () => {
        const store = await repo.read();
        const topic = findTopic(store, topicId);
        const links = await linkStore.read();
        const open = await liveWindowFor(links, topicId);
        if (open !== null) {
          await browser.focusWindow(open);
          return { failed: 0 };
        }
        const tabs = openOrder(topic.tabs.filter((t) => isOpenableUrl(t.url)));
        const { windowId, tabIds } = await browser.createWindow(
          tabs.map((t) => ({ url: t.url, pinned: t.pinned })),
        );
        const tabLinks: Record<string, string> = {};
        const failed = new Set<string>();
        tabs.forEach((saved, i) => {
          const id = tabIds[i];
          if (id === undefined || id < 0) failed.add(saved.id);
          else tabLinks[String(id)] = saved.id;
        });
        const stale = windowForTopic(links, topicId);
        const base = stale === null ? links : unbindWindow(links, stale);
        await linkStore.write({
          ...base,
          windows: { ...base.windows, [String(windowId)]: topicId },
          tabs: { ...base.tabs, ...tabLinks },
        });
        const at = now();
        await repo.update((s) => {
          const t = findTopic(s, topicId);
          t.windowId = windowId;
          if (failed.size) {
            t.parked = [
              ...t.tabs.filter((x) => failed.has(x.id)).map((x) => ({ ...x, parkedAt: at })),
              ...t.parked,
            ];
            t.tabs = t.tabs.filter((x) => !failed.has(x.id));
            t.updatedAt = at;
          }
          return s;
        });
        return { failed: failed.size };
      });
    },

    /**
     * Saves the topic's window one last time, unlinks it and closes it. Tabs that could not be
     * saved (blob: pages, say) stay open in the now unlinked window instead of being closed.
     */
    parkTopic(topicId: string): Promise<{ leftOpen: number }> {
      return run(async () => {
        findTopic(await repo.read(), topicId);
        await syncLinked();
        const links = await linkStore.read();
        const windowId = await liveWindowFor(links, topicId);
        const stale = windowForTopic(links, topicId);
        await repo.update((s) => {
          findTopic(s, topicId).windowId = null;
          return s;
        });
        if (stale !== null && windowId === null) await linkStore.write(unbindWindow(links, stale));
        if (windowId === null) return { leftOpen: 0 };
        const tabs = await browser.listTabs(windowId);
        await linkStore.write(
          unbindWindow(
            links,
            windowId,
            tabs.map((t) => t.id),
          ),
        );
        const unsaved = tabs.filter(
          (t) => !isSaveable(t.url, ownNewTabUrl) && !isBlankPage(t.url, ownNewTabUrl),
        );
        if (unsaved.length === 0) await browser.removeWindow(windowId);
        else await browser.removeTabs(tabs.filter((t) => !unsaved.includes(t)).map((t) => t.id));
        return { leftOpen: unsaved.length };
      });
    },

    /** Moves a tab from recently closed or parked back into the topic, opening it if live. */
    restoreTab(topicId: string, savedTabId: string, from: RestoreSource): Promise<void> {
      return run(async () => {
        const store = await repo.read();
        const topic = findTopic(store, topicId);
        const entry = topic[from].find((t) => t.id === savedTabId);
        if (!entry) throw new UserError('Tab not found.');
        const links = await linkStore.read();
        const windowId = await liveWindowFor(links, topicId);
        const tab: SavedTab = {
          id: entry.id,
          url: entry.url,
          title: entry.title,
          pinned: entry.pinned,
          lastActiveAt: now(),
          ...(entry.favIconUrl ? { favIconUrl: entry.favIconUrl } : {}),
          ...(entry.sectionId ? { sectionId: entry.sectionId } : {}),
        };
        if (windowId !== null) {
          const tabId = await browser.createTab(windowId, { url: tab.url, pinned: tab.pinned });
          await linkStore.write({ ...links, tabs: { ...links.tabs, [String(tabId)]: tab.id } });
        }
        await repo.update((s) => {
          const t = findTopic(s, topicId);
          if (from === 'parked') t.parked = t.parked.filter((x) => x.id !== savedTabId);
          else t.recentlyClosed = t.recentlyClosed.filter((x) => x.id !== savedTabId);
          t.tabs = [...t.tabs.filter((x) => x.id !== tab.id), tab];
          t.updatedAt = now();
          return s;
        });
      });
    },

    /** Brings every linked topic in line with its window. */
    syncAll(): Promise<void> {
      return run(syncLinked);
    },

    /**
     * Called when a tab is removed because its window is closing: until the window is gone,
     * syncs leave that topic alone, so the closing does not read as tabs being closed.
     */
    noteWindowClosing(windowId: number): Promise<void> {
      return run(async () => {
        const links = await linkStore.read();
        if (!links.windows[String(windowId)] || links.closing.includes(windowId)) return;
        await linkStore.write({ ...links, closing: [...links.closing, windowId] });
      });
    },

    /** Periodic upkeep: expire old Recently closed entries and trash, then sync. */
    maintenance(): Promise<void> {
      return run(async () => {
        await repo.update((s) => pruneExpired(s, now()));
        await syncLinked();
      });
    },

    renameTopic(topicId: string, name: string): Promise<void> {
      return run(async () => {
        const topicName = cleanName(name);
        await repo.update((s) => {
          const t = findTopic(s, topicId);
          t.name = topicName;
          t.updatedAt = now();
          return s;
        });
      });
    },

    /**
     * Moves a topic to the trash (kept TRASH_DAYS) after a snapshot. Its window, if open,
     * stays open and is simply no longer linked.
     */
    deleteTopic(topicId: string): Promise<void> {
      return run(async () => {
        findTopic(await repo.read(), topicId);
        const links = await linkStore.read();
        const windowId = windowForTopic(links, topicId);
        const at = now();
        await repo.update(
          (s) => {
            const topic = findTopic(s, topicId);
            const cutoff = at - TRASH_DAYS * DAY;
            s.topics = s.topics.filter((t) => t.id !== topicId);
            s.trash = [
              { topic: { ...topic, windowId: null }, deletedAt: at },
              ...s.trash.filter((e) => e.deletedAt >= cutoff),
            ];
            return s;
          },
          { snapshot: true },
        );
        // Stale tab links are dropped by the next sync, which rebuilds them from linked windows.
        if (windowId !== null) {
          const unbound = unbindWindow(links, windowId);
          await linkStore.write({
            ...unbound,
            deletedFrom: { ...unbound.deletedFrom, [topicId]: windowId },
          });
        }
      });
    },

    /** Brings a topic back from the trash, relinking its window if that is still open and free. */
    undoDelete(topicId: string): Promise<void> {
      return run(async () => {
        const store = await repo.read();
        const entry = store.trash.find((e) => e.topic.id === topicId);
        if (!entry) throw new UserError('Deleted topic not found.');
        const restoredId = store.topics.some((t) => t.id === topicId) ? newId() : topicId;
        const links = await linkStore.read();
        const previous = links.deletedFrom[topicId] ?? null;
        const deletedFrom = { ...links.deletedFrom };
        delete deletedFrom[topicId];
        const relink =
          previous !== null &&
          links.windows[String(previous)] === undefined &&
          (await browser.listWindowIds()).includes(previous)
            ? previous
            : null;
        await repo.update((s) => {
          s.trash = s.trash.filter((e) => e.topic.id !== topicId);
          s.topics.push({ ...entry.topic, id: restoredId, windowId: relink });
          return s;
        });
        await linkStore.write({
          ...links,
          deletedFrom,
          windows:
            relink === null ? links.windows : { ...links.windows, [String(relink)]: restoredId },
        });
        if (relink !== null) await syncLinked();
      });
    },
  };
}
