import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  imports: false,
  manifestVersion: 3,
  browser: 'chrome',
  manifest: {
    name: 'Tab Topics',
    description: 'Live-linked tab topics on your new tab page. Local-first.',
    // Tab.lastAccessed is Chrome 121+; 30s alarms are Chrome 120+.
    minimum_chrome_version: '121',
    // favicon: read icons from the browser's cache instead of fetching them from sites.
    // search: the home page search bar runs your default search engine when you submit it.
    permissions: [
      'tabs',
      'storage',
      'unlimitedStorage',
      'alarms',
      'tabGroups',
      'favicon',
      'search',
    ],
  },
  vite: () => ({
    plugins: [preact()],
  }),
  webExt: {
    disabled: true,
  },
});
