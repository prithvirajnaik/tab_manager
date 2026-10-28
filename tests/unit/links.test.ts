import {
  CLOSING_TTL_MS,
  createLinkStore,
  emptyLinks,
  isClosing,
  parseLinks,
  unbindWindow,
  windowForTopic,
  LINKS_KEY,
} from '../../src/core/links';
import { memoryKv } from './memoryKv';

describe('links', () => {
  it('parses garbage as empty and drops malformed entries', () => {
    expect(parseLinks(undefined)).toEqual(emptyLinks());
    expect(parseLinks('x')).toEqual(emptyLinks());
    expect(
      parseLinks({
        windows: { 1: 't', 2: 3 },
        tabs: [],
        closing: { 4: 100, 5: 'x' },
        merging: [7, 'x'],
        recentCloses: [
          { windowId: 1, topicId: 't', ids: ['a'], order: ['a'], at: 5 },
          { windowId: 'bad' },
        ],
        reconciledAt: 9,
        relinkDone: true,
      }),
    ).toEqual({
      windows: { 1: 't' },
      tabs: {},
      groups: {},
      closing: { 4: 100 },
      merging: [7],
      recentCloses: [{ windowId: 1, topicId: 't', ids: ['a'], order: ['a'], at: 5 }],
      reconciledAt: 9,
      relinkDone: true,
      deletedFrom: {},
    });
    expect(parseLinks({ deletedFrom: { a: 3, b: 'x' } }).deletedFrom).toEqual({ a: 3 });
    // The phase-2 array form of `closing` reads as empty.
    expect(parseLinks({ closing: [4] }).closing).toEqual({});
  });

  it('finds the window bound to a topic', () => {
    const links = { ...emptyLinks(), windows: { 5: 'a', 6: 'b' } };
    expect(windowForTopic(links, 'b')).toBe(6);
    expect(windowForTopic(links, 'c')).toBeNull();
  });

  it('unbinds a window, its tabs, its closing flag and merging state', () => {
    const links = {
      ...emptyLinks(),
      windows: { 5: 'a' },
      tabs: { 1: 's1', 2: 's2' },
      closing: { 5: 1 },
      merging: [5, 6],
    };
    expect(unbindWindow(links, 5, [1])).toMatchObject({
      windows: {},
      tabs: { 2: 's2' },
      closing: {},
      merging: [6],
    });
  });

  it('treats a closing flag as stale after the TTL (a cancelled close)', () => {
    const links = { ...emptyLinks(), closing: { 5: 1000 } };
    expect(isClosing(links, 5, 1000 + CLOSING_TTL_MS - 1)).toBe(true);
    expect(isClosing(links, 5, 1000 + CLOSING_TTL_MS)).toBe(false);
    expect(isClosing(links, 6, 1000)).toBe(false);
  });

  it('round-trips through a storage area', async () => {
    const kv = memoryKv();
    const store = createLinkStore(kv);
    const links = { ...emptyLinks(), windows: { 1: 't' } };
    await store.write(links);
    expect(kv.data[LINKS_KEY]).toEqual(links);
    expect(await store.read()).toEqual(links);
  });
});
