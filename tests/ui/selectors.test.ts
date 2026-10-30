import { defaultSettings } from '../../src/core/model';
import {
  allParked,
  allRecentlyClosed,
  applyOrder,
  autoParkSummary,
  backupStatus,
  counts,
  isMac,
  matchTopics,
  monogram,
  REMIND_AFTER_MS,
  sortTopics,
  topicAccent,
  uniqueSites,
} from '../../src/ui/selectors';
import { savedTab, store, topic } from '../unit/factories';

const closed = (id: string, closedAt: number) => ({ ...savedTab({ id }), closedAt });
const parked = (id: string) => ({ ...savedTab({ id }), parkedAt: 1 });

describe('counts', () => {
  it('is all zero for an empty store', () => {
    expect(counts(store())).toEqual({ topics: 0, tabs: 0, open: 0, recentlyClosed: 0, parked: 0 });
  });

  it('adds up every topic, and parked includes tabs without a topic', () => {
    const s = store({
      topics: [
        topic({ windowId: 1, tabs: [savedTab(), savedTab()], recentlyClosed: [closed('c', 1)] }),
        topic({ tabs: [savedTab()], parked: [parked('p')] }),
      ],
      unsortedParked: [parked('u')],
    });
    expect(counts(s)).toEqual({ topics: 2, tabs: 3, open: 1, recentlyClosed: 1, parked: 2 });
  });
});

describe('backupStatus', () => {
  const now = 100 * 86_400_000;
  it('says nothing when there are no topics', () => {
    expect(backupStatus(null, false, now)).toEqual({ kind: 'none' });
  });
  it('is never, ok, or stale past the reminder window', () => {
    expect(backupStatus(null, true, now)).toEqual({ kind: 'never' });
    expect(backupStatus(now - REMIND_AFTER_MS, true, now)).toEqual({
      kind: 'ok',
      at: now - REMIND_AFTER_MS,
    });
    expect(backupStatus(now - REMIND_AFTER_MS - 1, true, now).kind).toBe('stale');
  });
});

describe('cross-topic lists', () => {
  it('orders recently closed tabs newest first, topics by their latest close', () => {
    const s = store({
      topics: [
        topic({ id: 'a', name: 'A', recentlyClosed: [closed('a1', 5), closed('a2', 9)] }),
        topic({ id: 'b', name: 'B', recentlyClosed: [closed('b1', 20)] }),
        topic({ id: 'c', name: 'C' }),
      ],
    });
    const groups = allRecentlyClosed(s);
    expect(groups.map((g) => g.name)).toEqual(['B', 'A']);
    expect(groups[1]!.tabs.map((t) => t.id)).toEqual(['a2', 'a1']);
  });

  it('lists parked tabs by topic, then the ones without a topic', () => {
    const s = store({
      topics: [topic({ id: 'a', name: 'A', parked: [parked('p')] }), topic({ name: 'Empty' })],
      unsortedParked: [parked('u')],
    });
    expect(allParked(s).map((g) => [g.topicId, g.name, g.tabs.length])).toEqual([
      ['a', 'A', 1],
      [null, 'No topic', 1],
    ]);
    expect(allParked(store())).toEqual([]);
  });
});

describe('sorting', () => {
  const a = topic({ id: 'a', name: 'beta', updatedAt: 1, tabs: [savedTab()] });
  const b = topic({ id: 'b', name: 'Alpha 10', updatedAt: 3, tabs: [] });
  const c = topic({ id: 'c', name: 'alpha 9', updatedAt: 2, tabs: [savedTab(), savedTab()] });
  const ids = (ts: { id: string }[]) => ts.map((t) => t.id);

  it('sorts by creation, name (case-insensitive, numeric), update and size', () => {
    expect(ids(sortTopics([a, b, c], 'created'))).toEqual(['a', 'b', 'c']);
    expect(ids(sortTopics([a, b, c], 'name'))).toEqual(['c', 'b', 'a']);
    expect(ids(sortTopics([a, b, c], 'updated'))).toEqual(['b', 'c', 'a']);
    expect(ids(sortTopics([a, b, c], 'tabs'))).toEqual(['c', 'a', 'b']);
  });

  it('applies a frozen order, new topics first and removed ones dropped', () => {
    const d = topic({ id: 'd' });
    expect(ids(applyOrder([a, c, d], ['c', 'b', 'a']))).toEqual(['d', 'c', 'a']);
  });
});

