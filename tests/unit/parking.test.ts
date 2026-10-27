import { setup } from './setup';

const DAY = 86_400_000;

/** A topic window with an active tab, an idle tab and a pinned idle tab, plus an unlinked window. */
async function scene() {
  const ctx = setup();
  const { browser, service } = ctx;
  ctx.advance(100 * DAY);
  const t0 = ctx.now();
  const topicWin = browser.open([
    { url: 'https://active/', active: true, lastAccessed: t0 },
    { url: 'https://idle/', lastAccessed: t0 - 20 * DAY },
    { url: 'https://pinned/', pinned: true, lastAccessed: t0 - 20 * DAY },
    { url: 'https://recent/', lastAccessed: t0 - DAY },
  ]);
  const topic = await service.saveWindow(topicWin.windowId, 'Work');
  const loose = browser.open([
    { url: 'https://loose-active/', active: true, lastAccessed: t0 },
    { url: 'https://loose-idle/', lastAccessed: t0 - 30 * DAY },
    { url: 'https://music/', audible: true, lastAccessed: t0 - 30 * DAY },
  ]);
  return { ...ctx, topic, topicWin, loose };
}

describe('autoPark', () => {
  it('a dry run lists what would be parked and parks nothing', async () => {
    const { service, repo, browser } = await scene();
    const before = (await browser.listTabs()).length;
    const result = await service.autoPark({ dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.tabs.map((t) => [t.url, t.topicName])).toEqual([
      ['https://idle/', 'Work'],
      ['https://loose-idle/', null],
    ]);
    expect((await browser.listTabs()).length).toBe(before);
    const s = await repo.read();
    expect(s.topics[0]!.parked).toEqual([]);
    expect(s.unsortedParked).toEqual([]);
  });

  it('the dry-run setting also parks nothing; off does nothing at all', async () => {
    const { service, browser } = await scene();
    const before = (await browser.listTabs()).length;
    await service.updateSettings({ autoParkMode: 'dry-run' });
    expect((await service.autoPark()).tabs).toHaveLength(2);
    await service.updateSettings({ autoParkMode: 'off' });
    expect((await service.autoPark()).tabs).toEqual([]);
    await service.maintenance();
    expect((await browser.listTabs()).length).toBe(before);
  });

  it('parks idle tabs into their topic or the unsorted list, exempting pinned, active and audible', async () => {
    const { service, repo, browser, topicWin, loose } = await scene();
    const result = await service.autoPark();
    expect(result.dryRun).toBe(false);
    expect((await browser.listTabs(topicWin.windowId)).map((t) => t.url)).toEqual([
      'https://pinned/',
      'https://active/',
      'https://recent/',
    ]);
    expect((await browser.listTabs(loose.windowId)).map((t) => t.url)).toEqual([
      'https://loose-active/',
      'https://music/',
    ]);
    const s = await repo.read();
    expect(s.topics[0]!.parked.map((t) => t.url)).toEqual(['https://idle/']);
    expect(s.topics[0]!.tabs.map((t) => t.url)).not.toContain('https://idle/');
    expect(s.unsortedParked.map((t) => t.url)).toEqual(['https://loose-idle/']);
    expect(await repo.snapshots()).toHaveLength(1);

    // Parking is not closing: the next sync leaves Recently closed empty.
    await service.syncAll();
    expect((await repo.read()).topics[0]!.recentlyClosed).toEqual([]);
  });

  it('restore returns every parked tab', async () => {
    const { service, repo, browser, topic, topicWin } = await scene();
    await service.autoPark();
    expect(await service.restoreAllParked(topic.id)).toEqual({ restored: 1 });
    expect(await service.restoreAllParked(null, topicWin.windowId)).toEqual({ restored: 1 });
    const s = await repo.read();
    expect(s.topics[0]!.parked).toEqual([]);
    expect(s.unsortedParked).toEqual([]);
    const urls = (await browser.listTabs()).map((t) => t.url);
    expect(urls).toEqual(expect.arrayContaining(['https://idle/', 'https://loose-idle/']));
    await service.syncAll();
    expect((await repo.read()).topics[0]!.tabs.map((t) => t.url)).toContain('https://idle/');
    expect(await service.restoreAllParked(null)).toEqual({ restored: 0 });
  });

  it('restores parked tabs into a closed topic without opening it', async () => {
    const { service, repo, browser, topic } = await scene();
    await service.autoPark();
    await service.parkTopic(topic.id);
    const windows = browser.windows.size;
    await service.restoreAllParked(topic.id);
    expect(browser.windows.size).toBe(windows);
    expect((await repo.read()).topics[0]!.tabs.map((t) => t.url)).toContain('https://idle/');
  });

  it('restores one unsorted tab into the given window, or a new one', async () => {
    const { service, repo, browser, loose } = await scene();
    await service.autoPark();
    const [entry] = (await repo.read()).unsortedParked;
    await service.restoreUnsorted(entry!.id, loose.windowId);
    expect((await browser.listTabs(loose.windowId)).map((t) => t.url)).toContain(
      'https://loose-idle/',
    );
    await expect(service.restoreUnsorted('nope')).rejects.toThrow(/not found/i);
  });

  it('uses an injected clock', async () => {
    const { service, now } = await scene();
    const later = await service.autoPark({ dryRun: true, at: now() + 14 * DAY });
    expect(later.tabs.map((t) => t.url)).toContain('https://recent/');
  });

  it('validates settings', async () => {
    const { service, repo } = await scene();
    await expect(service.updateSettings({ autoParkDays: 0 })).rejects.toThrow(/365/);
    await service.updateSettings({ autoParkDays: 30 });
    expect((await repo.read()).settings.autoParkDays).toBe(30);
  });
});

describe('discarding', () => {
  it('does not discard tabs that are still loading after a topic opens', async () => {
    const { browser, service, repo } = setup();
    const { windowId } = browser.open(['https://a/', 'https://b/', 'https://c/']);
    const topic = await service.saveWindow(windowId, 'T');
    await service.parkTopic(topic.id);
    await service.openTopic(topic.id);
    const w = (await repo.read()).topics[0]!.windowId!;
    expect((await browser.listTabs(w)).every((t) => !t.discarded)).toBe(true);
  });

  it('maintenance discards topic tabs idle for an hour, not other windows', async () => {
    const ctx = setup();
    const { browser, service } = ctx;
    const t0 = ctx.now();
    const topicWin = browser.open([
      { url: 'https://a/', active: true, lastAccessed: t0 },
      { url: 'https://b/', lastAccessed: t0 - 2 * 3_600_000 },
    ]);
    await service.saveWindow(topicWin.windowId, 'T');
    const other = browser.open([
      { url: 'https://x/', active: true, lastAccessed: t0 },
      { url: 'https://y/', lastAccessed: t0 - 2 * 3_600_000 },
    ]);
    await service.updateSettings({ autoParkMode: 'off' });
    await service.maintenance();
    expect((await browser.listTabs(topicWin.windowId)).map((t) => t.discarded)).toEqual([
      false,
      true,
    ]);
    expect((await browser.listTabs(other.windowId)).map((t) => t.discarded)).toEqual([
      false,
      false,
    ]);
  });
});
