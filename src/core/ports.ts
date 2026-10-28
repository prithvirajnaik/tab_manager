import type { SectionColor } from './model';

/** A storage area such as chrome.storage.local, reduced to what the core needs. */
export type KeyValueArea = {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

export type Clock = () => number;

/** Browser tab state as the core sees it. `groupId` is -1 when the tab is not grouped. */
export type LiveTab = {
  id: number;
  windowId: number;
  index: number;
  url: string;
  title: string;
  favIconUrl?: string;
  pinned: boolean;
  active: boolean;
  audible: boolean;
  discarded: boolean;
  groupId: number;
  lastAccessed?: number;
  openerTabId?: number;
};

export type LiveGroup = {
  id: number;
  windowId: number;
  title: string;
  color: SectionColor;
  collapsed: boolean;
};

export type NewTab = { url: string; pinned: boolean };

export type GroupSpec = {
  tabIds: number[];
  title: string;
  color?: SectionColor;
  collapsed?: boolean;
};

/** Everything the core asks of the browser. Implemented by src/adapters/browser.ts. */
export type BrowserPort = {
  /** Ids of open normal (non-popup, non-incognito) windows. */
  listWindowIds(): Promise<number[]>;
  /** Tabs of normal windows, ordered by window then index. */
  listTabs(windowId?: number): Promise<LiveTab[]>;
  listGroups(windowId?: number): Promise<LiveGroup[]>;
  /** Opens a focused window with the tabs in order; returns the window and new tab ids. */
  createWindow(tabs: NewTab[]): Promise<{ windowId: number; tabIds: number[] }>;
  createTab(windowId: number, tab: NewTab & { index?: number }): Promise<number>;
  removeTabs(tabIds: number[]): Promise<void>;
  removeWindow(windowId: number): Promise<void>;
  focusWindow(windowId: number): Promise<void>;
  groupTabs(windowId: number, spec: GroupSpec): Promise<number>;
  ungroupTabs(tabIds: number[]): Promise<void>;
  moveTabs(tabIds: number[], windowId: number, index: number): Promise<void>;
  discardTabs(tabIds: number[]): Promise<void>;
};
