import { setup } from './setup';

describe('saveWindow', () => {
  it('saves the window as a linked topic, skipping new tab pages', async () => {
    const { browser, service, repo, links } = setup();
    const { windowId } = browser.open([
      { url: 'https://a/', title: 'A', pinned: true },
      { url: 'chrome-extension://abc/newtab.html' },
      { url: 'https://b/', title: 'B' },
    ]);
    const created = await service.saveWindow(windowId, '  Japanese  ');
    const store = await repo.read();
    expect(store.topics).toHaveLength(1);
    expect(created).toMatchObject({ name: 'Japanese', windowId });
    expect(store.topics[0]?.tabs.map((x) => [x.url, x.pinned])).toEqual([
      ['https://a/', true],
      ['https://b/', false],
    ]);
    expect((await links.read()).windows[windowId]).toBe(created.id);
  });

  it('rejects an empty name and a window that is already linked', async () => {
    const { browser, service } = setup();
    const { windowId } = browser.open(['https://a/']);
    await expect(service.saveWindow(windowId, '   ')).rejects.toThrow(/name/i);
    await service.saveWindow(windowId, 'One');
    await expect(service.saveWindow(windowId, 'Two')).rejects.toThrow(/already/i);
  });
});

describe('openTopic and parkTopic', () => {
  it('parks (saves, then closes) and reopens with the same URLs and pinned state', async () => {
    const { browser, service, repo } = setup();
    const { windowId } = browser.open([
      { url: 'https://pinned/', pinned: true },
      'https://one/',
      'https://two/',
    ]);
    const topic = await service.saveWindow(windowId, 'Work');
    // The user opens another tab before parking: parking captures it.
    browser.addTab(windowId, { url: 'https://three/' });

    await service.parkTopic(topic.id);
    expect(browser.windows.has(windowId)).toBe(false);
    const parked = (await repo.read()).topics[0]!;
    expect(parked.windowId).toBeNull();
    expect(parked.tabs.map((x) => x.url)).toEqual([
      'https://pinned/',
      'https://one/',
      'https://two/',
      'https://three/',
    ]);

    await service.openTopic(topic.id);
    const reopened = (await repo.read()).topics[0]!;
    expect(reopened.windowId).not.toBeNull();
    const tabs = await browser.listTabs(reopened.windowId!);
    expect(tabs.map((x) => [x.url, x.pinned])).toEqual([
      ['https://pinned/', true],
      ['https://one/', false],
      ['https://two/', false],
      ['https://three/', false],
    ]);
  });

  it('focuses the existing window instead of opening a second copy', async () => {
    const { browser, service } = setup();
    const { windowId } = browser.open(['https://a/']);
    const topic = await service.saveWindow(windowId, 'A');
    await service.openTopic(topic.id);
    expect(browser.calls).toContain(`focusWindow(${windowId})`);
    expect(browser.windows.size).toBe(1);
  });

  it('opens a stale-linked topic in a new window when its window is gone', async () => {
    const { browser, service, repo } = setup();
    const { windowId } = browser.open(['https://a/']);
    const topic = await service.saveWindow(windowId, 'A');
    browser.closeWindow(windowId);
    await service.openTopic(topic.id);
    const reopened = (await repo.read()).topics[0]!;
    expect(reopened.windowId).not.toBe(windowId);
    expect(browser.windows.size).toBe(1);
  });

  it('opens an empty topic as a window with a new tab page', async () => {
    const { browser, service, repo } = setup();
    const { windowId } = browser.open(['chrome://newtab/']);
    const topic = await service.saveWindow(windowId, 'Empty');
    await service.parkTopic(topic.id);
    await service.openTopic(topic.id);
    expect((await repo.read()).topics[0]?.windowId).not.toBeNull();
    expect(browser.windows.size).toBe(1);
  });

  it('parking a closed topic only clears its window link', async () => {
    const { browser, service, repo } = setup();
    const { windowId } = browser.open(['https://a/']);
    const topic = await service.saveWindow(windowId, 'A');
    browser.closeWindow(windowId);
    await service.parkTopic(topic.id);
    const t = (await repo.read()).topics[0]!;
    expect(t.windowId).toBeNull();
    expect(t.tabs.map((x) => x.url)).toEqual(['https://a/']);
  });

  it('keeps the saved topic when closing the window fails', async () => {
    const { browser, service, repo } = setup();
    const { windowId } = browser.open(['https://a/']);
    const topic = await service.saveWindow(windowId, 'A');
    browser.removeWindow = async () => {
      throw new Error('cannot close');
    };
    await expect(service.parkTopic(topic.id)).rejects.toThrow('cannot close');
    expect((await repo.read()).topics[0]?.tabs.map((x) => x.url)).toEqual(['https://a/']);
  });

  it('rejects unknown topics', async () => {
    const { service } = setup();
    await expect(service.openTopic('nope')).rejects.toThrow(/not found/i);
    await expect(service.parkTopic('nope')).rejects.toThrow(/not found/i);
  });
});

describe('restoreTab', () => {
  it('restores a recently closed tab into an open topic window', async () => {
    const { browser, service, repo } = setup();
    const { windowId, tabIds } = browser.open(['https://a/', 'https://b/']);
    const topic = await service.saveWindow(windowId, 'A');
    browser.closeTab(tabIds[1]!);
    await service.syncAll();
    const closed = (await repo.read()).topics[0]!.recentlyClosed[0]!;
    expect(closed.url).toBe('https://b/');

    await service.restoreTab(topic.id, closed.id, 'recentlyClosed');
    const t = (await repo.read()).topics[0]!;
    expect(t.recentlyClosed).toEqual([]);
    expect(t.tabs.map((x) => x.url)).toEqual(['https://a/', 'https://b/']);
    expect((await browser.listTabs(windowId)).map((x) => x.url)).toEqual([
      'https://a/',
      'https://b/',
    ]);
  });

  it('restores a parked tab into a closed topic without opening anything', async () => {
    const { browser, service, repo } = setup();
    const { windowId } = browser.open(['https://a/']);
    const topic = await service.saveWindow(windowId, 'A');
    await service.parkTopic(topic.id);
    await repo.update((s) => {
      s.topics[0]!.parked.push({
        id: 'p1',
        url: 'https://p/',
        title: 'P',
        pinned: false,
        lastActiveAt: 1,
        parkedAt: 2,
      });
      return s;
    });
    await service.restoreTab(topic.id, 'p1', 'parked');
    const t = (await repo.read()).topics[0]!;
    expect(t.parked).toEqual([]);
    expect(t.tabs.map((x) => x.url)).toEqual(['https://a/', 'https://p/']);
    expect(browser.windows.size).toBe(0);
  });

  it('rejects an unknown tab', async () => {
    const { browser, service } = setup();
    const { windowId } = browser.open(['https://a/']);
    const topic = await service.saveWindow(windowId, 'A');
    await expect(service.restoreTab(topic.id, 'nope', 'parked')).rejects.toThrow(/not found/i);
  });
});
