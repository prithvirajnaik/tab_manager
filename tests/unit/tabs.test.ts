import { isSaveable, openOrder, toSavedTab } from '../../src/core/tabs';
import { MAX_TITLE_LENGTH } from '../../src/core/model';
import type { LiveTab } from '../../src/core/ports';

const OWN = 'chrome-extension://abc/newtab.html';
const live = (extra: Partial<LiveTab> = {}): LiveTab => ({
  id: 1,
  windowId: 1,
  index: 0,
  url: 'https://a/',
  title: 'A',
  pinned: false,
  active: false,
  audible: false,
  discarded: false,
  groupId: -1,
  ...extra,
});

describe('isSaveable', () => {
  it.each([
    ['https://a/', true],
    ['chrome://settings/', true],
    ['', false],
    ['about:blank', false],
    ['chrome://newtab/', false],
    ['brave://newtab/', false],
    [OWN, false],
    [`${OWN}?x`, false],
    ['javascript:alert(1)', false],
    ['\u0001javascript:alert(1)', false],
    [`https://a/${'x'.repeat(9000)}`, false],
  ])('%s -> %s', (url, expected) => {
    expect(isSaveable(url, OWN)).toBe(expected);
  });
});

describe('toSavedTab', () => {
  it('truncates long titles and drops oversized favicons', () => {
    const tab = toSavedTab(
      live({ title: 't'.repeat(MAX_TITLE_LENGTH + 10), favIconUrl: `data:${'x'.repeat(9000)}` }),
      's1',
      100,
    );
    expect(tab.title).toHaveLength(MAX_TITLE_LENGTH);
    expect(tab.favIconUrl).toBeUndefined();
  });

  it('keeps the newer of saved and browser times, falling back to now', () => {
    expect(toSavedTab(live({ lastAccessed: 50 }), 's', 100).lastActiveAt).toBe(50);
    expect(toSavedTab(live({ active: true, lastAccessed: 50 }), 's', 100).lastActiveAt).toBe(50);
    const prev = { id: 's', url: 'x', title: 'old', pinned: false, lastActiveAt: 70 };
    expect(toSavedTab(live({ lastAccessed: 50 }), 's', 100, prev).lastActiveAt).toBe(70);
    expect(toSavedTab(live({ lastAccessed: undefined }), 's', 100).lastActiveAt).toBe(100);
  });

  it('falls back to the previous title, then the url, and keeps section and opener', () => {
    const prev = {
      id: 's',
      url: 'x',
      title: 'Old',
      pinned: false,
      lastActiveAt: 1,
      sectionId: 'sec',
      openerTabId: 'o',
      favIconUrl: 'https://a/f.ico',
    };
    const tab = toSavedTab(live({ title: '' }), 's', 100, prev);
    expect(tab).toMatchObject({
      title: 'Old',
      sectionId: 'sec',
      openerTabId: 'o',
      favIconUrl: 'https://a/f.ico',
    });
    expect(toSavedTab(live({ title: '' }), 's', 100).title).toBe('https://a/');
  });
});

describe('openOrder', () => {
  it('puts pinned tabs first and keeps order otherwise', () => {
    const tabs = [
      { id: 1, pinned: false },
      { id: 2, pinned: true },
      { id: 3, pinned: false },
      { id: 4, pinned: true },
    ];
    expect(openOrder(tabs).map((t) => t.id)).toEqual([2, 4, 1, 3]);
  });
});
