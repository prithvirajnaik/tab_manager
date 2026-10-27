import { test, expect } from './fixtures';

test('loads the extension service worker', async ({ serviceWorker }) => {
  expect(serviceWorker.url()).toMatch(/^chrome-extension:\/\/[a-p]{32}\/background\.js$/);
});

test('serves the new tab page', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/newtab.html`);
  await expect(page.getByRole('heading', { name: 'Tab Topics' })).toBeVisible();
});

test('overrides the browser new tab page', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto('chrome://newtab/');
  await expect(page).toHaveURL(
    new RegExp(`^chrome-extension://${extensionId}/newtab\.html|^chrome://newtab`),
  );
  await expect(page.getByRole('heading', { name: 'Tab Topics' })).toBeVisible();
});
