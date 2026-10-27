import { expect, openWindow, readStore, send, test, windowExists, windowTabs } from './fixtures';

test('save, park and reopen restores the same URLs and pinned state', async ({ ext, site }) => {
  const urls = [site.url('pinned'), site.url('one'), site.url('two')];
  const { windowId } = await openWindow(ext, [
    { url: urls[0]!, pinned: true },
    { url: urls[1]! },
    { url: urls[2]! },
  ]);

  const saved = await send<{ topicId: string }>(ext, { type: 'saveWindow', name: 'E2E', windowId });
  expect(saved.ok).toBe(true);
  const topicId = saved.data!.topicId;

  let store = await readStore(ext);
  expect(store.topics).toHaveLength(1);
  expect(store.topics[0]!.tabs.map((t) => [t.url, t.pinned])).toEqual([
    [urls[0], true],
    [urls[1], false],
    [urls[2], false],
  ]);

  expect(await send(ext, { type: 'parkTopic', topicId })).toEqual({
    ok: true,
    data: { leftOpen: 0 },
  });
  await expect.poll(() => windowExists(ext, windowId)).toBe(false);
  store = await readStore(ext);
  expect(store.topics[0]!.windowId).toBeNull();
  expect(store.topics[0]!.tabs.map((t) => t.url)).toEqual(urls);

  expect(await send(ext, { type: 'openTopic', topicId })).toEqual({
    ok: true,
    data: { failed: 0 },
  });
  store = await readStore(ext);
  const reopened = store.topics[0]!.windowId!;
  expect(reopened).not.toBeNull();
  const tabs = await windowTabs(ext, reopened);
  expect(tabs.map((t) => [t.url, t.pinned])).toEqual([
    [urls[0], true],
    [urls[1], false],
    [urls[2], false],
  ]);
});

test('opening a topic that is already open focuses it instead of duplicating', async ({
  ext,
  site,
}) => {
  const { windowId } = await openWindow(ext, [{ url: site.url('a') }]);
  const saved = await send<{ topicId: string }>(ext, { type: 'saveWindow', name: 'A', windowId });
  const count = () => ext.evaluate(async () => (await chrome.windows.getAll()).length);
  const before = await count();
  expect(await send(ext, { type: 'openTopic', topicId: saved.data!.topicId })).toEqual({
    ok: true,
    data: { failed: 0 },
  });
  expect(await count()).toBe(before);
});

test('closing the window by hand keeps the topic, and it reopens intact', async ({ ext, site }) => {
  const urls = [site.url('x'), site.url('y')];
  const { windowId } = await openWindow(ext, [{ url: urls[0]!, pinned: true }, { url: urls[1]! }]);
  const saved = await send<{ topicId: string }>(ext, { type: 'saveWindow', name: 'X', windowId });
  await ext.evaluate((id) => chrome.windows.remove(id), windowId);
  await expect.poll(() => windowExists(ext, windowId)).toBe(false);

  expect(await send(ext, { type: 'openTopic', topicId: saved.data!.topicId })).toEqual({
    ok: true,
    data: { failed: 0 },
  });
  const store = await readStore(ext);
  const reopened = store.topics[0]!.windowId!;
  expect(reopened).not.toBe(windowId);
  expect((await windowTabs(ext, reopened)).map((t) => [t.url, t.pinned])).toEqual([
    [urls[0], true],
    [urls[1], false],
  ]);
});

test('rejects commands that fail validation', async ({ ext }) => {
  expect(await send(ext, { type: 'openTopic' })).toEqual({ ok: false, error: 'Unknown command.' });
  expect(await send(ext, { type: 'openTopic', topicId: 'missing' })).toEqual({
    ok: false,
    error: 'Topic not found.',
  });
});
