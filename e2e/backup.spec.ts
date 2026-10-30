import { expect, openWindow, readStore, send, test } from './fixtures';

type Store = { topics: { id: string; name: string; tabs: { id: string; url: string }[] }[] };

test('export then import adds a copy without touching the original', async ({ ext, site }) => {
  const { windowId } = await openWindow(ext, [{ url: site.url('a') }, { url: site.url('b') }]);
  await send(ext, { type: 'saveWindow', name: 'Backup me', windowId });
  const exported = await send<{ text: string }>(ext, { type: 'exportData' });
  expect(exported.ok).toBe(true);
  const before = await readStore<Store>(ext);

  const imported = await send(ext, { type: 'importData', text: exported.data!.text });
  expect(imported).toEqual({ ok: true, data: { topics: 1, tabs: 2 } });
  const after = await readStore<Store>(ext);
  expect(after.topics).toHaveLength(2);
  expect(after.topics[0]).toEqual(before.topics[0]);
  expect(after.topics[1]!.tabs.map((t) => t.url)).toEqual([site.url('a'), site.url('b')]);
  const ids = after.topics.flatMap((t) => t.tabs.map((x) => x.id));
  expect(new Set(ids).size).toBe(ids.length);

  expect(await send(ext, { type: 'importData', text: '{"not":"an export"}' })).toEqual({
    ok: false,
    error: 'The file is not a Tab Topics export.',
  });
});

test('the recovery panel lists snapshots after a delete', async ({ ext, site }) => {
  const { windowId } = await openWindow(ext, [{ url: site.url('x') }]);
  const saved = await send<{ topicId: string }>(ext, {
    type: 'saveWindow',
    name: 'Oops',
    windowId,
  });
  await send(ext, { type: 'deleteTopic', topicId: saved.data!.topicId });
  await ext.reload();
  await ext.getByRole('link', { name: 'Settings' }).click();
  await expect(ext.getByRole('button', { name: 'Restore deleted topic Oops' })).toBeVisible();
  await ext.getByRole('button', { name: 'Show snapshots' }).click();
  await expect(ext.getByText('1 topic · 1 tab')).toBeVisible();
  await ext.getByRole('button', { name: 'Restore deleted topic Oops' }).click();
  await ext.getByRole('link', { name: /^Topics/ }).click();
  await expect(ext.getByRole('heading', { name: 'Oops' })).toBeVisible();
});
