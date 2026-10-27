import { defineBackground } from 'wxt/utils/define-background';
import { chromeBrowser, localArea, ownNewTabUrl, sessionArea } from '../adapters/browser';
import { createService } from '../core/commands';
import { debounce } from '../core/debounce';
import { createLinkStore } from '../core/links';
import { createRepo } from '../core/repo';
import { handleMessage } from '../core/router';

const SYNC_DEBOUNCE_MS = 300;
const SYNC_MAX_WAIT_MS = 2_000;
const MAINTENANCE_ALARM = 'maintenance';
const MAINTENANCE_MINUTES = 30;

export default defineBackground({
  type: 'module',
  main() {
    // Stateless wiring: all state lives in chrome.storage, so a restarted worker
    // rebuilds exactly this. The queues only order work within one worker lifetime.
    const service = createService({
      browser: chromeBrowser,
      repo: createRepo(localArea(), Date.now),
      links: createLinkStore(sessionArea()),
      now: Date.now,
      newId: () => crypto.randomUUID(),
      ownNewTabUrl: ownNewTabUrl(),
    });

    const logFailure = (what: string) => (e: unknown) =>
      console.error(`[tab-topics] ${what} failed`, e);
    const sync = debounce(
      () => void service.syncAll().catch(logFailure('sync')),
      SYNC_DEBOUNCE_MS,
      SYNC_MAX_WAIT_MS,
    );

    const ensureAlarm = async () => {
      if (!(await chrome.alarms.get(MAINTENANCE_ALARM))) {
        await chrome.alarms.create(MAINTENANCE_ALARM, { periodInMinutes: MAINTENANCE_MINUTES });
      }
    };

    // Every listener is registered synchronously at the top level of the worker.
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      handleMessage(service, message, {
        isOwnExtension: sender.id === chrome.runtime.id,
        ...(sender.tab?.windowId === undefined ? {} : { windowId: sender.tab.windowId }),
      }).then(sendResponse);
      return true;
    });

    chrome.tabs.onCreated.addListener(sync);
    chrome.tabs.onUpdated.addListener((_tabId, info) => {
      // Loading progress and audio changes do not affect what a topic saves.
      if (
        info.url !== undefined ||
        info.title !== undefined ||
        info.pinned !== undefined ||
        info.favIconUrl !== undefined ||
        info.groupId !== undefined
      ) {
        sync();
      }
    });
    chrome.tabs.onMoved.addListener(sync);
    chrome.tabs.onAttached.addListener(sync);
    chrome.tabs.onDetached.addListener(sync);
    chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
      void service.replaceTab(addedTabId, removedTabId).catch(logFailure('replaceTab'));
      sync();
    });
    chrome.tabs.onRemoved.addListener((_tabId, info) => {
      if (info.isWindowClosing) {
        void service.noteWindowClosing(info.windowId).catch(logFailure('noteWindowClosing'));
      }
      sync();
    });
    chrome.windows.onCreated.addListener(sync);
    chrome.windows.onRemoved.addListener(sync);

    chrome.runtime.onStartup.addListener(sync);
    chrome.runtime.onInstalled.addListener(sync);
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === MAINTENANCE_ALARM) {
        void service.maintenance().catch(logFailure('maintenance'));
      }
    });

    // On every worker start, so the alarm also comes back after a disable and enable.
    void ensureAlarm().catch(logFailure('ensureAlarm'));
  },
});
