import { buildIndex, searchTabs } from '../../src/core/search';
import { savedTab, store, topic } from './factories';

const s = store({
  topics: [
    topic({
      id: 'jp',
      name: 'Japanese',
      tabs: [
        savedTab({ id: 'a', title: 'Jisho: Japanese dictionary', url: 'https://jisho.org/' }),
        savedTab({ id: 'b', title: 'Grammar notes', url: 'https://example.com/japanese-grammar' }),
      ],
      parked: [
        { ...savedTab({ id: 'p', title: 'Old kanji list', url: 'https://k.org/' }), parkedAt: 1 },
      ],
    }),
    topic({
      id: 'code',
      name: 'Programming',
      tabs: [savedTab({ id: 'c', title: 'MDN Web Docs', url: 'https://developer.mozilla.org/' })],
      recentlyClosed: [
        { ...savedTab({ id: 'r', title: 'Japan travel', url: 'https://travel.jp/' }), closedAt: 1 },
      ],
    }),
  ],
});

describe('searchTabs', () => {
  it('returns nothing for an empty query', () => {
    expect(searchTabs(s, '   ')).toEqual([]);
  });

  it('ranks title word-prefix matches above URL-only matches', () => {
    const ids = searchTabs(s, 'japan').map((r) => r.tab.id);
    expect(ids[0]).toBe('a');
    expect(ids).toContain('b');
    expect(ids).toContain('r');
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'));
  });

  it('requires every word to match somewhere', () => {
    expect(searchTabs(s, 'japanese grammar').map((r) => r.tab.id)).toEqual(['b']);
    expect(searchTabs(s, 'japanese zebra')).toEqual([]);
  });

  it('is case and accent insensitive and searches hosts', () => {
    expect(searchTabs(s, 'MOZILLA').map((r) => r.tab.id)).toEqual(['c']);
    expect(searchTabs(s, 'jishō').map((r) => r.tab.id)).toEqual(['a']);
  });

  it('says where each result lives and ranks live tabs above parked and closed', () => {
    expect(searchTabs(s, 'kanji')).toEqual([
      expect.objectContaining({ topicId: 'jp', topicName: 'Japanese', list: 'parked' }),
    ]);
    expect(searchTabs(s, 'travel')[0]).toMatchObject({ topicId: 'code', list: 'recentlyClosed' });
    const same = store({
      topics: [
        topic({
          id: 't',
          tabs: [savedTab({ id: 'open', title: 'Same page' })],
          parked: [{ ...savedTab({ id: 'parked', title: 'Same page' }), parkedAt: 1 }],
          recentlyClosed: [{ ...savedTab({ id: 'closed', title: 'Same page' }), closedAt: 1 }],
        }),
      ],
    });
    expect(searchTabs(same, 'same').map((r) => r.tab.id)).toEqual(['open', 'parked', 'closed']);
  });

  it('finds Japanese words inside titles and keeps Japanese voicing marks distinct', () => {
    const jp = store({
      topics: [
        topic({
          tabs: [
            savedTab({ id: 'g', title: '日本語の文法ガイド' }),
            savedTab({ id: 'k', title: '日本語の文法カイド' }),
          ],
        }),
      ],
    });
    expect(
      searchTabs(jp, '文法')
        .map((r) => r.tab.id)
        .sort(),
    ).toEqual(['g', 'k']);
    expect(searchTabs(jp, 'ガイド').map((r) => r.tab.id)).toEqual(['g']);
  });

  it('finds tabs parked from windows without a topic', () => {
    const withLoose = store({
      ...s,
      unsortedParked: [{ ...savedTab({ id: 'u', title: 'Loose recipe' }), parkedAt: 1 }],
    });
    expect(searchTabs(withLoose, 'recipe')).toEqual([
      expect.objectContaining({ topicId: '', list: 'unsortedParked' }),
    ]);
  });

  it('folds a capital dotted I', () => {
    const t = store({ topics: [topic({ tabs: [savedTab({ id: 'i', title: 'İstanbul' })] })] });
    expect(searchTabs(t, 'istanbul').map((r) => r.tab.id)).toEqual(['i']);
  });

  it('searches a prebuilt index the same as the store', () => {
    expect(searchTabs(buildIndex(s), 'japan')).toEqual(searchTabs(s, 'japan'));
  });

  it('caps the number of results', () => {
    const many = store({
      topics: [topic({ tabs: Array.from({ length: 300 }, () => savedTab({ title: 'same' })) })],
    });
    expect(searchTabs(many, 'same', 50)).toHaveLength(50);
  });
});
