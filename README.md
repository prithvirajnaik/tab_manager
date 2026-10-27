# Tab Topics

A Manifest V3 extension for Brave (and other Chromium browsers, 121+) that turns your new tab page into a list of **topics**. A topic is live-linked to a browser window: as you open, close, move and group tabs in that window, the saved topic updates itself. One click opens a topic in a new window; one click parks it. Tabs you have not looked at for 14 days are parked automatically, never deleted. Everything stays on your machine.

See [PLAN.md](PLAN.md) for scope and phases and [docs/decisions.md](docs/decisions.md) for every design decision and its reason.

## Using it

- **Save a window as a topic.** Gather a subject's tabs in one window, open a new tab and type a name under _Save this window as_.
- **Live link.** From then on, opening, closing, navigating, moving and grouping tabs in that window updates the topic. Tabs you close go to the topic's _Recently closed_ list for 30 days. Closing the whole window keeps every tab in the topic.
- **Open, Switch to, Park, Unlink.** _Open_ restores a saved topic in a new window, with pinned tabs and tab groups. _Switch to_ focuses its window if it is already open. _Park_ saves and closes the window; tabs that cannot be saved (for example `blob:` pages) are left open. _Unlink_ stops syncing and leaves the window open.
- **Sections.** Chrome tab groups in a topic window become sections, with name and colour, and come back when the topic reopens. From the card you can also select tabs and group them, or ungroup a section.
- **Search.** Type in the search box (or press <kbd>/</kbd>) to search every topic's tabs, parked and recently closed tabs by title and URL. Results can open their topic, move to another topic or be restored.
- **Auto-park.** Every 30 minutes, tabs idle for the configured number of days (default 14) are parked into their topic's _Parked_ list, or the page's unsorted _Parked_ list for windows without a topic. Pinned, active and audible tabs are never parked. Set the mode to _Preview only_ to see what would be parked without parking anything, or use _Preview_ at any time. Background tabs in topic windows idle for an hour are discarded to save memory.
- **Backup and recovery.** _Export to a file_ writes a JSON backup; _Import from a file_ adds its topics next to yours (it never replaces them). A reminder appears if you have not exported for 14 days. Deleted topics stay in _Deleted topics_ for 30 days. A snapshot is taken before bulk changes (delete, import, relinking after a restart, restoring a snapshot) and before auto-park at most once a day; _Show snapshots_ lists the last ten and can put one back. Restoring a snapshot unlinks every open window (they stay open), so the restored topics are not overwritten.

## Load it in Brave

1. `npm install`, then `npm run build`.
2. Open `brave://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose `dist/chrome-mv3`.
4. Open a new tab. If Brave asks whether to keep the extension's new tab page, choose **Keep it**. Only one extension can replace the new tab page, so turn off any other (Toby, Workona) first. Incognito windows keep Brave's own new tab page.
5. Optional: to save and reopen `file://` tabs, turn on **Allow access to file URLs** for the extension.

Before relying on it, run through [docs/brave-checklist.md](docs/brave-checklist.md).

## Develop

```sh
npm install
npx playwright install chromium
npm run dev       # WXT dev build with reload
npm run verify    # lint, typecheck, unit tests + coverage, build, end-to-end tests
npm run release   # verify, then dist/tab-topics-<version>-chrome.zip
npm run icons     # regenerate public/icon/*.png
```

The pre-push hook runs `npm run verify`; CI runs the same on every pull request.

### Layout

| Path                            | What                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/core/`                     | All logic, with no `chrome.*`: schema and migrations, repo, reconciler, commands, park rule, search |
| `src/adapters/browser.ts`       | The only module that calls the tabs, windows and tab-groups APIs                                    |
| `src/entrypoints/background.ts` | Service worker: registers listeners, debounces syncs, routes commands                               |
| `src/entrypoints/newtab/`       | New tab page entry: one storage read, then render                                                   |
| `src/ui/`                       | Preact components; they talk to the extension through an injected `Api`                             |
| `tests/unit/`, `tests/ui/`      | Vitest; `fakeBrowser.ts` stands in for Chrome                                                       |
| `e2e/`                          | Playwright with bundled Chromium and the built extension                                            |

### How it stays safe

- Every write goes through one queue in the service worker and is validated against the schema before it is stored. Data that cannot be read is never overwritten.
- Saved tabs are never deleted by sync: a tab missing from its window moves to _Recently closed_ (30 days); parking moves tabs to _Parked_ (kept forever).
- A randomized test drives 150 seeded sequences of 40 browser events (including worker and browser restarts, half-finished window closes and drags through temporary windows) and asserts that no saved tab ever disappears or ends up in two places.
- Permissions: `tabs`, `storage`, `unlimitedStorage`, `alarms`, `tabGroups`, `favicon`. No host permissions, no network requests, no analytics. Favicons come from the browser's own cache.
