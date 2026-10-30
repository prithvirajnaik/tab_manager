import { test, expect } from './fixtures';

test('loads the extension service worker', async ({ serviceWorker }) => {
  expect(serviceWorker.url()).toMatch(/^chrome-extension:\/\/[a-p]{32}\/background\.js$/);
});

test('serves the new tab page', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/newtab.html`);
  await expect(page.getByRole('combobox', { name: 'Search the web' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Tab Topics' })).toBeHidden();

  // Ctrl+K slides the rail in; an item raises the panel; Escape puts the panel, then the rail, away.
  await page.keyboard.press('Control+k');
  const nav = page.getByRole('navigation', { name: 'Tab Topics' });
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeHidden();
  await expect(nav).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(nav).toBeHidden();
});

test('overrides the browser new tab page', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('chrome://newtab/');
  await expect(page.getByRole('combobox', { name: 'Search the web' })).toBeVisible();
});
