import { render } from 'preact';
import { App } from '../../ui/App';
import { chromeApi, loadStore, type LoadResult } from '../../ui/api';
import { applyEffect, readEffect } from '../../ui/effects';
import { applyTheme, readTheme } from '../../ui/theme';
import '../../ui/styles.css';

// Set the theme and surface effects before the first paint, so a chosen theme does not flash the other one.
applyTheme(readTheme());
applyEffect('glass', readEffect('glass'));
applyEffect('transparency', readEffect('transparency'));

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
