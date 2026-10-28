import { selectIdleTabs } from '../../src/core/autopark';
import type { LiveTab } from '../../src/core/ports';

const DAY = 86_400_000;
const NOW = 100 * DAY;
const OWN = 'chrome-extension://abc/newtab.html';

let id = 0;
function live(extra: Partial<LiveTab> = {}): LiveTab {
  id += 1;
  return {
    id,
    windowId: 1,
    index: 0,
    url: `https://site/${id}`,
    title: 't',
    pinned: false,
    active: false,
    audible: false,
    discarded: false,
    groupId: -1,
    lastAccessed: NOW - 20 * DAY,
    ...extra,
  };
}

const rule = (tabs: LiveTab[], extra: Partial<Parameters<typeof selectIdleTabs>[0]> = {}) =>
  selectIdleTabs({
    tabs,
    now: NOW,
    days: 14,
    ownNewTabUrl: OWN,
    savedActivity: new Map(),
    skipWindows: new Set(),
    ...extra,
  }).map((t) => t.id);

describe('selectIdleTabs', () => {
  it('selects tabs idle for at least the configured days', () => {
    const idle = live({ lastAccessed: NOW - 14 * DAY });
    const fresh = live({ lastAccessed: NOW - 14 * DAY + 1 });
    expect(rule([idle, fresh])).toEqual([idle.id]);
  });

  it.each([
    ['pinned', { pinned: true }],
    ['active', { active: true }],
    ['audible', { audible: true }],
    ['a new tab page', { url: 'chrome://newtab/' }],
    ["this extension's page", { url: OWN }],
    ['an unsaveable URL', { url: 'blob:https://x/1' }],
    ['of unknown age', { lastAccessed: undefined }],
  ])('never selects a tab that is %s', (_label, extra) => {
    expect(rule([live(extra as Partial<LiveTab>)])).toEqual([]);
  });

  it('uses the newer of the browser time and the saved time', () => {
    const tab = live({ lastAccessed: NOW - 30 * DAY });
    expect(rule([tab], { savedActivity: new Map([[tab.id, NOW - DAY]]) })).toEqual([]);
    const unknown = live({ lastAccessed: undefined });
    expect(rule([unknown], { savedActivity: new Map([[unknown.id, NOW - 20 * DAY]]) })).toEqual([
      unknown.id,
    ]);
  });

  it('skips windows that are closing or still being restored', () => {
    expect(rule([live({ windowId: 9 })], { skipWindows: new Set([9]) })).toEqual([]);
  });

  it('respects a different threshold', () => {
    const tab = live({ lastAccessed: NOW - 3 * DAY });
    expect(rule([tab], { days: 3 })).toEqual([tab.id]);
    expect(rule([tab], { days: 4 })).toEqual([]);
  });
});
