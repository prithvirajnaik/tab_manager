import {
  test as base,
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const extensionPath = path.resolve(import.meta.dirname, '../dist/chrome-mv3');

/** A local site so tests never touch the network: /<name> serves a page titled <name>. */
function startSite(): Promise<{ url: (p: string) => string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '/').slice(1)) || 'home';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><title>${name.replace(/[<>&"]/g, '')}</title><p>${name.replace(/[<>&"]/g, '')}</p>`,
    );
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: (p) => `http://127.0.0.1:${port}/${p}`,
        close: () =>
          new Promise((r) => {
            server.closeAllConnections();
            server.close(() => r());
          }),
      });
    });
  });
}

// Playwright's bundled Chromium still honors --load-extension; Chrome and Edge do not.
// https://playwright.dev/docs/chrome-extensions
export const test = base.extend<{
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  site: { url: (p: string) => string };
  /** An extension page with chrome.* APIs, used to drive and inspect the browser. */
  ext: Page;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
  // eslint-disable-next-line no-empty-pattern
  site: async ({}, use) => {
    const site = await startSite();
    await use(site);
    await site.close();
  },
  ext: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    // "#/" opens the topics panel; the bare address is the calm home page.
    await page.goto(`chrome-extension://${extensionId}/newtab.html#/`);
    await use(page);
  },
});

export const expect = test.expect;

export type WindowTab = { url: string; pinned: boolean; title: string };

/** Sends a command to the service worker from an extension page. */
export function send<T = unknown>(page: Page, message: Record<string, unknown>) {
  return page.evaluate(
    (m) => chrome.runtime.sendMessage(m) as Promise<{ ok: boolean; data?: T; error?: string }>,
    message,
  );
}

/** Opens a window with the given URLs (optionally pinned) and waits for them to load. */
export async function openWindow(page: Page, tabs: { url: string; pinned?: boolean }[]) {
  return page.evaluate(async (specs) => {
    const win = await chrome.windows.create({ url: specs.map((s) => s.url) });
    const tabs = win!.tabs!;
    for (const [i, s] of specs.entries()) {
      if (s.pinned) await chrome.tabs.update(tabs[i]!.id!, { pinned: true });
    }
    for (let i = 0; i < 50; i++) {
      const current = await chrome.tabs.query({ windowId: win!.id! });
      if (current.every((t) => t.status === 'complete' && t.url)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return { windowId: win!.id!, tabIds: tabs.map((t) => t.id!) };
  }, tabs);
}

export function windowTabs(page: Page, windowId: number): Promise<WindowTab[]> {
  return page.evaluate(async (id) => {
    const tabs = await chrome.tabs.query({ windowId: id });
    return tabs.map((t) => ({
      url: t.url || t.pendingUrl || '',
      pinned: t.pinned,
      title: t.title ?? '',
    }));
  }, windowId);
}

export function readStore<
  T = {
    topics: {
      id: string;
      name: string;
      windowId: number | null;
      tabs: { url: string; pinned: boolean }[];
    }[];
  },
>(page: Page): Promise<T> {
  return page.evaluate(async () => (await chrome.storage.local.get('store')).store as never);
}

export function windowExists(page: Page, windowId: number): Promise<boolean> {
  return page.evaluate(
    (id) =>
      chrome.windows.get(id).then(
        () => true,
        () => false,
      ),
    windowId,
  );
}
