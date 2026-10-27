import {
  REVERT_WINDOW_MS,
  emptyLinks,
  isClosing,
  unbindWindow,
  windowForTopic,
  type LinkStore,
  type Links,
} from './links';
import { selectIdleTabs } from './autopark';
import {
  TRASH_DAYS,
  isOpenableUrl,
  type AutoParkMode,
  type ParkedTab,
  type SavedTab,
  type Store,
  type Topic,
} from './model';
import type { BrowserPort, Clock, LiveGroup, LiveTab } from './ports';
import { createWriteQueue } from './queue';
import { reconcileTopic, revertCloses } from './reconcile';
import { reconcileSections } from './sections';
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

/** Background tabs in topic windows idle this long are discarded to free memory. */
export const DISCARD_AFTER_MS = 60 * 60_000;

export type ParkCandidate = {
  topicId: string | null;
  topicName: string | null;
  url: string;
  title: string;
};

export type AutoParkResult = { dryRun: boolean; tabs: ParkCandidate[] };

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
   * every tab. A snapshot is taken first. Until the grace period ends, syncs of a relinked
   * window add tabs but close none, so a wrong or partial match cannot empty a topic.
   */
  async function relinkRestoredWindows(): Promise<void> {
    let links = await linkStore.read();
    const at = now();
    if (links.reconciledAt === null) {
      const store = await repo.read();
      if (store.topics.some((t) => t.windowId !== null)) {
        await repo.update((x) => x, { snapshot: true });
      }
      links = { ...emptyLinks(), reconciledAt: at };
      await linkStore.write(links);
    }
    if (at - (links.reconciledAt ?? at) > RELINK_GRACE_MS && links.relinkDone) return;

    const linked = new Set(Object.values(links.windows));
    const store = await repo.read();
    const stale = store.topics.filter((t) => t.windowId !== null && !linked.has(t.id));

    if (at - (links.reconciledAt ?? at) > RELINK_GRACE_MS) {
      const ids = new Set(stale.map((t) => t.id));
      if (ids.size) {
        await repo.update((x) => {
          for (const t of x.topics) if (ids.has(t.id)) t.windowId = null;
          return x;
        });
      }
      await linkStore.write({ ...links, relinkDone: true, merging: [] });
      return;
    }
    if (stale.length === 0) return;

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
      merging: [...links.merging, ...matched.keys()],
    });
  }

  /** Every command and sync: serialized, and only after restored windows are relinked. */
  function run<T>(task: () => Promise<T>): Promise<T> {
    return queue.run(async () => {
      await relinkRestoredWindows();
      return task();
    });
  }

  /** Live tab ids currently linked to the given saved ids, in the given order. */
  function liveTabIds(links: Links, savedIds: string[]): number[] {
    const bySaved = new Map(
      Object.entries(links.tabs).map(([tabId, saved]) => [saved, Number(tabId)]),
    );
    return savedIds.flatMap((id) => {
      const tabId = bySaved.get(id);
      return tabId === undefined ? [] : [tabId];
    });
  }

  async function liveWindowFor(links: Links, topicId: string): Promise<number | null> {
    const windowId = windowForTopic(links, topicId);
    if (windowId === null) return null;
    return (await browser.listWindowIds()).includes(windowId) ? windowId : null;
  }

  /** Puts back tabs that recent syncs closed in a window that turned out to be closing. */
  function revertRecentCloses(store: Store, links: Links, windowId: number, at: number): Store {
    for (const entry of links.recentCloses) {
      if (entry.windowId !== windowId || at - entry.at > REVERT_WINDOW_MS) continue;
      const index = store.topics.findIndex((t) => t.id === entry.topicId);
      const topic = store.topics[index];
      if (!topic) continue;
      const reverted = revertCloses(topic, entry.ids, entry.order);
      // Bring back sections that vanished with the window's groups.
      const known = new Set(reverted.sections.map((s) => s.id));
      const lost = (entry.sections ?? []).filter(
        (s) => !known.has(s.id) && reverted.tabs.some((t) => t.sectionId === s.id),
      ) as Topic['sections'];
      store.topics[index] = lost.length
        ? { ...reverted, sections: [...reverted.sections, ...lost] }
        : reverted;
    }
    return store;
  }

  function unpark(p: ParkedTab, at: number): SavedTab {
    const tab: SavedTab & { parkedAt?: number } = { ...p, lastActiveAt: at };
    delete tab.parkedAt;
    return tab;
  }

  /** Opens parked tabs in a window (or a new one). Must run inside the queue. */
  async function openParked(entries: ParkedTab[], windowId?: number): Promise<void> {
    const open = windowId !== undefined && (await browser.listWindowIds()).includes(windowId);
    if (open) {
      for (const t of entries) await browser.createTab(windowId, { url: t.url, pinned: t.pinned });
    } else {
      await browser.createWindow(entries.map((t) => ({ url: t.url, pinned: t.pinned })));
    }
  }

  async function autoParkInQueue(options: {
    dryRun?: boolean;
    at?: number;
  }): Promise<AutoParkResult> {
    const store = await repo.read();
    const mode = store.settings.autoParkMode;
    const dryRun = options.dryRun ?? mode === 'dry-run';
    if (mode === 'off' && options.dryRun === undefined) return { dryRun: true, tabs: [] };
    await syncLinked();
    const links = await linkStore.read();
    const at = options.at ?? now();
    const fresh = await repo.read();
    const savedById = new Map<string, { topic: Topic; tab: SavedTab }>();
    for (const topic of fresh.topics)
      for (const tab of topic.tabs) savedById.set(tab.id, { topic, tab });
    const live = await browser.listTabs();
    const savedActivity = new Map<number, number>();
    for (const t of live) {
      const saved = savedById.get(links.tabs[String(t.id)] ?? '');
      if (saved) savedActivity.set(t.id, saved.tab.lastActiveAt);
    }
    const skipWindows = new Set<number>([
      ...links.merging,
      ...Object.keys(links.closing)
        .map(Number)
        .filter((w) => isClosing(links, w, at)),
    ]);
    const idle = selectIdleTabs({
      tabs: live,
      now: at,
      days: fresh.settings.autoParkDays,
      ownNewTabUrl,
      savedActivity,
      skipWindows,
    });

    // A tab belongs to a topic only when its window is linked to that topic.
    const plan = idle.map((t) => {
      const topicId = links.windows[String(t.windowId)] ?? null;
      const saved = savedById.get(links.tabs[String(t.id)] ?? '');
      const owned = topicId !== null && saved?.topic.id === topicId ? saved : undefined;
      return { live: t, topicId: owned ? topicId : null, saved: owned?.tab };
    });
    const tabs: ParkCandidate[] = plan.map((p) => ({
      topicId: p.topicId,
      topicName: p.topicId ? (fresh.topics.find((x) => x.id === p.topicId)?.name ?? null) : null,
      url: p.live.url,
      title: p.live.title,
    }));
    if (dryRun || plan.length === 0) return { dryRun, tabs };

    await repo.update(
      (s) => {
        for (const p of plan) {
          if (p.topicId !== null && p.saved) {
            const topic = s.topics.find((x) => x.id === p.topicId);
            const tab = topic?.tabs.find((x) => x.id === p.saved?.id);
            if (!topic || !tab) continue;
            topic.tabs = topic.tabs.filter((x) => x.id !== tab.id);
            topic.parked = [{ ...tab, parkedAt: at }, ...topic.parked];
            topic.updatedAt = at;
          } else {
            s.unsortedParked = [
              { ...toSavedTab(p.live, newId(), at), parkedAt: at },
              ...s.unsortedParked,
            ];
          }
        }
        return s;
      },
      { snapshot: true },
    );
    const tabLinks = { ...links.tabs };
    for (const p of plan) delete tabLinks[String(p.live.id)];
    await linkStore.write({ ...links, tabs: tabLinks });
    await browser.removeTabs(plan.map((p) => p.live.id));
    return { dryRun: false, tabs };
  }

  /** Discards background tabs in topic windows that have been idle for an hour. */
  async function discardIdle(): Promise<void> {
    const links = await linkStore.read();
    const at = now();
    const ids = (await browser.listTabs())
      .filter(
        (t) =>
          links.windows[String(t.windowId)] !== undefined &&
          !t.active &&
          !t.audible &&
          !t.discarded &&
          t.lastAccessed !== undefined &&
          at - t.lastAccessed >= DISCARD_AFTER_MS,
      )
      .map((t) => t.id);
    if (ids.length) await browser.discardTabs(ids).catch(() => undefined);
  }

  /** Brings every linked topic in line with its window. Must run inside the queue. */
  async function syncLinked(): Promise<void> {
    const links = await linkStore.read();
    const at = now();
    const openWindows = new Set(await browser.listWindowIds());
    const live = await browser.listTabs();
    const byWindow = new Map<number, LiveTab[]>();
    for (const t of live) {
      const list = byWindow.get(t.windowId);
      if (list) list.push(t);
      else byWindow.set(t.windowId, [t]);
    }
    const groupsByWindow = new Map<number, LiveGroup[]>();
    for (const g of await browser.listGroups()) {
      const list = groupsByWindow.get(g.windowId);
      if (list) list.push(g);
      else groupsByWindow.set(g.windowId, [g]);
    }

    const nextLinks: Links = {
      ...links,
      windows: { ...links.windows },
      tabs: {},
      groups: {},
      closing: Object.fromEntries(
        Object.entries(links.closing).filter(
          ([w]) => openWindows.has(Number(w)) && isClosing(links, Number(w), at),
        ),
      ),
      merging: [],
      recentCloses: links.recentCloses.filter((e) => at - e.at <= REVERT_WINDOW_MS),
    };
    // Nothing open at all: most likely the browser is quitting. Leave topics marked open so
    // the next start can relink them to the restored windows.
    const quitting = openWindows.size === 0;

    await repo.update((store) => {
      const topicIds = new Set(store.topics.map((t) => t.id));
      const reconciling = (windowId: number, topicId: string) =>
        topicIds.has(topicId) &&
        openWindows.has(windowId) &&
        !isClosing(links, windowId, at) &&
        (byWindow.get(windowId)?.length ?? 0) > 0;
      // Windows that will be reconciled: open, not closing, not empty, linked to a topic.
      const adopting = new Set<number>();
      for (const [w, topicId] of Object.entries(links.windows)) {
        if (reconciling(Number(w), topicId)) adopting.add(Number(w));
      }
      // savedId -> the window whose topic will adopt it. Only saveable tabs are adopted.
      const adoptedIn = new Map<string, number>();
      for (const t of live) {
        const savedId = links.tabs[String(t.id)];
        if (savedId && adopting.has(t.windowId) && isSaveable(t.url, ownNewTabUrl)) {
          adoptedIn.set(savedId, t.windowId);
        }
      }
      // Any saved tab, open or recently closed, can be reclaimed by a linked live tab: a tab
      // dragged through a temporary window was briefly "closed" by its source topic.
      const foreign = new Map<string, SavedTab>();
      for (const t of store.topics) {
        for (const c of t.recentlyClosed) {
          const tab: SavedTab & { closedAt?: number } = { ...c };
          delete tab.closedAt;
          foreign.set(c.id, tab);
        }
        for (const s of t.tabs) foreign.set(s.id, s);
      }
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
          revertRecentCloses(store, links, windowId, at);
          if (quitting) continue;
          delete nextLinks.windows[w];
          const current = store.topics[index] ?? topic;
          if (current.windowId === windowId) store.topics[index] = { ...current, windowId: null };
          continue;
        }
        if (!reconciling(windowId, topicId)) continue;
        const elsewhere = new Set<string>();
        for (const [savedId, adopter] of adoptedIn) {
          if (adopter !== windowId) elsewhere.add(savedId);
        }
        const windowTabs = byWindow.get(windowId) ?? [];
        // Tab groups, in tab-strip order, become the topic's sections.
        const firstIndex = new Map<number, number>();
        for (const t of windowTabs) {
          if (t.groupId >= 0 && !firstIndex.has(t.groupId)) firstIndex.set(t.groupId, t.index);
        }
        const windowGroups = (groupsByWindow.get(windowId) ?? [])
          .filter((g) => firstIndex.has(g.id))
          .sort((a, b) => (firstIndex.get(a.id) ?? 0) - (firstIndex.get(b.id) ?? 0));
        const merging = links.merging.includes(windowId);
        const sections = reconcileSections(topic, windowGroups, links.groups, newId, merging);
        Object.assign(nextLinks.groups, sections.groupLinks);
        const result = reconcileTopic(topic, windowTabs, {
          now: at,
          newId,
          ownNewTabUrl,
          tabLinks: links.tabs,
          elsewhere,
          foreign,
          sectionForGroup: (groupId) => sections.groupLinks[String(groupId)],
          keepMissing: merging,
        });
        Object.assign(nextLinks.tabs, result.tabLinks);
        for (const id of result.adopted) adoptedBy.set(id, topicId);
        if (result.closedIds.length) {
          nextLinks.recentCloses.push({
            windowId,
            topicId,
            ids: result.closedIds,
            order: topic.tabs.map((t) => t.id),
            sections: topic.sections,
            at,
          });
        }
        let next =
          result.topic.windowId === windowId ? result.topic : { ...result.topic, windowId };
        if (JSON.stringify(sections.sections) !== JSON.stringify(topic.sections)) {
          next = { ...next, sections: sections.sections, updatedAt: at };
        }
        store.topics[index] = next;
      }

      // A reclaimed tab now lives in its adopting topic only: other topics let go of it, and
      // no topic keeps it in Recently closed.
      if (adoptedBy.size) {
        store.topics = store.topics.map((t) => {
          const tabs = t.tabs.filter((s) => (adoptedBy.get(s.id) ?? t.id) === t.id);
          const recentlyClosed = t.recentlyClosed.filter((c) => !adoptedBy.has(c.id));
          return tabs.length === t.tabs.length && recentlyClosed.length === t.recentlyClosed.length
            ? t
            : { ...t, tabs, recentlyClosed, updatedAt: at };
        });
      }
      return store;
    });

    // Keep links of live tabs outside linked windows (mid-drag, or skipped windows), so the
    // tab is recognised when it lands.
    for (const t of live) {
      const savedId = links.tabs[String(t.id)];
      if (savedId && nextLinks.tabs[String(t.id)] === undefined)
        nextLinks.tabs[String(t.id)] = savedId;
    }
    for (const [g, sectionId] of Object.entries(links.groups)) {
      if (nextLinks.groups[g] === undefined && live.some((t) => String(t.groupId) === g)) {
        nextLinks.groups[g] = sectionId;
      }
    }
    // Relinked windows merge (close nothing) for the whole relink grace period.
    nextLinks.merging = links.relinkDone ? [] : links.merging.filter((w) => openWindows.has(w));
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
        // Recreate the topic's sections as tab groups. A group that fails is skipped; its
        // tabs stay open, ungrouped.
        const groupLinks: Record<string, string> = {};
        for (const section of topic.sections) {
          const ids = tabs.flatMap((t, i) => {
            const id = tabIds[i];
            return t.sectionId === section.id && !t.pinned && id !== undefined && id >= 0
              ? [id]
              : [];
          });
          if (ids.length === 0) continue;
          try {
            const groupId = await browser.groupTabs(windowId, {
              tabIds: ids,
              title: section.name,
              ...(section.color ? { color: section.color } : {}),
              ...(section.collapsed === undefined ? {} : { collapsed: section.collapsed }),
            });
            groupLinks[String(groupId)] = section.id;
          } catch {
            // Grouping is cosmetic; never fail an open over it.
          }
        }
        const stale = windowForTopic(links, topicId);
        const base = stale === null ? links : unbindWindow(links, stale);
        await linkStore.write({
          ...base,
          windows: { ...base.windows, [String(windowId)]: topicId },
          tabs: { ...base.tabs, ...tabLinks },
          groups: { ...base.groups, ...groupLinks },
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
        const at = now();
        if (!links.windows[String(windowId)] || isClosing(links, windowId, at)) return;
        // A sync that ran as the close began may have taken its first tabs for closes.
        if (links.recentCloses.some((e) => e.windowId === windowId)) {
          await repo.update((s) => revertRecentCloses(s, links, windowId, at));
        }
        await linkStore.write({
          ...links,
          closing: { ...links.closing, [String(windowId)]: at },
          recentCloses: links.recentCloses.filter((e) => e.windowId !== windowId),
        });
      });
    },

    /** Unlinks a topic from its window, which stays open; the topic keeps its tabs. */
    detachWindow(topicId: string): Promise<void> {
      return run(async () => {
        findTopic(await repo.read(), topicId);
        await syncLinked();
        const links = await linkStore.read();
        const windowId = windowForTopic(links, topicId);
        await repo.update((s) => {
          findTopic(s, topicId).windowId = null;
          return s;
        });
        if (windowId !== null) {
          // Drop its tab links too, so its tabs are no longer recognised as this topic's.
          const tabIds = (await browser.listTabs(windowId)).map((t) => t.id);
          await linkStore.write(unbindWindow(links, windowId, tabIds));
        }
      });
    },

    /** A tab was swapped for a prerendered one: carry its link over to the new id. */
    replaceTab(addedTabId: number, removedTabId: number): Promise<void> {
      return run(async () => {
        const links = await linkStore.read();
        const savedId = links.tabs[String(removedTabId)];
        if (savedId === undefined) return;
        const tabs = { ...links.tabs, [String(addedTabId)]: savedId };
        delete tabs[String(removedTabId)];
        await linkStore.write({ ...links, tabs });
      });
    },

    /**
     * Groups saved tabs into a new named section. In an open topic this creates a real tab
     * group (the sync then records the section); in a closed one it edits the saved topic.
     */
    groupTabs(topicId: string, savedTabIds: string[], name: string): Promise<void> {
      return run(async () => {
        const sectionName = name.trim();
        if (!sectionName) throw new UserError('Give the section a name.');
        if (sectionName.length > 200)
          throw new UserError('Section names are limited to 200 characters.');
        const topic = findTopic(await repo.read(), topicId);
        const wanted = new Set(savedTabIds);
        const chosen = topic.tabs.filter((t) => wanted.has(t.id) && !t.pinned);
        if (chosen.length === 0) throw new UserError('Choose at least one unpinned tab.');
        await syncLinked();
        const links = await linkStore.read();
        const windowId = await liveWindowFor(links, topicId);
        if (windowId !== null) {
          const live = liveTabIds(
            links,
            chosen.map((t) => t.id),
          );
          if (live.length === 0) throw new UserError('Those tabs are no longer open.');
          await browser.groupTabs(windowId, { tabIds: live, title: sectionName });
          await syncLinked();
          return;
        }
        const sectionId = newId();
        await repo.update((s) => {
          const t = findTopic(s, topicId);
          t.sections = [...t.sections, { id: sectionId, name: sectionName }];
          for (const tab of t.tabs)
            if (wanted.has(tab.id) && !tab.pinned) tab.sectionId = sectionId;
          t.updatedAt = now();
          return s;
        });
      });
    },

    /** Removes a section; its tabs stay in the topic, ungrouped. */
    ungroupSection(topicId: string, sectionId: string): Promise<void> {
      return run(async () => {
        const topic = findTopic(await repo.read(), topicId);
        if (!topic.sections.some((s) => s.id === sectionId))
          throw new UserError('Section not found.');
        await syncLinked();
        const links = await linkStore.read();
        const windowId = await liveWindowFor(links, topicId);
        if (windowId !== null) {
          const current = findTopic(await repo.read(), topicId);
          const live = liveTabIds(
            links,
            current.tabs.filter((t) => t.sectionId === sectionId).map((t) => t.id),
          );
          if (live.length) await browser.ungroupTabs(live);
          await syncLinked();
        }
        await repo.update((s) => {
          const t = findTopic(s, topicId);
          t.sections = t.sections.filter((x) => x.id !== sectionId);
          for (const tab of t.tabs) if (tab.sectionId === sectionId) delete tab.sectionId;
          t.updatedAt = now();
          return s;
        });
      });
    },

    /** Moves a saved tab to another topic, moving or opening the live tab as needed. */
    moveTab(fromTopicId: string, savedTabId: string, toTopicId: string): Promise<void> {
      return run(async () => {
        if (fromTopicId === toTopicId) throw new UserError('The tab is already in that topic.');
        const store = await repo.read();
        const tab = findTopic(store, fromTopicId).tabs.find((t) => t.id === savedTabId);
        if (!tab) throw new UserError('Tab not found.');
        findTopic(store, toTopicId);
        const links = await linkStore.read();
        const fromWindow = await liveWindowFor(links, fromTopicId);
        const toWindow = await liveWindowFor(links, toTopicId);
        const [liveId] = fromWindow === null ? [] : liveTabIds(links, [savedTabId]);

        if (liveId !== undefined && toWindow !== null) {
          // Both open: move the real tab; the sync hands it over, keeping its id.
          await browser.moveTabs([liveId], toWindow, -1);
          await syncLinked();
          return;
        }
        const moved: SavedTab = { ...tab };
        delete moved.sectionId;
        // Open the tab in the target window first: if the browser refuses, nothing has moved.
        const created =
          toWindow === null
            ? undefined
            : await browser.createTab(toWindow, { url: moved.url, pinned: moved.pinned });
        const tabs = { ...links.tabs };
        if (liveId !== undefined) delete tabs[String(liveId)];
        if (created !== undefined) tabs[String(created)] = moved.id;
        try {
          await repo.update((s) => {
            const from = findTopic(s, fromTopicId);
            const to = findTopic(s, toTopicId);
            from.tabs = from.tabs.filter((t) => t.id !== savedTabId);
            to.tabs = [...to.tabs, moved];
            from.updatedAt = to.updatedAt = now();
            return s;
          });
        } catch (e) {
          if (created !== undefined) await browser.removeTabs([created]).catch(() => undefined);
          throw e;
        }
        await linkStore.write({ ...links, tabs });
        // The source topic no longer holds the tab, so closing it is not a "recently closed".
        if (liveId !== undefined) {
          try {
            await browser.removeTabs([liveId]);
          } catch {
            throw new UserError('The tab moved, but its old copy could not be closed.');
          }
        }
      });
    },

    /** Periodic upkeep: expire old Recently closed entries and trash, then sync. */
    maintenance(): Promise<void> {
      return run(async () => {
        await repo.update((s) => pruneExpired(s, now()));
        await syncLinked();
        await autoParkInQueue({});
        await discardIdle();
      });
    },

    /**
     * Parks idle tabs (see selectIdleTabs): a topic's tab moves to that topic's Parked list,
     * any other tab to the unsorted Parked list, then the browser tab is closed. A dry run, or
     * the dry-run setting, only reports what would be parked. `at` overrides the clock.
     */
    autoPark(options: { dryRun?: boolean; at?: number } = {}): Promise<AutoParkResult> {
      return run(() => autoParkInQueue(options));
    },

    /** Reopens a tab from the unsorted Parked list in the given window, or a new one. */
    restoreUnsorted(savedTabId: string, windowId?: number): Promise<void> {
      return run(async () => {
        const store = await repo.read();
        const entry = store.unsortedParked.find((t) => t.id === savedTabId);
        if (!entry) throw new UserError('Tab not found.');
        await openParked([entry], windowId);
        await repo.update((s) => {
          s.unsortedParked = s.unsortedParked.filter((t) => t.id !== savedTabId);
          return s;
        });
      });
    },

    /** Brings back every parked tab of a topic, or of the unsorted list when topicId is null. */
    restoreAllParked(topicId: string | null, windowId?: number): Promise<{ restored: number }> {
      return run(async () => {
        const store = await repo.read();
        if (topicId === null) {
          const entries = store.unsortedParked;
          if (entries.length === 0) return { restored: 0 };
          await openParked(entries, windowId);
          const ids = new Set(entries.map((t) => t.id));
          await repo.update((s) => {
            s.unsortedParked = s.unsortedParked.filter((t) => !ids.has(t.id));
            return s;
          });
          return { restored: entries.length };
        }
        const topic = findTopic(store, topicId);
        const entries = topic.parked;
        if (entries.length === 0) return { restored: 0 };
        const links = await linkStore.read();
        const open = await liveWindowFor(links, topicId);
        const tabLinks: Record<string, string> = {};
        if (open !== null) {
          for (const t of entries) {
            const tabId = await browser.createTab(open, { url: t.url, pinned: t.pinned });
            tabLinks[String(tabId)] = t.id;
          }
          await linkStore.write({ ...links, tabs: { ...links.tabs, ...tabLinks } });
        }
        const ids = new Set(entries.map((t) => t.id));
        const at = now();
        await repo.update((s) => {
          const t = findTopic(s, topicId);
          const back = t.parked.filter((p) => ids.has(p.id)).map((p) => unpark(p, at));
          t.parked = t.parked.filter((p) => !ids.has(p.id));
          t.tabs = [...t.tabs.filter((x) => !ids.has(x.id)), ...back];
          t.updatedAt = at;
          return s;
        });
        return { restored: entries.length };
      });
    },

    updateSettings(patch: { autoParkDays?: number; autoParkMode?: AutoParkMode }): Promise<void> {
      return run(async () => {
        if (
          patch.autoParkDays !== undefined &&
          (!Number.isInteger(patch.autoParkDays) ||
            patch.autoParkDays < 1 ||
            patch.autoParkDays > 365)
        ) {
          throw new UserError('Choose between 1 and 365 days.');
        }
        await repo.update((s) => {
          s.settings = { ...s.settings, ...patch };
          return s;
        });
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
