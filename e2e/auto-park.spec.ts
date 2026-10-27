import { expect, openWindow, readStore, send, test } from './fixtures';

const DAY = 86_400_000;

type Store = {
  topics: { tabs: { url: string }[]; parked: { url: string }[] }[];
  unsortedParked: { url: string }[];
};
type Result = { dryRun: boolean; tabs: { url: string; topicName: string | null }[] };

test('auto-park with an injected clock: dry run, park, restore every tab', async ({
  ext,
  site,
}) => {
  // Each window's first tab is active and so exempt; the second one is idle.
  const topicWin = await openWindow(ext, [{ url: site.url('focus') }, { url: site.url('idle') }]);
  const saved = await send<{ topicId: string }>(ext, {
    type: 'saveWindow',
    name: 'Work',
    windowId: topicWin.windowId,
  });
  await openWindow(ext, [{ url: site.url('loose-a') }, { url: site.url('loose-b') }]);
  const at = Date.now() + 15 * DAY;
  const count = () => ext.evaluate(async () => (await chrome.tabs.query({})).length);
  const before = await count();

  const preview = await send<Result>(ext, { type: 'autoPark', dryRun: true, at });
  expect(preview.ok).toBe(true);
  expect(preview.data!.dryRun).toBe(true);
  expect(preview.data!.tabs.map((t) => [t.url, t.topicName]).sort()).toEqual(
    [
      [site.url('idle'), 'Work'],
      [site.url('loose-b'), null],
    ].sort(),
  );
  expect(await count()).toBe(before);

  const parked = await send<Result>(ext, { type: 'autoPark', dryRun: false, at });
  expect(parked.data!.tabs).toHaveLength(2);
  await expect.poll(count).toBe(before - 2);
  let store = await readStore<Store>(ext);
  expect(store.topics[0]!.parked.map((t) => t.url)).toEqual([site.url('idle')]);
  expect(store.unsortedParked.map((t) => t.url)).toEqual([site.url('loose-b')]);

  expect(await send(ext, { type: 'restoreAllParked', topicId: saved.data!.topicId })).toMatchObject(
    { ok: true, data: { restored: 1, failed: 0 } },
  );
  expect(await send(ext, { type: 'restoreAllParked', topicId: null })).toMatchObject({
    ok: true,
    data: { restored: 1, failed: 0 },
  });
  await expect.poll(count).toBe(before);
  store = await readStore<Store>(ext);
  expect(store.topics[0]!.parked).toEqual([]);
  expect(store.unsortedParked).toEqual([]);
  const urls = await ext.evaluate(async () =>
    (await chrome.tabs.query({})).map((t) => t.url || t.pendingUrl),
  );
  expect(urls).toEqual(expect.arrayContaining([site.url('idle'), site.url('loose-b')]));
});
