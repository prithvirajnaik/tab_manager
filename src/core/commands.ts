import { unbindWindow, windowForTopic, type LinkStore, type Links } from './links';
import { isOpenableUrl, type SavedTab, type Store, type Topic } from './model';
import type { BrowserPort, Clock, LiveTab } from './ports';
import { createWriteQueue } from './queue';
import { reconcileTopic } from './reconcile';
import type { Repo } from './repo';
import { isSaveable, openOrder, toSavedTab } from './tabs';

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

  async function liveWindowFor(links: Links, topicId: string): Promise<number | null> {
    const windowId = windowForTopic(links, topicId);
    if (windowId === null) return null;
    return (await browser.listWindowIds()).includes(windowId) ? windowId : null;
  }

  /** Brings every linked topic in line with its window. Must run inside the queue. */
  async function syncLinked(): Promise<void> {
    const links = await linkStore.read();
    const windowIds = new Set(await browser.listWindowIds());
    const live = await browser.listTabs();
    const byWindow = new Map<number, LiveTab[]>();
    for (const t of live) byWindow.set(t.windowId, [...(byWindow.get(t.windowId) ?? []), t]);

    const nextLinks: Links = { ...links, windows: { ...links.windows }, tabs: {} };
    await repo.update((store) => {
      const foreign = new Map<string, SavedTab>();
      for (const t of store.topics) for (const s of t.tabs) foreign.set(s.id, s);

      for (const [w, topicId] of Object.entries(links.windows)) {
        const windowId = Number(w);
        if (links.closing.includes(windowId)) continue;
        const index = store.topics.findIndex((t) => t.id === topicId);
        const topic = store.topics[index];
        if (!topic) {
          delete nextLinks.windows[w];
          continue;
        }
        if (!windowIds.has(windowId)) {
          // The window closed with its tabs: the topic keeps them, now unlinked.
          delete nextLinks.windows[w];
          if (topic.windowId === windowId) store.topics[index] = { ...topic, windowId: null };
          continue;
        }
        const elsewhere = new Set<string>();
        for (const t of live) {
          const savedId = links.tabs[String(t.id)];
          if (savedId && t.windowId !== windowId && links.windows[String(t.windowId)]) {
            elsewhere.add(savedId);
          }
        }
        const result = reconcileTopic(topic, byWindow.get(windowId) ?? [], {
          now: now(),
          newId,
          ownNewTabUrl,
          tabLinks: links.tabs,
          elsewhere,
          foreign,
        });
        Object.assign(nextLinks.tabs, result.tabLinks);
        store.topics[index] =
          result.topic.windowId === windowId ? result.topic : { ...result.topic, windowId };
      }
      return store;
    });
    await linkStore.write(nextLinks);
  }

  return {
    /** Saves a window as a new topic and links them. */
    saveWindow(windowId: number, name: string): Promise<Topic> {
      return queue.run(async () => {
        const topicName = cleanName(name);
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

    /** Focuses the topic's window, or opens the topic in a new window. */
    openTopic(topicId: string): Promise<void> {
      return queue.run(async () => {
        const store = await repo.read();
        const topic = findTopic(store, topicId);
        const links = await linkStore.read();
        const open = await liveWindowFor(links, topicId);
        if (open !== null) {
          await browser.focusWindow(open);
          return;
        }
        const tabs = openOrder(topic.tabs.filter((t) => isOpenableUrl(t.url)));
        const { windowId, tabIds } = await browser.createWindow(
          tabs.map((t) => ({ url: t.url, pinned: t.pinned })),
        );
        const tabLinks: Record<string, string> = {};
        tabIds.forEach((id, i) => {
          const saved = tabs[i];
          if (saved) tabLinks[String(id)] = saved.id;
        });
        const stale = windowForTopic(links, topicId);
        const base = stale === null ? links : unbindWindow(links, stale);
        await linkStore.write({
          ...base,
          windows: { ...base.windows, [String(windowId)]: topicId },
          tabs: { ...base.tabs, ...tabLinks },
        });
        await repo.update((s) => {
          const t = findTopic(s, topicId);
          t.windowId = windowId;
          return s;
        });
      });
    },

    /** Saves the topic's window one last time, unlinks it and closes it. */
    parkTopic(topicId: string): Promise<void> {
      return queue.run(async () => {
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
        if (windowId === null) return;
        const tabIds = (await browser.listTabs(windowId)).map((t) => t.id);
        // Mark the window as closing first so its tab removals are not read as closes.
        await linkStore.write(
          unbindWindow({ ...links, closing: [...links.closing, windowId] }, windowId, tabIds),
        );
        await browser.removeWindow(windowId);
      });
    },

    /** Moves a tab from recently closed or parked back into the topic, opening it if live. */
    restoreTab(topicId: string, savedTabId: string, from: RestoreSource): Promise<void> {
      return queue.run(async () => {
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
      return queue.run(syncLinked);
    },
  };
}
