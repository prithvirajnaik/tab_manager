import { setup } from './setup';

describe('parkTopic with tabs that cannot be saved', () => {
  it('closes only what it saved and leaves the rest open in an unlinked window', async () => {
    const { browser, service, repo, links } = setup();
    const { windowId } = browser.open(['https://a/', 'chrome://newtab/']);
    const topic = await service.saveWindow(windowId, 'A');
    const blob = browser.addTab(windowId, { url: 'blob:https://a/123' });

    expect(await service.parkTopic(topic.id)).toEqual({ leftOpen: 1 });

    expect(browser.windows.has(windowId)).toBe(true);
    expect((await browser.listTabs(windowId)).map((t) => t.id)).toEqual([blob]);
    const saved = (await repo.read()).topics[0]!;
    expect(saved.windowId).toBeNull();
    expect(saved.tabs.map((t) => t.url)).toEqual(['https://a/']);
    expect((await links.read()).windows[windowId]).toBeUndefined();
  });
});

describe('openTopic when the browser refuses some URLs', () => {
  it('moves tabs that failed to open to Parked, where they do not expire', async () => {
    const { browser, service, repo, links } = setup();
    const { windowId } = browser.open(['https://a/', 'file:///c:/notes.txt']);
    const topic = await service.saveWindow(windowId, 'A');
    await service.parkTopic(topic.id);
    browser.failUrls.add('file:///c:/notes.txt');

    const result = await service.openTopic(topic.id);
    expect(result).toEqual({ failed: 1 });

    const t = (await repo.read()).topics[0]!;
    expect(t.tabs.map((x) => x.url)).toEqual(['https://a/']);
    expect(t.parked.map((x) => x.url)).toEqual(['file:///c:/notes.txt']);
    expect(Object.keys((await links.read()).tabs)).not.toContain('-1');

    await service.syncAll();
    const after = (await repo.read()).topics[0]!;
    expect(after.recentlyClosed).toEqual([]);
    expect(after.parked).toHaveLength(1);
  });
});

describe('syncAll with tabs moving between windows', () => {
  async function twoTopics() {
    const ctx = setup();
    const a = ctx.browser.open(['https://a1/', 'https://a2/']);
    const b = ctx.browser.open(['https://b1/']);
    const ta = await ctx.service.saveWindow(a.windowId, 'A');
    const tb = await ctx.service.saveWindow(b.windowId, 'B');
    return { ...ctx, a, b, ta, tb };
  }

  it('a tab dragged into another linked window moves topics, keeping its id', async () => {
    const { browser, service, repo, a, b } = await twoTopics();
    const movedId = (await repo.read()).topics[0]!.tabs[1]!.id;
    browser.move(a.tabIds[1]!, b.windowId, -1);
    await service.syncAll();
    const [ta, tb] = (await repo.read()).topics;
    expect(ta!.tabs.map((t) => t.url)).toEqual(['https://a1/']);
    expect(ta!.recentlyClosed).toEqual([]);
    expect(tb!.tabs.map((t) => [t.url, t.id])).toEqual([
      ['https://b1/', tb!.tabs[0]!.id],
      ['https://a2/', movedId],
    ]);
  });

  it('a tab dragged into an unlinked window goes to Recently closed', async () => {
    const { browser, service, repo, a } = await twoTopics();
    const plain = browser.open(['https://x/']);
    browser.move(a.tabIds[1]!, plain.windowId, -1);
    await service.syncAll();
    expect((await repo.read()).topics[0]!.recentlyClosed.map((t) => t.url)).toEqual([
      'https://a2/',
    ]);
  });

  it('a tab dragged into a window whose topic no longer exists goes to Recently closed', async () => {
    const { browser, service, repo, a, b, tb } = await twoTopics();
    await repo.update((s) => ({ ...s, topics: s.topics.filter((t) => t.id !== tb.id) }));
    browser.move(a.tabIds[1]!, b.windowId, -1);
    await service.syncAll();
    expect((await repo.read()).topics[0]!.recentlyClosed.map((t) => t.url)).toEqual([
      'https://a2/',
    ]);
  });

  it('a moved tab that navigated somewhere unsaveable goes to Recently closed', async () => {
    const { browser, service, repo, a, b } = await twoTopics();
    browser.move(a.tabIds[1]!, b.windowId, -1);
    browser.update(a.tabIds[1]!, { url: 'blob:https://x/1' });
    await service.syncAll();
    expect((await repo.read()).topics[0]!.recentlyClosed.map((t) => t.url)).toEqual([
      'https://a2/',
    ]);
  });

  it('dragging the last tab out keeps each saved id in exactly one topic', async () => {
    const { browser, service, repo, b } = await twoTopics();
    const solo = browser.open(['https://solo/']);
    await service.saveWindow(solo.windowId, 'Solo');
    browser.move(solo.tabIds[0]!, b.windowId, -1);
    expect(browser.windows.has(solo.windowId)).toBe(false);
    await service.syncAll();
    const topics = (await repo.read()).topics;
    const ids = topics.flatMap((t) => t.tabs.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(topics.find((t) => t.name === 'B')!.tabs.map((t) => t.url)).toContain('https://solo/');
  });

  it('writes nothing when nothing changed, even for tabs with favicons', async () => {
    const { browser, service, local, advance } = setup();
    const { windowId } = browser.open([
      { url: 'https://a/', favIconUrl: 'https://a/f.ico', active: true },
      { url: 'https://b/' },
    ]);
    await service.saveWindow(windowId, 'A');
    await service.syncAll();
    const writes = local.writes;
    advance(60_000);
    await service.syncAll();
    advance(60_000);
    await service.syncAll();
    expect(local.writes).toBe(writes);
  });
});

describe('saveWindow input checks', () => {
  it('rejects a window that does not exist', async () => {
    const { service } = setup();
    await expect(service.saveWindow(999, 'Ghost')).rejects.toThrow(/window/i);
  });
});

describe('parkTopic failure', () => {
  it('leaves the topic saved and unlinked when the window cannot be closed', async () => {
    const { browser, service, repo, links } = setup();
    const { windowId } = browser.open(['https://a/']);
    const topic = await service.saveWindow(windowId, 'A');
    browser.removeWindow = async () => {
      throw new Error('cannot close');
    };
    await expect(service.parkTopic(topic.id)).rejects.toThrow('cannot close');
    const t = (await repo.read()).topics[0]!;
    expect(t.tabs.map((x) => x.url)).toEqual(['https://a/']);
    expect(t.windowId).toBeNull();
    expect((await links.read()).windows[windowId]).toBeUndefined();
  });
});
