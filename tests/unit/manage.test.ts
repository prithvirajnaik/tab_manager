import { TRASH_DAYS } from '../../src/core/model';
import { setup } from './setup';

const DAY = 86_400_000;

describe('renameTopic', () => {
  it('renames and trims', async () => {
    const { browser, service, repo } = setup();
    const { windowId } = browser.open(['https://a/']);
    const t = await service.saveWindow(windowId, 'Old');
    await service.renameTopic(t.id, '  New name ');
    expect((await repo.read()).topics[0]?.name).toBe('New name');
    await expect(service.renameTopic(t.id, '  ')).rejects.toThrow(/name/i);
    await expect(service.renameTopic('missing', 'x')).rejects.toThrow(/not found/i);
  });
});

describe('deleteTopic and undoDelete', () => {
  it('moves a topic to the trash, unlinks its window without closing it, and undo relinks it', async () => {
    const { browser, service, repo, links } = setup();
    const { windowId } = browser.open(['https://a/', 'https://b/']);
    const t = await service.saveWindow(windowId, 'Doomed');

    await service.deleteTopic(t.id);
    let store = await repo.read();
    expect(store.topics).toEqual([]);
    expect(store.trash.map((e) => e.topic.name)).toEqual(['Doomed']);
    expect(browser.windows.has(windowId)).toBe(true);
    expect((await links.read()).windows[windowId]).toBeUndefined();
    expect(await repo.snapshots()).toHaveLength(1);

    await service.undoDelete(t.id);
    store = await repo.read();
    expect(store.trash).toEqual([]);
    expect(store.topics[0]).toMatchObject({ id: t.id, name: 'Doomed', windowId });
    expect(store.topics[0]?.tabs.map((x) => x.url)).toEqual(['https://a/', 'https://b/']);
    expect((await links.read()).windows[windowId]).toBe(t.id);

    // Still live-linked after undo.
    browser.addTab(windowId, { url: 'https://c/' });
    await service.syncAll();
    expect((await repo.read()).topics[0]?.tabs.map((x) => x.url)).toEqual([
      'https://a/',
      'https://b/',
      'https://c/',
    ]);
  });

  it('does not relink after a browser restart, when window ids may be reused', async () => {
    const { browser, service, repo, session } = setup();
    const { windowId } = browser.open(['https://a/']);
    const t = await service.saveWindow(windowId, 'A');
    await service.deleteTopic(t.id);
    session.data = {};
    await service.undoDelete(t.id);
    expect((await repo.read()).topics[0]?.windowId).toBeNull();
    expect((await repo.read()).trash).toEqual([]);
  });

  it('restores unlinked when the window closed or was saved as another topic meanwhile', async () => {
    const { browser, service, repo } = setup();
    const w1 = browser.open(['https://a/']).windowId;
    const w2 = browser.open(['https://b/']).windowId;
    const a = await service.saveWindow(w1, 'A');
    const b = await service.saveWindow(w2, 'B');
    await service.deleteTopic(a.id);
    await service.deleteTopic(b.id);
    browser.closeWindow(w1);
    await service.saveWindow(w2, 'B2');
    await service.undoDelete(a.id);
    await service.undoDelete(b.id);
    const topics = (await repo.read()).topics;
    expect(topics.find((t) => t.name === 'A')?.windowId).toBeNull();
    expect(topics.find((t) => t.name === 'B')?.windowId).toBeNull();
    expect(topics.find((t) => t.name === 'B2')?.windowId).toBe(w2);
  });

  it('purges trash entries older than 30 days on the next delete', async () => {
    const { browser, service, repo, advance } = setup();
    const a = await service.saveWindow(browser.open(['https://a/']).windowId, 'A');
    const b = await service.saveWindow(browser.open(['https://b/']).windowId, 'B');
    await service.deleteTopic(a.id);
    advance(TRASH_DAYS * DAY + 1);
    await service.deleteTopic(b.id);
    expect((await repo.read()).trash.map((e) => e.topic.name)).toEqual(['B']);
  });

  it('gives a restored topic a fresh id if one with the same id came back meanwhile', async () => {
    const { browser, service, repo } = setup();
    const t = await service.saveWindow(browser.open(['https://a/']).windowId, 'A');
    await service.deleteTopic(t.id);
    await repo.update((s) => ({ ...s, topics: [{ ...s.trash[0]!.topic, name: 'Restored copy' }] }));
    await service.undoDelete(t.id);
    const topics = (await repo.read()).topics;
    expect(topics).toHaveLength(2);
    expect(new Set(topics.map((x) => x.id)).size).toBe(2);
  });

  it('rejects unknown ids', async () => {
    const { service } = setup();
    await expect(service.deleteTopic('x')).rejects.toThrow(/not found/i);
    await expect(service.undoDelete('x')).rejects.toThrow(/not found/i);
  });
});
