# Decisions

One line of reasoning per decision not covered by PLAN.md, newest at the bottom of each phase.

## Phase 0

- **WXT over CRXJS.** WXT 0.21.5 was published 2026-10-26; CRXJS 3.0.0's last release was 2026-09-24, so WXT has the more recent releases.
- **Auto-imports off** (`imports: false`). Explicit imports keep `src/core` provably free of `chrome.*` and WXT globals.
- **`minimum_chrome_version: 121`.** `Tab.lastAccessed` is Chrome 121+ and 30-second alarms are Chrome 120+ (verified on developer.chrome.com, 2026-10-28).
- **Stacked phase branches.** `gh` is not installed here, so pull requests cannot be opened from the CLI; each `phase-N` branch is based on `phase-(N-1)` so they can be opened and squash-merged in order on GitHub.
- **`simple-git-hooks` for the pre-push hook.** One dependency, zero config files, and `npm install` installs it.
- **Playwright with bundled Chromium in headless mode** (`channel: 'chromium'`), per the Playwright extension docs.
- **LF line endings** enforced by `.gitattributes`, so Prettier passes on Windows and CI alike.

## Phase 1

- **Snapshots in their own storage key** (`snapshots`) instead of inside `Store`. Every write would otherwise rewrite all ten snapshots.
- **Ten rolling snapshots**, newest first. Small enough to stay cheap, enough to recover from a run of bad bulk changes.
- **`ParkedTab` and `ClosedTab` carry `parkedAt` / `closedAt`.** The UI shows when, and the 30-day recently-closed expiry needs the time.
- **`trash` list in `Store`.** Deleting a topic moves it to trash for 30 days, so delete is undoable and no code path destroys a topic outright.
- **`settings.autoParkMode` (`on` / `dry-run` / `off`) and `settings.lastExportAt`.** Mode is the phase 6 dry-run switch; `lastExportAt` drives the backup reminder.
- **`Section.color` and `Section.collapsed`** (optional). They mirror Chrome tab group properties for phase 5.
- **Imports reset `windowId` to null.** Window ids are only unique within a browser session, so an imported id would point at the wrong window. Everything else round-trips exactly.
- **Tab URLs use a protocol allowlist** (http, https, file, ftp, chrome, brave, edge, about, chrome-extension, view-source), checked on the protocol `new URL()` parses. A blocklist regex was bypassable with control characters (`javascript:`) or embedded tabs (review finding).
- **Unreadable stored data is never overwritten.** Reads and writes fail with `StoreUnreadableError`; the only way out is `resetKeepingBackup`, which copies the raw data to a `store-backup-<time>` key first. Migrations also keep the pre-migration data under `store-backup-v<n>-<time>`, and backup keys are never reused.
- **Every write is validated against the schema** before it reaches storage, so a bug cannot persist a malformed store.
- **Legacy (v0) data is migrated strictly.** Missing fields get defaults; a field present with the wrong type is an error. Imports must carry an integer `schemaVersion`, so an arbitrary JSON object is never read as an empty store.
- **Snapshots are stored as `{ schemaVersion, items }`** and read entry by entry; older entries are migrated and unreadable ones move to a `snapshots-unreadable-<time>` key instead of being dropped.
- **Restoring a snapshot clears `windowId`** on every restored topic; the startup reconciler relinks windows.
- **Writes are skipped when nothing changed**, so phase 4's per-event syncs do not churn storage.
- **Only the service worker writes the store**, through one `Repo` instance; extension pages read storage and send commands.
- **Listing and restoring `store-backup-*` keys** is deferred to phase 7 (export/import and error states UI).

## Phase 2

- **The reconciler and command service live in `src/core`** behind a `BrowserPort` interface (`src/core/ports.ts`); `src/adapters/browser.ts` is its only Chrome implementation, and unit tests use `tests/unit/fakeBrowser.ts`.
- **Session links** (`windowId -> topicId`, `tabId -> savedTabId`, `groupId -> sectionId`) live in `chrome.storage.session` under one `links` key.
- **Saving a window links it** to the new topic immediately; phase 4 adds the event wiring that keeps it updated.
- **Parking syncs the window first**, writes the topic, unlinks the window, then closes it. If closing fails, the saved topic is intact and the window is simply unlinked. Tabs that cannot be saved (`blob:`, `data:`, over-long URLs) are never closed: when a window has any, parking closes only the saved and blank tabs and leaves the rest open in the unlinked window.
- **Opening a topic that is already open focuses its window** instead of opening a duplicate.
- **Topics open tab by tab** into a blank window, so one URL the browser refuses (for example `file:` without file access) does not stop the rest. Tabs that fail to open move to the topic's Parked list (which never expires), and the command reports how many failed.
- **New tab pages are never saved** (this extension's own page, `chrome://newtab/`, `brave://newtab/`, `about:blank`).
- **Commands are validated with zod** and accepted only from this extension (`sender.id === runtime.id`). Unexpected errors return a generic message and are logged; `UserError` messages are shown as-is.
- **Tab data from the browser is sanitized**: titles truncated to 4096 characters, favicon URLs over 8192 characters dropped.
- **The e2e tests run against a local HTTP server** started per test, never the network.
- **A tab counts as moved, not closed, only when another topic will adopt it**: its window is open, linked to an existing topic and not closing, and its URL is saveable. Anything else goes to Recently closed. After a sync, a saved tab open in a linked window belongs to that topic alone.
- **`lastActiveAt` is not bumped for the active tab on every sync.** It comes from `Tab.lastAccessed` (Chrome 121+) and, from phase 4, `tabs.onActivated`. Change detection compares tabs with sorted keys, so idle syncs write nothing.
- **`ipfs:` and `ipns:` are allowed URL protocols**, because Brave opens them natively.
- **`BrowserPort` is defined once, in full.** Group, move and discard methods are implemented now and used from phases 5 and 6, to avoid reshaping the adapter each phase.
- **The generic error message no longer promises nothing changed**, since a partly failed park or open may already have saved or unlinked.
