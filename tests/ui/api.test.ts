import { loadStore, parseStore } from '../../src/ui/api';
import { emptyStore } from '../../src/core/model';

describe('loadStore', () => {
  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('reads storage exactly once', async () => {
    const get = vi.fn(async () => ({ store: emptyStore() }));
    (globalThis as { chrome?: unknown }).chrome = { storage: { local: { get } } };
    expect(await loadStore()).toEqual({ ok: true, store: emptyStore() });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('store');
  });
});

describe('parseStore', () => {
  it('returns an error result for unreadable data', () => {
    expect(parseStore({ schemaVersion: 99 })).toMatchObject({ ok: false });
  });
});
