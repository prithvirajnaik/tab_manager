import { expect, readStore, test } from './fixtures';

test('save this window from the new tab page, rename it, delete and undo', async ({
  context,
  ext,
  extensionId,
  site,
}) => {
  const newtab = `chrome-extension://${extensionId}/newtab.html`;
  const pagePromise = context.waitForEvent('page', (p) => p.url().startsWith(newtab));
  await ext.evaluate(
    (urls) => chrome.windows.create({ url: urls }),
    [site.url('kana'), site.url('kanji'), newtab],
  );
  const page = await pagePromise;
  await page.waitForLoadState();

  await page.getByLabel('Save this window as').fill('Japanese');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('heading', { name: 'Japanese' })).toBeVisible();
  await expect(page.locator('.badge', { hasText: 'This window' })).toBeVisible();
  await expect(page.getByText('2 tabs', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Rename Japanese' }).click();
  const input = page.getByLabel('New name for Japanese');
  await input.fill('日本語');
  await input.press('Enter');
  await expect(page.getByRole('heading', { name: '日本語' })).toBeVisible();

  await page.getByRole('button', { name: 'Delete 日本語' }).click();
  await expect(page.getByRole('heading', { name: '日本語' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('heading', { name: '日本語' })).toBeVisible();

  const store = await readStore(ext);
  expect(store.topics.map((t) => t.name)).toEqual(['日本語']);
  expect(store.topics[0]!.tabs.map((t) => t.url)).toEqual([site.url('kana'), site.url('kanji')]);
});

test('park and open from the new tab page', async ({ ext, site }) => {
  const { windowId } = await ext.evaluate(async (url) => {
    const w = await chrome.windows.create({ url });
    return { windowId: w!.id! };
  }, site.url('focus'));
  await ext.evaluate(
    (args) => chrome.runtime.sendMessage({ type: 'saveWindow', name: 'Focus', windowId: args }),
    windowId,
  );

  // The extension page lives in the first window, so parking Focus does not close it.
  const page = ext;
  await page.reload();
  const card = page.getByRole('article', { name: 'Focus' });
  const badge = card.locator('.badge');
  await expect(badge).toHaveText('Open');
  await card.getByRole('button', { name: 'Park' }).click();
  await expect(badge).toHaveText('Saved');

  await card.getByRole('button', { name: 'Open' }).click();
  await expect(badge).toHaveText('Open');
  const store = await readStore(ext);
  expect(store.topics[0]!.windowId).not.toBeNull();
});

test('renders 50 topics promptly after a single storage read', async ({
  context,
  ext,
  extensionId,
}) => {
  const now = Date.now();
  await ext.evaluate((at) => {
    const topics = Array.from({ length: 50 }, (_, i) => ({
      id: `t${i}`,
      name: `Topic ${i}`,
      windowId: null,
      tabs: Array.from({ length: 20 }, (_, j) => ({
        id: `t${i}-${j}`,
        url: `https://example.com/${i}/${j}`,
        title: `Tab ${j}`,
        pinned: false,
        lastActiveAt: at,
      })),
      sections: [],
      recentlyClosed: [],
      parked: [],
      createdAt: at,
      updatedAt: at,
    }));
    return chrome.storage.local.set({
      store: {
        schemaVersion: 1,
        topics,
        unsortedParked: [],
        settings: { autoParkDays: 14, autoParkMode: 'on', lastExportAt: null },
        trash: [],
      },
    });
  }, now);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/newtab.html`);
  await expect(page.getByRole('article')).toHaveCount(50);
  const ms = await page.evaluate(() => {
    const first = document.querySelector('article');
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return first ? performance.now() - nav.startTime : Infinity;
  });
  // Measured to the moment the assertion saw 50 cards; generous for CI machines.
  expect(ms).toBeLessThan(3000);
});
