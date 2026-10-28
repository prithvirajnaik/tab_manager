import { createService } from '../../src/core/commands';
import { createRepo } from '../../src/core/repo';
import { createLinkStore } from '../../src/core/links';
import { FakeBrowser } from './fakeBrowser';
import { memoryKv } from './memoryKv';

type Shared = {
  browser?: FakeBrowser;
  local?: ReturnType<typeof memoryKv>;
  session?: ReturnType<typeof memoryKv>;
};

let ids = 0;

/** A service over a fake browser. Pass existing parts to simulate a service worker restart. */
export function setup(shared: Shared = {}) {
  const browser = shared.browser ?? new FakeBrowser();
  let t = 1_000_000;
  const now = () => t;
  const advance = (ms: number) => (t += ms);
  const local = shared.local ?? memoryKv();
  const session = shared.session ?? memoryKv();
  const repo = createRepo(local, now);
  const links = createLinkStore(session);
  const service = createService({
    browser,
    repo,
    links,
    now,
    newId: () => `id-${++ids}`,
    ownNewTabUrl: 'chrome-extension://abc/newtab.html',
  });
  return { browser, repo, links, service, now, advance, local, session };
}
