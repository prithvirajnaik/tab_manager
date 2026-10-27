import type { Store } from '../../src/core/model';
import { RELINK_GRACE_MS } from '../../src/core/commands';
import { setup } from './setup';

/** Every saved tab id a store still holds, wherever it lives. */
function everything(store: Store): Set<string> {
  const all = store.topics.flatMap((t) => [...t.tabs, ...t.recentlyClosed, ...t.parked]);
  return new Set(all.map((t) => t.id));
}

describe('live link', () => {
  it('follows add, navigate, move, close and window close', async () => {
    const { browser, service, repo, advance } = setup();
    const { windowId, tabIds } = browser.open(['https://a/', 'https://b/']);
    browser.open(['https://other/']);
    const topic = await service.saveWindow(windowId, 'T');
    const read = async () => (await repo.read()).topics.find((t) => t.id === topic.id)!;

    const c = browser.addTab(windowId, { url: 'https://c/' });
    await service.syncAll();
    expect((await read()).tabs.map((t) => t.url)).toEqual([
      'https://a/',
      'https://b/',
      'https://c/',
    ]);

    browser.update(tabIds[0]!, { url: 'https://a2/', title: 'A2' });
    browser.move(c, windowId, 0);
    await service.syncAll();
    expect((await read()).tabs.map((t) => t.url)).toEqual([
      'https://c/',
      'https://a2/',
      'https://b/',
    ]);

    browser.closeTab(tabIds[1]!);
    await service.syncAll();
    let t = await read();
    expect(t.tabs.map((x) => x.url)).toEqual(['https://c/', 'https://a2/']);
    expect(t.recentlyClosed.map((x) => x.url)).toEqual(['https://b/']);

    // Closing the window later: removals arrive flagged as window closing, then the window goes.
    advance(10_000);
    await service.noteWindowClosing(windowId);
    browser.closeWindow(windowId);
    await service.syncAll();
    t = await read();
    expect(t.windowId).toBeNull();
    expect(t.tabs.map((x) => x.url)).toEqual(['https://c/', 'https://a2/']);
  });

  it('a sync that runs as a window starts closing has its closes put back', async () => {
    const { browser, service, repo, advance } = setup();
    browser.open(['https://other/']);
    const { windowId, tabIds } = browser.open(['https://a/', 'https://b/', 'https://c/']);
    await service.saveWindow(windowId, 'T');
    // The close has begun: two tabs are gone, the window still exists, and the
    // isWindowClosing notification is queued behind a sync.
    browser.closeTab(tabIds[0]!);
    browser.closeTab(tabIds[1]!);
    await service.syncAll();
    expect((await repo.read()).topics[0]!.recentlyClosed).toHaveLength(2);
    advance(100);
    await service.noteWindowClosing(windowId);
    browser.closeWindow(windowId);
    await service.syncAll();
    const t = (await repo.read()).topics[0]!;
    expect(t.tabs.map((x) => x.url)).toEqual(['https://a/', 'https://b/', 'https://c/']);
    expect(t.recentlyClosed).toEqual([]);
    expect(t.windowId).toBeNull();
  });

  it('closes from longer ago stay closed when the window later closes', async () => {
    const { browser, service, repo, advance } = setup();
    browser.open(['https://other/']);
    const { windowId, tabIds } = browser.open(['https://a/', 'https://b/']);
    await service.saveWindow(windowId, 'T');
    browser.closeTab(tabIds[0]!);
    await service.syncAll();
    advance(60_000);
    await service.noteWindowClosing(windowId);
    browser.closeWindow(windowId);
    await service.syncAll();
    const t = (await repo.read()).topics[0]!;
    expect(t.tabs.map((x) => x.url)).toEqual(['https://b/']);
    expect(t.recentlyClosed.map((x) => x.url)).toEqual(['https://a/']);
  });

  it('a window whose close was cancelled is synced again after the closing TTL', async () => {
    const { browser, service, repo, advance } = setup();
    browser.open(['https://other/']);
    const { windowId } = browser.open(['https://a/']);
    await service.saveWindow(windowId, 'T');
    await service.noteWindowClosing(windowId);
    advance(11_000);
    browser.addTab(windowId, { url: 'https://b/' });
    await service.syncAll();
    expect((await repo.read()).topics[0]!.tabs.map((x) => x.url)).toEqual([
      'https://a/',
      'https://b/',
    ]);
  });

  it('quitting the browser leaves topics marked open so they relink on restore', async () => {
    const { browser, service, repo, session } = setup();
    const { windowId } = browser.open(['https://a1/', 'https://a2/']);
    const topic = await service.saveWindow(windowId, 'A');
    // Quit: the last window goes away and a sync manages to run before exit.
    browser.restart();
    const restored = [...browser.windows.keys()];
    for (const w of restored) browser.windows.delete(w);
    await service.syncAll();
    expect((await repo.read()).topics[0]!.windowId).not.toBeNull();
    // Next start: the session restores the window under a new id.
    session.data = {};
    const back = browser.open(['https://a1/', 'https://a2/']);
    await service.syncAll();
    const t = (await repo.read()).topics.find((x) => x.id === topic.id)!;
    expect(t.windowId).toBe(back.windowId);
  });

  it('relink needs a strong URL match, and closes nothing during the grace period', async () => {
    const { browser, service, repo, session, advance } = setup();
    const { windowId } = browser.open(['https://a1/', 'https://a2/', 'https://a3/']);
    const topic = await service.saveWindow(windowId, 'A');
    browser.closeWindow(windowId);
    browser.open(['https://keep/']);
    await repo.update((s) => {
      s.topics[0]!.windowId = 999;
      return s;
    });
    session.data = {};
    // One shared URL out of two is not a match.
    browser.open(['https://a1/', 'https://unrelated/']);
    await service.syncAll();
    expect((await repo.read()).topics[0]!.windowId).toBe(999);
    // Two of three restored: a match, and the missing tab is kept, not closed.
    const partial = browser.open(['https://a1/', 'https://a2/']);
    await service.syncAll();
    let t = (await repo.read()).topics.find((x) => x.id === topic.id)!;
    expect(t.windowId).toBe(partial.windowId);
    expect(t.tabs.map((x) => x.url).sort()).toEqual(['https://a1/', 'https://a2/', 'https://a3/']);
    expect(t.recentlyClosed).toEqual([]);
    // Later events during the grace period still close nothing.
    browser.addTab(partial.windowId, { url: 'https://a4/' });
    await service.syncAll();
    t = (await repo.read()).topics.find((x) => x.id === topic.id)!;
    expect(t.recentlyClosed).toEqual([]);
    expect(t.tabs.map((x) => x.url)).toContain('https://a3/');
    // After it, the window is followed normally: the tab that never came back is closed.
    advance(RELINK_GRACE_MS + 1);
    await service.syncAll();
    await service.syncAll();
    t = (await repo.read()).topics.find((x) => x.id === topic.id)!;
    expect(t.recentlyClosed.map((x) => x.url)).toEqual(['https://a3/']);
  });

  it('detachWindow unlinks a topic and leaves its window open', async () => {
    const { browser, service, repo, links } = setup();
    const { windowId } = browser.open(['https://a/']);
    const topic = await service.saveWindow(windowId, 'A');
    await service.detachWindow(topic.id);
    expect(browser.windows.has(windowId)).toBe(true);
    expect((await repo.read()).topics[0]!.windowId).toBeNull();
    expect((await links.read()).windows[windowId]).toBeUndefined();
    browser.addTab(windowId, { url: 'https://b/' });
    await service.syncAll();
    expect((await repo.read()).topics[0]!.tabs.map((x) => x.url)).toEqual(['https://a/']);
  });

  it('a tab dragged out of a detached window does not leave the dormant topic', async () => {
    const { browser, service, repo } = setup();
    const a = browser.open(['https://a1/', 'https://a2/']);
    const b = browser.open(['https://b1/']);
    const ta = await service.saveWindow(a.windowId, 'A');
    await service.saveWindow(b.windowId, 'B');
    await service.detachWindow(ta.id);
    browser.move(a.tabIds[1]!, b.windowId, -1);
    await service.syncAll();
    const topics = (await repo.read()).topics;
    expect(topics[0]!.tabs.map((x) => x.url)).toEqual(['https://a1/', 'https://a2/']);
    expect(topics[1]!.tabs.map((x) => x.url)).toEqual(['https://b1/', 'https://a2/']);
    const ids = topics.flatMap((t) => t.tabs.map((x) => x.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a tab dragged through a temporary window keeps its id and is not duplicated', async () => {
    const { browser, service, repo } = setup();
    const a = browser.open(['https://a1/', 'https://a2/']);
    const b = browser.open(['https://b1/']);
    const ta = await service.saveWindow(a.windowId, 'A');
    const tb = await service.saveWindow(b.windowId, 'B');
    const movingId = (await repo.read()).topics[0]!.tabs[1]!.id;
    // Mid-drag the tab sits in a temporary window and a sync runs.
    const temp = browser.open(['chrome://newtab/']);
    browser.move(a.tabIds[1]!, temp.windowId, 0);
    await service.syncAll();
    expect((await repo.read()).topics[0]!.recentlyClosed.map((x) => x.id)).toEqual([movingId]);
    // Dropped into B.
    browser.move(a.tabIds[1]!, b.windowId, -1);
    await service.syncAll();
    const topics = (await repo.read()).topics;
    const A = topics.find((t) => t.id === ta.id)!;
    const B = topics.find((t) => t.id === tb.id)!;
    expect(A.tabs.map((x) => x.url)).toEqual(['https://a1/']);
    expect(A.recentlyClosed).toEqual([]);
    expect(B.tabs.map((x) => [x.url, x.id])).toEqual([
      ['https://b1/', B.tabs[0]!.id],
      ['https://a2/', movingId],
    ]);
  });

  it('replaceTab carries a link over to a prerendered tab', async () => {
    const { browser, service, links } = setup();
    const { windowId, tabIds } = browser.open(['https://a/']);
    await service.saveWindow(windowId, 'A');
    const saved = (await links.read()).tabs[tabIds[0]!];
    await service.replaceTab(555, tabIds[0]!);
    const after = await links.read();
    expect(after.tabs[555]).toBe(saved);
    expect(after.tabs[tabIds[0]!]).toBeUndefined();
    await service.replaceTab(556, 12345);
  });

  it('a sync during window closing does not move tabs to Recently closed', async () => {
    const { browser, service, repo } = setup();
    const { windowId, tabIds } = browser.open(['https://a/', 'https://b/', 'https://c/']);
    await service.saveWindow(windowId, 'T');
    await service.noteWindowClosing(windowId);
    browser.closeTab(tabIds[0]!);
    await service.syncAll();
    const t = (await repo.read()).topics[0]!;
    expect(t.tabs).toHaveLength(3);
    expect(t.recentlyClosed).toEqual([]);
  });

  it('relinks windows by URL after a browser restart', async () => {
    const { browser, service, repo, session } = setup();
    const a = browser.open(['https://a1/', 'https://a2/']);
    const b = browser.open(['https://b1/']);
    const ta = await service.saveWindow(a.windowId, 'A');
    const tb = await service.saveWindow(b.windowId, 'B');
    const idsBefore = (await repo.read()).topics.map((t) => t.tabs.map((x) => x.id));

    browser.restart();
    session.data = {};
    await service.syncAll();

    const topics = (await repo.read()).topics;
    expect(topics.map((t) => t.tabs.map((x) => x.id))).toEqual(idsBefore);
    expect(topics.every((t) => t.windowId !== null)).toBe(true);
    expect(topics.every((t) => t.recentlyClosed.length === 0)).toBe(true);
    expect(await repo.snapshots()).toHaveLength(1);

    // Live link works again under the new ids.
    const [wa] = [...browser.windows.keys()];
    browser.addTab(wa!, { url: 'https://a3/' });
    await service.syncAll();
    const after = (await repo.read()).topics;
    expect(after.find((t) => t.id === ta.id)!.tabs.map((x) => x.url)).toContain('https://a3/');
    expect(after.find((t) => t.id === tb.id)!.tabs.map((x) => x.url)).toEqual(['https://b1/']);
  });

  it('unlinks topics whose windows were not restored after the grace period, keeping every tab', async () => {
    const { browser, service, repo, session, advance } = setup();
    const a = browser.open(['https://a1/', 'https://a2/']);
    await service.saveWindow(a.windowId, 'A');
    browser.restart();
    browser.closeWindow([...browser.windows.keys()][0]!);
    session.data = {};
    browser.open(['https://unrelated/']);
    await service.syncAll();
    expect((await repo.read()).topics[0]!.windowId).not.toBeNull();
    advance(RELINK_GRACE_MS + 1);
    await service.syncAll();
    const t = (await repo.read()).topics[0]!;
    expect(t.windowId).toBeNull();
    expect(t.tabs.map((x) => x.url)).toEqual(['https://a1/', 'https://a2/']);
  });

  it('relinks a window the browser restores after the extension started', async () => {
    const { browser, service, repo, session, advance } = setup();
    const a = browser.open(['https://a1/', 'https://a2/']);
    const topic = await service.saveWindow(a.windowId, 'A');
    browser.closeWindow(a.windowId);
    // The topic was open at shutdown; the browser starts with no windows restored yet.
    await repo.update((s) => {
      s.topics[0]!.windowId = 999;
      return s;
    });
    session.data = {};
    browser.open(['chrome://newtab/']);
    await service.syncAll();
    advance(30_000);
    const restored = browser.open(['https://a1/', 'https://a2/']);
    await service.syncAll();
    const t = (await repo.read()).topics.find((x) => x.id === topic.id)!;
    expect(t.windowId).toBe(restored.windowId);
    expect(t.recentlyClosed).toEqual([]);
  });

  it('a restarted service worker picks up where it left off', async () => {
    const ctx = setup();
    const { windowId } = ctx.browser.open(['https://a/']);
    await ctx.service.saveWindow(windowId, 'A');
    const fresh = setup({ browser: ctx.browser, local: ctx.local, session: ctx.session });
    ctx.browser.addTab(windowId, { url: 'https://b/' });
    await fresh.service.syncAll();
    expect((await fresh.repo.read()).topics[0]!.tabs.map((t) => t.url)).toEqual([
      'https://a/',
      'https://b/',
    ]);
    expect(await fresh.repo.snapshots()).toHaveLength(0);
  });

  it('maintenance expires old Recently closed entries and still syncs', async () => {
    const { browser, service, repo, advance } = setup();
    const { windowId, tabIds } = browser.open(['https://a/', 'https://b/']);
    await service.saveWindow(windowId, 'A');
    browser.closeTab(tabIds[1]!);
    await service.syncAll();
    expect((await repo.read()).topics[0]!.recentlyClosed).toHaveLength(1);
    advance(31 * 86_400_000);
    browser.addTab(windowId, { url: 'https://c/' });
    await service.maintenance();
    const t = (await repo.read()).topics[0]!;
    expect(t.recentlyClosed).toEqual([]);
    expect(t.tabs.map((x) => x.url)).toEqual(['https://a/', 'https://c/']);
  });

  it('park reports tabs it had to leave open', async () => {
    const { browser, service } = setup();
    const { windowId } = browser.open(['https://a/', 'blob:https://a/1']);
    const t = await service.saveWindow(windowId, 'A');
    expect(await service.parkTopic(t.id)).toEqual({ leftOpen: 1 });
  });
});

/** Small deterministic PRNG so failures reproduce. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('event sequences never lose a saved tab', () => {
  const SEQUENCES = 150;
  const STEPS = 40;

  it(`holds for ${SEQUENCES} random sequences of ${STEPS} steps`, async () => {
    for (let seed = 1; seed <= SEQUENCES; seed++) {
      const random = rng(seed);
      const pick = <T>(xs: T[]): T | undefined => xs[Math.floor(random() * xs.length)];
      let ctx = setup();
      const { browser } = ctx;
      let urlSeq = 0;
      const url = () => `https://site/${seed}/${urlSeq++}`;

      for (let i = 0; i < 3; i++) {
        const { windowId } = browser.open([url(), url()]);
        await ctx.service.saveWindow(windowId, `T${i}`);
      }
      browser.open([url()]);

      // A saved tab may change URL (navigation) but its id must never vanish from the store.
      const seenIds = new Set<string>();
      const record = async () => {
        const store = await ctx.repo.read();
        for (const t of store.topics) for (const s of t.tabs) seenIds.add(s.id);
        const ids = everything(store);
        for (const id of seenIds) if (!ids.has(id)) throw new Error(`seed ${seed}: lost ${id}`);
        const all = store.topics.flatMap((t) => [...t.tabs, ...t.recentlyClosed, ...t.parked]);
        if (all.length !== ids.size) throw new Error(`seed ${seed}: a saved id is in two places`);
      };
      await record();

      for (let step = 0; step < STEPS; step++) {
        const windows = [...browser.windows.keys()];
        const tabs = [...browser.tabs.keys()];
        const r = random();
        const w = pick(windows);
        const tab = pick(tabs);
        if (r < 0.2 && w !== undefined) browser.addTab(w, { url: url() });
        else if (r < 0.32 && tab !== undefined) browser.closeTab(tab);
        else if (r < 0.44 && tab !== undefined) browser.update(tab, { url: url() });
        else if (r < 0.52 && tab !== undefined) browser.update(tab, { pinned: random() < 0.5 });
        else if (r < 0.62 && tab !== undefined && w !== undefined) {
          browser.move(tab, w, Math.floor(random() * 4));
        } else if (r < 0.68 && w !== undefined) {
          await ctx.service.noteWindowClosing(w);
          browser.closeWindow(w);
        } else if (r < 0.72) {
          const topics = (await ctx.repo.read()).topics;
          const t = pick(topics);
          if (t) await ctx.service.openTopic(t.id);
        } else if (r < 0.76) {
          const t = pick((await ctx.repo.read()).topics);
          if (t) await ctx.service.parkTopic(t.id);
        } else if (r < 0.8) {
          // Service worker restart: new instance, same storage.
          ctx = setup({ browser, local: ctx.local, session: ctx.session });
        } else if (r < 0.83) {
          // Browser restart: new ids, session storage cleared.
          browser.restart();
          ctx.session.data = {};
          ctx = setup({ browser, local: ctx.local, session: ctx.session });
        } else if (r < 0.86 && tab !== undefined) {
          browser.update(tab, { url: 'blob:https://site/x' });
        } else if (r < 0.89 && w !== undefined) {
          // A close that a sync catches half-way.
          const inWindow = browser.windows.get(w) ?? [];
          if (inWindow.length > 1) browser.closeTab(inWindow[0]!);
          await ctx.service.syncAll();
          await ctx.service.noteWindowClosing(w);
          browser.closeWindow(w);
        } else if (r < 0.92 && tab !== undefined && w !== undefined) {
          // A drag through a temporary window.
          const temp = browser.open(['chrome://newtab/']);
          browser.move(tab, temp.windowId, 0);
          await ctx.service.syncAll();
          if (browser.windows.has(w)) browser.move(tab, w, -1);
        } else if (r < 0.94) {
          // Restart onto the new tab page only, then a late restore.
          browser.restart();
          const restored = [...browser.windows.entries()];
          for (const [id] of restored) browser.windows.delete(id);
          ctx.session.data = {};
          ctx = setup({ browser, local: ctx.local, session: ctx.session });
          browser.open(['chrome://newtab/']);
          await ctx.service.syncAll();
          for (const [id, tabs] of restored) browser.windows.set(id, tabs);
        } else if (r < 0.96) {
          const t = pick((await ctx.repo.read()).topics);
          if (t) await ctx.service.detachWindow(t.id);
        }
        if (random() < 0.7) await ctx.service.syncAll();
        await record();
      }
    }
  });
});
