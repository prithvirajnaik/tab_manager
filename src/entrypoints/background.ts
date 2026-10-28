import { defineBackground } from 'wxt/utils/define-background';
import { chromeBrowser, localArea, ownNewTabUrl, sessionArea } from '../adapters/browser';
import { createService } from '../core/commands';
import { createLinkStore } from '../core/links';
import { createRepo } from '../core/repo';
import { handleMessage } from '../core/router';

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

    // Listeners are registered synchronously at the top level of the worker.
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      handleMessage(service, message, {
        isOwnExtension: sender.id === chrome.runtime.id,
        ...(sender.tab?.windowId === undefined ? {} : { windowId: sender.tab.windowId }),
      }).then(sendResponse);
      return true;
    });
  },
});
