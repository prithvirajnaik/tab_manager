import { expect, openWindow, readStore, send, test } from './fixtures';

type Store = {
  topics: {
    id: string;
    windowId: number | null;
    sections: { id: string; name: string; color?: string }[];
    tabs: { id: string; url: string; sectionId?: string }[];
  }[];
};

test('tab groups survive park and reopen', async ({ ext, site }) => {
  const { windowId, tabIds } = await openWindow(ext, [
    { url: site.url('home') },
    { url: site.url('particles') },
    { url: site.url('verbs') },
  ]);
  const saved = await send<{ topicId: string }>(ext, { type: 'saveWindow', name: 'JP', windowId });
  const topicId = saved.data!.topicId;

  await ext.evaluate(
    async ({ ids, w }) => {
      // Without createProperties.windowId, tabs.group moves the tabs into the caller's window.
      const groupId = await chrome.tabs.group({
        tabIds: [ids[1]!, ids[2]!],
        createProperties: { windowId: w },
      });
      await chrome.tabGroups.update(groupId, { title: 'Grammar', color: 'green' });
    },
    { ids: tabIds, w: windowId },
  );

  await expect
    .poll(async () =>
      (await readStore<Store>(ext)).topics[0]!.sections.map((s) => [s.name, s.color]),
    )
    .toEqual([['Grammar', 'green']]);

  expect(await send(ext, { type: 'parkTopic', topicId })).toMatchObject({ ok: true });
  const parked = (await readStore<Store>(ext)).topics[0]!;
  expect(parked.tabs.filter((t) => t.sectionId).map((t) => t.url)).toEqual([
    site.url('particles'),
    site.url('verbs'),
  ]);

  expect(await send(ext, { type: 'openTopic', topicId })).toMatchObject({ ok: true });
  const reopened = (await readStore<Store>(ext)).topics[0]!.windowId!;
  const groups = await ext.evaluate(async (w) => {
    const tabs = await chrome.tabs.query({ windowId: w });
    const gs = await chrome.tabGroups.query({ windowId: w });
    return {
      groups: gs.map((g) => [g.title, g.color]),
      grouped: tabs.map((t) => [t.url || t.pendingUrl, t.groupId !== -1]),
    };
  }, reopened);
  expect(groups.groups).toEqual([['Grammar', 'green']]);
  expect(groups.grouped).toEqual([
    [site.url('home'), false],
    [site.url('particles'), true],
    [site.url('verbs'), true],
  ]);
});

test('search finds tabs across topics from the new tab page', async ({ ext, site }) => {
  const a = await openWindow(ext, [{ url: site.url('Kanji drills') }]);
  await send(ext, { type: 'saveWindow', name: 'Japanese', windowId: a.windowId });
  const b = await openWindow(ext, [{ url: site.url('Rust book') }]);
  await send(ext, { type: 'saveWindow', name: 'Programming', windowId: b.windowId });

  await ext.reload();
  await ext.getByLabel('Search all topics').fill('rust');
  await expect(ext.getByText('1 tab found')).toBeVisible();
  await expect(ext.getByText('Rust book')).toBeVisible();
});
