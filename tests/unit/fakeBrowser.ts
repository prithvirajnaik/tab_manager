import type { BrowserPort, GroupSpec, LiveGroup, LiveTab, NewTab } from '../../src/core/ports';

type FakeTab = Omit<LiveTab, 'index'>;

/**
 * In-memory browser with the same ordering and pinning rules the core relies on:
 * windows hold ordered tabs, pinned tabs sit first, removing the last tab closes the window.
 */
export class FakeBrowser implements BrowserPort {
  private nextId = 100;
  windows = new Map<number, number[]>();
  tabs = new Map<number, FakeTab>();
  groups = new Map<number, LiveGroup>();
  clock = () => 1_000_000;
  calls: string[] = [];

  id() {
    return this.nextId++;
  }

  /** Test helper: open a window with the given URLs (first one active). */
  open(urls: (string | Partial<FakeTab>)[]): { windowId: number; tabIds: number[] } {
    const windowId = this.id();
    this.windows.set(windowId, []);
    const tabIds = urls.map((u, i) =>
      this.addTab(windowId, typeof u === 'string' ? { url: u, active: i === 0 } : u),
    );
    return { windowId, tabIds };
  }

  addTab(windowId: number, props: Partial<FakeTab> & { index?: number }): number {
    const id = this.id();
    const { index, ...rest } = props;
    this.tabs.set(id, {
      id,
      windowId,
      url: 'about:blank',
      title: '',
      pinned: false,
      active: false,
      audible: false,
      discarded: false,
      groupId: -1,
      lastAccessed: this.clock(),
      ...rest,
    });
    const order = this.windows.get(windowId);
    if (!order) throw new Error(`No window ${windowId}`);
    order.splice(index ?? order.length, 0, id);
    this.normalize(windowId);
    return id;
  }

  update(tabId: number, props: Partial<FakeTab>) {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(`No tab ${tabId}`);
    Object.assign(tab, props);
    this.normalize(tab.windowId);
  }

  activate(tabId: number) {
    const tab = this.tabs.get(tabId)!;
    for (const id of this.windows.get(tab.windowId)!) this.tabs.get(id)!.active = id === tabId;
    tab.lastAccessed = this.clock();
  }

  /** Simulates a user closing a tab; returns whether the window closed with it. */
  closeTab(tabId: number): boolean {
    const tab = this.tabs.get(tabId)!;
    const order = this.windows.get(tab.windowId)!;
    order.splice(order.indexOf(tabId), 1);
    this.tabs.delete(tabId);
    if (order.length === 0) {
      this.windows.delete(tab.windowId);
      return true;
    }
    return false;
  }

  closeWindow(windowId: number) {
    for (const id of this.windows.get(windowId) ?? []) this.tabs.delete(id);
    this.windows.delete(windowId);
    for (const [gid, g] of this.groups) if (g.windowId === windowId) this.groups.delete(gid);
  }

  move(tabId: number, windowId: number, index: number) {
    const tab = this.tabs.get(tabId)!;
    const from = this.windows.get(tab.windowId)!;
    from.splice(from.indexOf(tabId), 1);
    if (from.length === 0) this.windows.delete(tab.windowId);
    tab.windowId = windowId;
    const to = this.windows.get(windowId)!;
    to.splice(Math.min(index < 0 ? to.length : index, to.length), 0, tabId);
    this.normalize(windowId);
  }

  private normalize(windowId: number) {
    const order = this.windows.get(windowId);
    if (!order) return;
    const pinned = order.filter((id) => this.tabs.get(id)!.pinned);
    const rest = order.filter((id) => !this.tabs.get(id)!.pinned);
    order.splice(0, order.length, ...pinned, ...rest);
  }

  // BrowserPort

  async listWindowIds() {
    return [...this.windows.keys()];
  }

  async listTabs(windowId?: number): Promise<LiveTab[]> {
    const ids = windowId === undefined ? [...this.windows.keys()] : [windowId];
    return ids.flatMap((w) =>
      (this.windows.get(w) ?? []).map((id, index) => ({ ...this.tabs.get(id)!, index })),
    );
  }

  async listGroups(windowId?: number) {
    return [...this.groups.values()].filter(
      (g) => windowId === undefined || g.windowId === windowId,
    );
  }

  async createWindow(tabs: NewTab[]) {
    this.calls.push(`createWindow(${tabs.length})`);
    const { windowId, tabIds } = this.open(
      tabs.length
        ? tabs.map((t, i) => ({ url: t.url, title: t.url, pinned: t.pinned, active: i === 0 }))
        : [{ url: 'chrome://newtab/', active: true }],
    );
    return { windowId, tabIds: tabs.length ? tabIds : [] };
  }

  async createTab(windowId: number, tab: NewTab & { index?: number }) {
    this.calls.push(`createTab(${windowId})`);
    if (!this.windows.has(windowId)) throw new Error(`No window ${windowId}`);
    return this.addTab(windowId, {
      url: tab.url,
      title: tab.url,
      pinned: tab.pinned,
      index: tab.index,
    });
  }

  async removeTabs(tabIds: number[]) {
    this.calls.push(`removeTabs(${tabIds.join(',')})`);
    for (const id of tabIds) if (this.tabs.has(id)) this.closeTab(id);
  }

  async removeWindow(windowId: number) {
    this.calls.push(`removeWindow(${windowId})`);
    if (!this.windows.has(windowId)) throw new Error(`No window ${windowId}`);
    this.closeWindow(windowId);
  }

  async focusWindow(windowId: number) {
    this.calls.push(`focusWindow(${windowId})`);
    if (!this.windows.has(windowId)) throw new Error(`No window ${windowId}`);
  }

  async groupTabs(windowId: number, spec: GroupSpec) {
    const id = this.id();
    this.groups.set(id, {
      id,
      windowId,
      title: spec.title,
      color: spec.color ?? 'grey',
      collapsed: spec.collapsed ?? false,
    });
    for (const t of spec.tabIds) this.update(t, { groupId: id });
    return id;
  }

  async ungroupTabs(tabIds: number[]) {
    for (const t of tabIds) this.update(t, { groupId: -1 });
  }

  async moveTabs(tabIds: number[], windowId: number, index: number) {
    tabIds.forEach((t, i) => this.move(t, windowId, index < 0 ? -1 : index + i));
  }

  async discardTabs(tabIds: number[]) {
    for (const t of tabIds) {
      const tab = this.tabs.get(t);
      if (tab && !tab.active) tab.discarded = true;
    }
  }
}
