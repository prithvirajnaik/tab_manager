import {
  createLinkStore,
  emptyLinks,
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
      parseLinks({ windows: { 1: 't', 2: 3 }, tabs: [], closing: [4, 'x'], reconciledAt: 9 }),
    ).toEqual({
      windows: { 1: 't' },
      tabs: {},
      groups: {},
      closing: [4],
      reconciledAt: 9,
      deletedFrom: {},
    });
    expect(parseLinks({ deletedFrom: { a: 3, b: 'x' } }).deletedFrom).toEqual({ a: 3 });
  });

  it('finds the window bound to a topic', () => {
    const links = { ...emptyLinks(), windows: { 5: 'a', 6: 'b' } };
    expect(windowForTopic(links, 'b')).toBe(6);
    expect(windowForTopic(links, 'c')).toBeNull();
  });

  it('unbinds a window, its tabs and its closing flag', () => {
    const links = {
      ...emptyLinks(),
      windows: { 5: 'a' },
      tabs: { 1: 's1', 2: 's2' },
      closing: [5],
    };
    expect(unbindWindow(links, 5, [1])).toMatchObject({
      windows: {},
      tabs: { 2: 's2' },
      closing: [],
    });
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
