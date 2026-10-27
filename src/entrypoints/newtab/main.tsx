import { render } from 'preact';
import { App } from '../../ui/App';
import { chromeApi, loadStore, type LoadResult } from '../../ui/api';
import '../../ui/styles.css';

// One storage read, then render. Everything else (window id, live updates) follows.
const root = document.getElementById('app');
if (root) {
  void loadStore()
    .catch((e: unknown): LoadResult => ({ ok: false, error: String(e) }))
    .then((initial) => {
      render(<App initial={initial} api={chromeApi} />, root);
      performance.mark('tab-topics:rendered');
    });
}
