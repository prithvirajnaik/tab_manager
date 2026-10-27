import { EXPORT_FORMAT, parseImport } from '../../src/core/exportImport';
import { STORE_KEY } from '../../src/core/repo';
import { setup } from './setup';

describe('export and import commands', () => {
  it('exports a valid file and records when', async () => {
    const { browser, service, repo, now } = setup();
    await service.saveWindow(browser.open(['https://a/']).windowId, 'A');
    const { text } = await service.exportData();
    const parsed = parseImport(text);
    expect(parsed.ok).toBe(true);
    expect((await repo.read()).settings.lastExportAt).toBe(now());
  });

  it('imports by merging, renaming clashing ids, after a snapshot', async () => {
    const { browser, service, repo } = setup();
    await service.saveWindow(browser.open(['https://a/']).windowId, 'Mine');
    const { text } = await service.exportData();
    // Importing the same file again must not overwrite or duplicate ids.
    const result = await service.importData(text);
    expect(result).toEqual({ topics: 1, tabs: 1 });
    const s = await repo.read();
    expect(s.topics.map((t) => t.name)).toEqual(['Mine', 'Mine']);
    expect(new Set(s.topics.map((t) => t.id)).size).toBe(2);
    const tabIds = s.topics.flatMap((t) => t.tabs.map((x) => x.id));
    expect(new Set(tabIds).size).toBe(2);
    expect(s.topics[1]!.windowId).toBeNull();
    expect(await repo.snapshots()).toHaveLength(1);
  });

  it('rejects an invalid file without touching anything', async () => {
    const { browser, service, repo, local } = setup();
    await service.saveWindow(browser.open(['https://a/']).windowId, 'A');
    const before = structuredClone(local.data[STORE_KEY]);
    await expect(service.importData('{"format":"nope"}')).rejects.toThrow(/not a Tab Topics/);
    await expect(
      service.importData(JSON.stringify({ format: EXPORT_FORMAT, store: { schemaVersion: 1 } })),
    ).rejects.toThrow(/Invalid export/);
    expect(local.data[STORE_KEY]).toEqual(before);
    void repo;
  });
});

describe('recovery commands', () => {
  it('lists and restores snapshots', async () => {
    const { browser, service, repo } = setup();
    const t = await service.saveWindow(browser.open(['https://a/']).windowId, 'A');
    await service.deleteTopic(t.id);
    const list = await service.listSnapshots();
    expect(list).toEqual([{ at: expect.any(Number), topics: 1, tabs: 1 }]);
    await service.restoreSnapshot(list[0]!.at);
    expect((await repo.read()).topics.map((x) => x.name)).toEqual(['A']);
  });

  it('restoring a snapshot unlinks open windows so they cannot overwrite it', async () => {
    const { browser, service, repo, links } = setup();
    const { windowId } = browser.open(['https://a/', 'https://b/']);
    const t = await service.saveWindow(windowId, 'A');
    await service.groupTabs(t.id, [(await repo.read()).topics[0]!.tabs[0]!.id], 'G');
    await service.deleteTopic(t.id);
    await service.undoDelete(t.id);
    // Change the live window, then restore the snapshot taken before the delete.
    browser.addTab(windowId, { url: 'https://c/' });
    await service.syncAll();
    const [snap] = await service.listSnapshots();
    await service.restoreSnapshot(snap!.at);
    await service.syncAll();
    const restored = (await repo.read()).topics[0]!;
    expect(restored.windowId).toBeNull();
    expect(restored.tabs.map((x) => x.url)).toEqual(['https://a/', 'https://b/']);
    expect(restored.recentlyClosed).toEqual([]);
    expect((await links.read()).windows).toEqual({});
    expect(browser.windows.has(windowId)).toBe(true);
  });

  it('refuses to reset data that can be read', async () => {
    const { browser, service, repo } = setup();
    await service.saveWindow(browser.open(['https://a/']).windowId, 'A');
    await expect(service.resetStore()).rejects.toThrow(/can be read/);
    expect((await repo.read()).topics).toHaveLength(1);
  });

  it('import does not reuse ids of deleted topics, and undo keeps ids unique', async () => {
    const { browser, service, repo } = setup();
    const t = await service.saveWindow(browser.open(['https://a/']).windowId, 'A');
    const { text } = await service.exportData();
    await service.deleteTopic(t.id);
    await service.importData(text);
    await service.undoDelete(t.id);
    const s = await repo.read();
    expect(s.topics).toHaveLength(2);
    expect(new Set(s.topics.map((x) => x.id)).size).toBe(2);
    const ids = s.topics.flatMap((x) => x.tabs.map((y) => y.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resets unreadable data, keeping a backup', async () => {
    const { service, local } = setup();
    local.data[STORE_KEY] = { schemaVersion: 1, topics: 'broken' };
    await expect(service.syncAll()).rejects.toThrow();
    const { backupKey } = await service.resetStore();
    expect(local.data[backupKey]).toEqual({ schemaVersion: 1, topics: 'broken' });
    await service.syncAll();
  });
});
