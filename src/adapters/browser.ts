import type { SectionColor } from '../core/model';
import type { BrowserPort, KeyValueArea, LiveGroup, LiveTab } from '../core/ports';

/** The only module that touches chrome.tabs / windows / tabGroups. */

function toLiveTab(t: chrome.tabs.Tab): LiveTab | null {
  if (t.id === undefined || t.id === chrome.tabs.TAB_ID_NONE || t.incognito) return null;
  const tab: LiveTab = {
    id: t.id,
    windowId: t.windowId,
    index: t.index,
    url: t.url || t.pendingUrl || '',
    title: t.title ?? '',
    pinned: t.pinned,
    active: t.active,
    audible: t.audible ?? false,
    discarded: t.discarded,
    groupId: t.groupId,
  };
  if (t.favIconUrl) tab.favIconUrl = t.favIconUrl;
  if (t.lastAccessed !== undefined) tab.lastAccessed = t.lastAccessed;
  if (t.openerTabId !== undefined) tab.openerTabId = t.openerTabId;
  return tab;
}

function toLiveGroup(g: chrome.tabGroups.TabGroup): LiveGroup {
  return {
    id: g.id,
    windowId: g.windowId,
    title: g.title ?? '',
    color: g.color as SectionColor,
    collapsed: g.collapsed,
  };
}

export const chromeBrowser: BrowserPort = {
  async listWindowIds() {
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    return windows.filter((w) => !w.incognito && w.id !== undefined).map((w) => w.id as number);
  },

  async listTabs(windowId) {
    const tabs = await chrome.tabs.query(
      windowId === undefined ? { windowType: 'normal' } : { windowId, windowType: 'normal' },
    );
    return tabs
      .map(toLiveTab)
      .filter((t): t is LiveTab => t !== null)
      .sort((a, b) => a.windowId - b.windowId || a.index - b.index);
  },

  async listGroups(windowId) {
    const groups = await chrome.tabGroups.query(windowId === undefined ? {} : { windowId });
    return groups.map(toLiveGroup);
  },

  async createWindow(tabs) {
    // Start from a blank window and add tabs one by one, so one URL the browser refuses
    // (file: without file access, say) does not stop the rest from opening.
    const win = await chrome.windows.create({ focused: true });
    if (win?.id === undefined) throw new Error('Could not open a window.');
    const windowId = win.id;
    const placeholder = win.tabs?.[0]?.id;
    const tabIds: number[] = [];
    for (const [i, t] of tabs.entries()) {
      try {
        const created = await chrome.tabs.create({
          windowId,
          url: t.url,
          pinned: t.pinned,
          active: i === 0,
        });
        tabIds.push(created.id ?? -1);
      } catch {
        tabIds.push(-1);
      }
    }
    if (placeholder !== undefined && tabIds.some((id) => id !== -1)) {
      await chrome.tabs.remove(placeholder).catch(() => undefined);
    }
    return { windowId, tabIds };
  },

  async createTab(windowId, tab) {
    const created = await chrome.tabs.create({
      windowId,
      url: tab.url,
      pinned: tab.pinned,
      active: false,
      ...(tab.index === undefined ? {} : { index: tab.index }),
    });
    if (created.id === undefined) throw new Error('Could not open the tab.');
    return created.id;
  },

  async removeTabs(tabIds) {
    if (tabIds.length) await chrome.tabs.remove(tabIds);
  },

  async removeWindow(windowId) {
    await chrome.windows.remove(windowId);
  },

  async focusWindow(windowId) {
    await chrome.windows.update(windowId, { focused: true });
  },

  async groupTabs(windowId, spec) {
    const [first, ...rest] = spec.tabIds;
    if (first === undefined) throw new Error('No tabs to group.');
    const groupId = await chrome.tabs.group({
      tabIds: [first, ...rest],
      createProperties: { windowId },
    });
    await chrome.tabGroups.update(groupId, {
      title: spec.title,
      ...(spec.color ? { color: spec.color } : {}),
    });
    // Collapsing can be refused (for example while the group holds the active tab); the
    // title and colour above must not be lost over it.
    if (spec.collapsed !== undefined) {
      await chrome.tabGroups.update(groupId, { collapsed: spec.collapsed }).catch(() => undefined);
    }
    return groupId;
  },

  async ungroupTabs(tabIds) {
    const [first, ...rest] = tabIds;
    if (first !== undefined) await chrome.tabs.ungroup([first, ...rest]);
  },

  async moveTabs(tabIds, windowId, index) {
    if (tabIds.length) await chrome.tabs.move(tabIds, { windowId, index });
  },

  async discardTabs(tabIds) {
    // The browser refuses to discard the active tab; skip failures tab by tab.
    await Promise.all(tabIds.map((id) => chrome.tabs.discard(id).catch(() => undefined)));
  },
};

function area(storage: chrome.storage.StorageArea): KeyValueArea {
  return {
    get: (keys) => storage.get(keys),
    set: (items) => storage.set(items),
  };
}

export const localArea = (): KeyValueArea => area(chrome.storage.local);
export const sessionArea = (): KeyValueArea => area(chrome.storage.session);

export const ownNewTabUrl = (): string => chrome.runtime.getURL('/newtab.html');
