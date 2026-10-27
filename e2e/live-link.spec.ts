import { expect, openWindow, readStore, send, test, windowExists } from './fixtures';

type Store = {
  topics: {
    windowId: number | null;
    tabs: { url: string }[];
    recentlyClosed: { url: string }[];
  }[];
};

test('a saved window stays in sync as tabs are added, moved and closed', async ({ ext, site }) => {
  const { windowId, tabIds } = await openWindow(ext, [
    { url: site.url('a') },
    { url: site.url('b') },
  ]);
  const saved = await send<{ topicId: string }>(ext, {
    type: 'saveWindow',
    name: 'Live',
    windowId,
  });
  expect(saved.ok).toBe(true);
  const topic = async () => (await readStore<Store>(ext)).topics[0]!;

  // Add
  const added = await ext.evaluate(
    async ({ w, url }) => (await chrome.tabs.create({ windowId: w, url, active: false })).id!,
    { w: windowId, url: site.url('c') },
  );
  await expect
    .poll(async () => (await topic()).tabs.map((t) => t.url))
    .toEqual([site.url('a'), site.url('b'), site.url('c')]);

  // Move
  await ext.evaluate((id) => chrome.tabs.move(id, { index: 0 }), added);
  await expect
    .poll(async () => (await topic()).tabs.map((t) => t.url))
    .toEqual([site.url('c'), site.url('a'), site.url('b')]);

  // Close one tab: it goes to Recently closed, not away.
  await ext.evaluate((id) => chrome.tabs.remove(id), tabIds[1]!);
  await expect
    .poll(async () => (await topic()).recentlyClosed.map((t) => t.url))
    .toEqual([site.url('b')]);
  expect((await topic()).tabs.map((t) => t.url)).toEqual([site.url('c'), site.url('a')]);

  // Close the whole window: the topic keeps its tabs and is no longer open.
  await ext.evaluate((id) => chrome.windows.remove(id), windowId);
  await expect.poll(() => windowExists(ext, windowId)).toBe(false);
  await expect.poll(async () => (await topic()).windowId).toBeNull();
  expect((await topic()).tabs.map((t) => t.url)).toEqual([site.url('c'), site.url('a')]);
  expect((await topic()).recentlyClosed.map((t) => t.url)).toEqual([site.url('b')]);
});

test('restoring a recently closed tab reopens it in the topic window', async ({ ext, site }) => {
  const { windowId, tabIds } = await openWindow(ext, [
    { url: site.url('x') },
    { url: site.url('y') },
  ]);
  const saved = await send<{ topicId: string }>(ext, { type: 'saveWindow', name: 'R', windowId });
  await ext.evaluate((id) => chrome.tabs.remove(id), tabIds[1]!);
  await expect
    .poll(
      async () =>
        (await readStore<Store & { topics: { recentlyClosed: { id: string }[] }[] }>(ext))
          .topics[0]!.recentlyClosed.length,
    )
    .toBe(1);
  const store = await readStore<{ topics: { recentlyClosed: { id: string }[] }[] }>(ext);
  const closedId = store.topics[0]!.recentlyClosed[0]!.id;
  expect(
    await send(ext, {
      type: 'restoreTab',
      topicId: saved.data!.topicId,
      tabId: closedId,
      from: 'recentlyClosed',
    }),
  ).toEqual({ ok: true });
  await expect
    .poll(() =>
      ext.evaluate(
        async (w) => (await chrome.tabs.query({ windowId: w })).map((t) => t.url || t.pendingUrl),
        windowId,
      ),
    )
    .toEqual([site.url('x'), site.url('y')]);
});