describe('topic identity', () => {
  it('gives a stable, non-grey accent per id', () => {
    expect(topicAccent('abc')).toBe(topicAccent('abc'));
    const seen = new Set(Array.from({ length: 200 }, (_, i) => topicAccent(`t${i}`)));
    expect(seen.has('grey')).toBe(false);
    expect(seen.size).toBe(8);
    // Short ids differ only in their last characters; they must still spread out.
    const short = new Set(['jp', 'ai', 'rust', 'a', 'b', 'c'].map(topicAccent));
    expect(short.size).toBeGreaterThan(3);
  });

  it('uses the first grapheme of the name', () => {
    expect(monogram('japanese')).toBe('J');
    expect(monogram('  日本語')).toBe('日');
    expect(monogram('👩‍💻 Code')).toBe('👩‍💻');
    expect(monogram('   ')).toBe('?');
  });
});

describe('matchTopics', () => {
  it('matches every word in the name, ignoring case and accents', () => {
    const t = [topic({ name: 'Café Notes' }), topic({ name: 'Rust' })];
    expect(matchTopics(t, 'cafe').map((x) => x.name)).toEqual(['Café Notes']);
    expect(matchTopics(t, 'notes caf').map((x) => x.name)).toEqual(['Café Notes']);
    expect(matchTopics(t, 'cafe rust')).toEqual([]);
    expect(matchTopics(t, '  ')).toEqual([]);
  });
});

describe('labels', () => {
  it('describes each auto-park mode from the settings', () => {
    const s = defaultSettings();
    expect(autoParkSummary({ ...s, autoParkDays: 1 })).toBe(
      'Auto-park is on: tabs idle for 1 day are parked.',
    );
    expect(autoParkSummary({ ...s, autoParkMode: 'dry-run' })).toContain('preview only');
    expect(autoParkSummary({ ...s, autoParkMode: 'off' })).toBe('Auto-park is off.');
  });

  it('detects Mac platforms', () => {
    expect(isMac('macOS')).toBe(true);
    expect(isMac('MacIntel')).toBe(true);
    expect(isMac('Win32')).toBe(false);
    expect(isMac('')).toBe(false);
  });
});

describe('uniqueSites', () => {
  const tabs = (...urls: string[]) => urls.map((url) => ({ url }));

  it('groups tabs by website and counts them, most tabs first', () => {
    const sites = uniqueSites(
      tabs(
        'https://reddit.com/a',
        'https://www.youtube.com/1',
        'https://youtube.com/2',
        'https://youtube.com/3',
        'https://reddit.com/b',
        'https://github.com/x',
      ),
    );
    expect(sites.map((s) => [s.key, s.count])).toEqual([
      ['youtube.com', 3],
      ['reddit.com', 2],
      ['github.com', 1],
    ]);
    // The favicon comes from the first tab of the site.
    expect(sites[0]!.url).toBe('https://www.youtube.com/1');
  });

  it('keeps tab order between sites with the same count', () => {
    expect(uniqueSites(tabs('https://b.test/', 'https://a.test/')).map((s) => s.key)).toEqual([
      'b.test',
      'a.test',
    ]);
  });

  it('keys pages without a host by their protocol, and survives bad URLs', () => {
    const sites = uniqueSites(tabs('file:///a.html', 'file:///b.html', 'not a url'));
    expect(sites.map((s) => [s.key, s.count])).toEqual([
      ['file:', 2],
      ['not a url', 1],
    ]);
    expect(uniqueSites([])).toEqual([]);
  });
});
