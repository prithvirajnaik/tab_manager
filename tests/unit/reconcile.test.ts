import { reconcileTopic } from '../../src/core/reconcile';
import type { LiveTab } from '../../src/core/ports';
import { RECENTLY_CLOSED_DAYS } from '../../src/core/model';
import { savedTab, topic } from './factories';

const NOW = 10_000_000;
const OWN = 'chrome-extension://abc/newtab.html';
let n = 0;
const newId = () => `new-${++n}`;

function live(id: number, url: string, extra: Partial<LiveTab> = {}): LiveTab {
  return {
    id,
    windowId: 1,
    index: 0,
    url,
    title: url,
    pinned: false,
    active: false,
    audible: false,
    discarded: false,
    groupId: -1,
    ...extra,
  };
}

const opts = (tabLinks: Record<string, string> = {}, extra = {}) => ({
  now: NOW,
  newId,
  ownNewTabUrl: OWN,
  tabLinks,
  elsewhere: new Set<string>(),
  ...extra,
});

describe('reconcileTopic', () => {
  it('follows linked tabs through navigation and reorders to match the window', () => {
    const a = savedTab({ id: 'a', url: 'https://a/' });
    const b = savedTab({ id: 'b', url: 'https://b/' });
    const t = topic({ tabs: [a, b] });
    const { topic: next, tabLinks } = reconcileTopic(
      t,
      [live(2, 'https://b2/', { index: 0 }), live(1, 'https://a/', { index: 1 })],
      opts({ 1: 'a', 2: 'b' }),
    );
    expect(next.tabs.map((x) => [x.id, x.url])).toEqual([
      ['b', 'https://b2/'],
      ['a', 'https://a/'],
    ]);
    expect(tabLinks).toEqual({ 1: 'a', 2: 'b' });
    expect(next.recentlyClosed).toEqual([]);
  });

  it('adds new tabs and skips new tab pages and blocked schemes', () => {
    const t = topic();
    const { topic: next } = reconcileTopic(
      t,
      [
        live(1, 'https://x/'),
        live(2, 'chrome://newtab/'),
        live(3, `${OWN}#x`),
        live(4, 'javascript:void(0)'),
      ],
      opts(),
    );
    expect(next.tabs.map((x) => x.url)).toEqual(['https://x/']);
  });

  it('moves tabs missing from the window to recently closed, never dropping them', () => {
    const a = savedTab({ id: 'a' });
    const b = savedTab({ id: 'b' });
    const { topic: next } = reconcileTopic(
      topic({ tabs: [a, b] }),
      [live(1, a.url)],
      opts({ 1: 'a' }),
    );
    expect(next.tabs.map((x) => x.id)).toEqual(['a']);
    expect(next.recentlyClosed).toEqual([{ ...b, closedAt: NOW }]);
  });

  it('does not put a tab in recently closed when it moved to another linked window', () => {
    const a = savedTab({ id: 'a' });
    const { topic: next } = reconcileTopic(
      topic({ tabs: [a] }),
      [],
      opts({}, { elsewhere: new Set(['a']) }),
    );
    expect(next.tabs).toEqual([]);
    expect(next.recentlyClosed).toEqual([]);
  });

  it('matches unlinked live tabs to saved tabs by URL (after a restart)', () => {
    const a = savedTab({ id: 'a', url: 'https://a/', pinned: true, lastActiveAt: 5 });
    const b = savedTab({ id: 'b', url: 'https://a/' });
    const { topic: next, tabLinks } = reconcileTopic(
      topic({ tabs: [a, b] }),
      [live(9, 'https://a/', { pinned: true }), live(10, 'https://a/', { index: 1 })],
      opts(),
    );
    expect(next.tabs.map((x) => x.id)).toEqual(['a', 'b']);
    expect(tabLinks).toEqual({ 9: 'a', 10: 'b' });
    expect(next.tabs[0]?.lastActiveAt).toBe(5);
  });

  it('adopts a tab that arrived from another topic with its saved id', () => {
    const foreign = savedTab({ id: 'f', sectionId: 'other-section', lastActiveAt: 42 });
    const { topic: next } = reconcileTopic(
      topic(),
      [live(3, foreign.url)],
      opts({ 3: 'f' }, { foreign: new Map([['f', foreign]]) }),
    );
    expect(next.tabs[0]).toMatchObject({ id: 'f', lastActiveAt: 42 });
    expect(next.tabs[0]?.sectionId).toBeUndefined();
  });

  it('expires recently closed entries after 30 days', () => {
    const day = 86_400_000;
    const old = { ...savedTab(), closedAt: NOW - RECENTLY_CLOSED_DAYS * day - 1 };
    const fresh = { ...savedTab(), closedAt: NOW - day };
    const { topic: next } = reconcileTopic(topic({ recentlyClosed: [old, fresh] }), [], opts());
    expect(next.recentlyClosed).toEqual([fresh]);
  });

  it('leaves updatedAt alone when nothing changed', () => {
    const a = savedTab({ id: 'a', url: 'https://a/', title: 'https://a/', lastActiveAt: 7 });
    const t = topic({ tabs: [a], updatedAt: 1 });
    const { topic: next, changed } = reconcileTopic(t, [live(1, 'https://a/')], opts({ 1: 'a' }));
    expect(changed).toBe(false);
    expect(next.updatedAt).toBe(1);
  });
});
