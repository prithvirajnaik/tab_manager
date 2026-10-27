import { matchWindows, pruneExpired } from '../../src/core/startup';
import { RECENTLY_CLOSED_DAYS, TRASH_DAYS } from '../../src/core/model';
import { savedTab, store, topic } from './factories';

const DAY = 86_400_000;
const t = (id: string, urls: string[], windowId: number | null = 1) =>
  topic({ id, windowId, tabs: urls.map((url) => savedTab({ url })) });

describe('matchWindows', () => {
  it('links each window to the previously open topic with the most similar URLs', () => {
    const topics = [
      t('jp', ['https://jisho/', 'https://wanikani/', 'https://nhk/']),
      t('code', ['https://github/', 'https://mdn/']),
    ];
    const windows = [
      { windowId: 20, urls: ['https://github/', 'https://mdn/', 'https://new/'] },
      { windowId: 21, urls: ['https://jisho/', 'https://wanikani/'] },
    ];
    expect(matchWindows(topics, windows)).toEqual(
      new Map([
        [21, 'jp'],
        [20, 'code'],
      ]),
    );
  });

  it('ignores topics that were not open and windows that are too different', () => {
    const topics = [t('closed', ['https://a/', 'https://b/'], null), t('open', ['https://c/'])];
    const windows = [
      { windowId: 1, urls: ['https://a/', 'https://b/'] },
      { windowId: 2, urls: ['https://z/', 'https://y/', 'https://c/'] },
    ];
    expect(matchWindows(topics, windows)).toEqual(new Map());
  });

  it('never links one topic to two windows, nor two topics to one window', () => {
    const topics = [t('a', ['https://x/']), t('b', ['https://x/'])];
    const windows = [
      { windowId: 1, urls: ['https://x/'] },
      { windowId: 2, urls: ['https://x/'] },
      { windowId: 3, urls: ['https://x/'] },
    ];
    const result = matchWindows(topics, windows);
    expect(result.size).toBe(2);
    expect(new Set(result.values())).toEqual(new Set(['a', 'b']));
  });

  it('does not match empty windows to empty topics', () => {
    expect(matchWindows([t('e', [])], [{ windowId: 1, urls: [] }])).toEqual(new Map());
  });
});

describe('pruneExpired', () => {
  it('drops recently closed tabs and trash older than 30 days, keeping parked tabs forever', () => {
    const now = 100 * DAY;
    const old = now - RECENTLY_CLOSED_DAYS * DAY - 1;
    const s = store({
      topics: [
        topic({
          recentlyClosed: [
            { ...savedTab({ id: 'old' }), closedAt: old },
            { ...savedTab({ id: 'new' }), closedAt: now - DAY },
          ],
          parked: [{ ...savedTab({ id: 'p' }), parkedAt: 0 }],
        }),
      ],
      trash: [
        { topic: topic({ id: 'gone' }), deletedAt: now - TRASH_DAYS * DAY - 1 },
        { topic: topic({ id: 'kept' }), deletedAt: now },
      ],
    });
    const next = pruneExpired(s, now);
    expect(next.topics[0]!.recentlyClosed.map((x) => x.id)).toEqual(['new']);
    expect(next.topics[0]!.parked.map((x) => x.id)).toEqual(['p']);
    expect(next.trash.map((e) => e.topic.id)).toEqual(['kept']);
  });

  it('returns the same store object when nothing expired', () => {
    const s = store({ topics: [topic()] });
    expect(pruneExpired(s, 0)).toBe(s);
  });
});
