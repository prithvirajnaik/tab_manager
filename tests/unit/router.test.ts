import { handleMessage } from '../../src/core/router';
import { setup } from './setup';

const own = { isOwnExtension: true, windowId: undefined as number | undefined };

describe('handleMessage', () => {
  it('ignores messages from other extensions and pages', async () => {
    const { service } = setup();
    expect(await handleMessage(service, { type: 'sync' }, { isOwnExtension: false })).toEqual({
      ok: false,
      error: 'Unknown sender.',
    });
  });

  it.each([null, 'x', { type: 'nope' }, { type: 'openTopic' }, { type: 'openTopic', topicId: 1 }])(
    'rejects malformed command %j',
    async (msg) => {
      const { service } = setup();
      expect(await handleMessage(service, msg, own)).toEqual({
        ok: false,
        error: 'Unknown command.',
      });
    },
  );

  it("saves the sender's window when no window id is given", async () => {
    const { service, browser, repo } = setup();
    const { windowId } = browser.open(['https://a/']);
    const res = await handleMessage(
      service,
      { type: 'saveWindow', name: 'A' },
      { ...own, windowId },
    );
    expect(res.ok).toBe(true);
    expect((await repo.read()).topics[0]?.windowId).toBe(windowId);
    expect(await handleMessage(service, { type: 'saveWindow', name: 'B' }, own)).toEqual({
      ok: false,
      error: 'No window to save.',
    });
  });

  it('runs open, park, restore and sync, reporting user errors verbatim', async () => {
    const { service, browser } = setup();
    const { windowId } = browser.open(['https://a/']);
    const saved = await handleMessage(service, { type: 'saveWindow', name: 'A', windowId }, own);
    const topicId = (saved as { data: { topicId: string } }).data.topicId;
    expect(await handleMessage(service, { type: 'sync' }, own)).toEqual({ ok: true });
    expect(await handleMessage(service, { type: 'parkTopic', topicId }, own)).toEqual({
      ok: true,
      data: { leftOpen: 0 },
    });
    expect(await handleMessage(service, { type: 'openTopic', topicId }, own)).toEqual({
      ok: true,
      data: { failed: 0 },
    });
    expect(
      await handleMessage(
        service,
        { type: 'restoreTab', topicId, tabId: 'x', from: 'parked' },
        own,
      ),
    ).toEqual({ ok: false, error: 'Tab not found.' });
    for (const msg of [
      { type: 'renameTopic', topicId, name: 'B' },
      { type: 'deleteTopic', topicId },
      { type: 'undoDelete', topicId },
    ]) {
      expect(await handleMessage(service, msg, own)).toEqual({ ok: true });
    }
  });

  it('hides unexpected errors behind a safe message', async () => {
    const { service, browser } = setup();
    const { windowId } = browser.open(['https://a/']);
    browser.listTabs = async () => {
      throw new Error('internal detail');
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await handleMessage(service, { type: 'saveWindow', name: 'A', windowId }, own);
    expect(res).toEqual({
      ok: false,
      error: 'Something went wrong. Please try again.',
    });
    spy.mockRestore();
  });
});
