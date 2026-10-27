import { createService } from '../../src/core/commands';
import { createRepo } from '../../src/core/repo';
import { createLinkStore } from '../../src/core/links';
import { FakeBrowser } from './fakeBrowser';
import { memoryKv } from './memoryKv';

export function setup() {
  const browser = new FakeBrowser();
  let t = 1_000_000;
  const now = () => t;
  const advance = (ms: number) => (t += ms);
  let n = 0;
  const local = memoryKv();
  const session = memoryKv();
  const repo = createRepo(local, now);
  const links = createLinkStore(session);
  const service = createService({
    browser,
    repo,
    links,
    now,
    newId: () => `id-${++n}`,
    ownNewTabUrl: 'chrome-extension://abc/newtab.html',
  });
  return { browser, repo, links, service, now, advance, local, session };
}
