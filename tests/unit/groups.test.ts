import { setup } from './setup';

describe('sections mirrored to tab groups', () => {
  it('records browser tab groups as sections and restores them on reopen', async () => {
    const { browser, service, repo } = setup();
    const { windowId, tabIds } = browser.open(['https://a/', 'https://b/', 'https://c/']);
    const topic = await service.saveWindow(windowId, 'T');
    await browser.groupTabs(windowId, {
      tabIds: [tabIds[1]!, tabIds[2]!],
      title: 'Kanji',
      color: 'red',
    });
    await service.syncAll();

    let t = (await repo.read()).topics[0]!;
    expect(t.sections).toEqual([
      { id: expect.any(String), name: 'Kanji', color: 'red', collapsed: false },
    ]);
    expect(t.tabs.map((x) => x.sectionId)).toEqual([
      undefined,
      t.sections[0]!.id,
      t.sections[0]!.id,
    ]);

    await service.parkTopic(topic.id);
    await service.openTopic(topic.id);
    t = (await repo.read()).topics[0]!;
    const groups = await browser.listGroups(t.windowId!);
    expect(groups.map((g) => [g.title, g.color])).toEqual([['Kanji', 'red']]);
    const live = await browser.listTabs(t.windowId!);
    expect(live.map((x) => x.groupId >= 0)).toEqual([false, true, true]);

    // The reopened groups stay linked to the same section.
    await service.syncAll();
    expect((await repo.read()).topics[0]!.sections.map((s) => s.name)).toEqual(['Kanji']);
  });

  it('a renamed group renames its section; an ungrouped section disappears', async () => {
    const { browser, service, repo } = setup();
    const { windowId, tabIds } = browser.open(['https://a/', 'https://b/']);
    await service.saveWindow(windowId, 'T');
    const gid = await browser.groupTabs(windowId, { tabIds: [tabIds[0]!], title: 'One' });
    await service.syncAll();
    const id = (await repo.read()).topics[0]!.sections[0]!.id;
    browser.groups.get(gid)!.title = 'Renamed';
    await service.syncAll();
    expect((await repo.read()).topics[0]!.sections).toMatchObject([{ id, name: 'Renamed' }]);
    await browser.ungroupTabs([tabIds[0]!]);
    browser.groups.delete(gid);
    await service.syncAll();
    const t = (await repo.read()).topics[0]!;
    expect(t.sections).toEqual([]);
    expect(t.tabs.every((x) => x.sectionId === undefined)).toBe(true);
  });

  it('groupTabs creates a real group in an open topic, and a saved section in a closed one', async () => {
    const { browser, service, repo } = setup();
    const { windowId } = browser.open(['https://a/', 'https://b/']);
    const topic = await service.saveWindow(windowId, 'T');
    const [a, b] = (await repo.read()).topics[0]!.tabs;

    await service.groupTabs(topic.id, [a!.id], 'Open group');
    expect((await browser.listGroups(windowId)).map((g) => g.title)).toEqual(['Open group']);
    expect((await repo.read()).topics[0]!.tabs[0]!.sectionId).toBeDefined();

    await service.parkTopic(topic.id);
    await service.groupTabs(topic.id, [b!.id], 'Closed group');
    const t = (await repo.read()).topics[0]!;
    expect(t.sections.map((s) => s.name)).toEqual(['Open group', 'Closed group']);
    await service.openTopic(topic.id);
    const reopened = (await repo.read()).topics[0]!;
    expect((await browser.listGroups(reopened.windowId!)).map((g) => g.title)).toEqual([
      'Open group',
      'Closed group',
    ]);
  });

  it('ungroupSection keeps the tabs', async () => {
    const { browser, service, repo } = setup();
    const { windowId } = browser.open(['https://a/']);
    const topic = await service.saveWindow(windowId, 'T');
    const [a] = (await repo.read()).topics[0]!.tabs;
    await service.groupTabs(topic.id, [a!.id], 'G');
    const sectionId = (await repo.read()).topics[0]!.sections[0]!.id;
    await service.ungroupSection(topic.id, sectionId);
    const t = (await repo.read()).topics[0]!;
    expect(t.sections).toEqual([]);
    expect(t.tabs.map((x) => x.url)).toEqual(['https://a/']);
    expect(await browser.listGroups(windowId)).toHaveLength(0);
  });

  it('rejects empty section names, pinned-only selections and unknown sections', async () => {
    const { browser, service, repo } = setup();
    const { windowId } = browser.open([{ url: 'https://p/', pinned: true }]);
    const topic = await service.saveWindow(windowId, 'T');
    const [p] = (await repo.read()).topics[0]!.tabs;
    await expect(service.groupTabs(topic.id, [p!.id], ' ')).rejects.toThrow(/name/);
    await expect(service.groupTabs(topic.id, [p!.id], 'G')).rejects.toThrow(/unpinned/);
    await expect(service.ungroupSection(topic.id, 'nope')).rejects.toThrow(/not found/);
  });
});

describe('moveTab', () => {
  async function two(openA: boolean, openB: boolean) {
    const ctx = setup();
    const a = ctx.browser.open(['https://a1/', 'https://a2/']);
    const b = ctx.browser.open(['https://b1/']);
    const ta = await ctx.service.saveWindow(a.windowId, 'A');
    const tb = await ctx.service.saveWindow(b.windowId, 'B');
    if (!openA) await ctx.service.parkTopic(ta.id);
    if (!openB) await ctx.service.parkTopic(tb.id);
    const moving = (await ctx.repo.read()).topics[0]!.tabs[1]!;
    return { ...ctx, ta, tb, moving };
  }
  const urls = async (repo: Awaited<ReturnType<typeof two>>['repo']) =>
    (await repo.read()).topics.map((t) => [t.tabs.map((x) => x.url), t.recentlyClosed.length]);

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])('moves between topics (source open: %s, target open: %s)', async (openA, openB) => {
    const { service, repo, ta, tb, moving, browser } = await two(openA, openB);
    await service.moveTab(ta.id, moving.id, tb.id);
    await service.syncAll();
    expect(await urls(repo)).toEqual([
      [['https://a1/'], 0],
      [['https://b1/', 'https://a2/'], 0],
    ]);
    const target = (await repo.read()).topics[1]!;
    expect(target.tabs[1]!.id).toBe(moving.id);
    if (openB) {
      expect((await browser.listTabs(target.windowId!)).map((t) => t.url)).toEqual([
        'https://b1/',
        'https://a2/',
      ]);
    }
  });

  it('rejects moving to the same topic or an unknown tab', async () => {
    const { service, ta, tb, moving } = await two(false, false);
    await expect(service.moveTab(ta.id, moving.id, ta.id)).rejects.toThrow(/already/);
    await expect(service.moveTab(ta.id, 'nope', tb.id)).rejects.toThrow(/not found/);
  });
});
