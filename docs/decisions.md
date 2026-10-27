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
- **`javascript:`, `data:` and `vbscript:` URLs are rejected** in saved tabs, both from the browser and from imports.
- **Unreadable stored data is never overwritten.** Reads and writes fail with `StoreUnreadableError`; the only way out is `resetKeepingBackup`, which copies the raw data to a `store-backup-<time>` key first. Migrations also keep the pre-migration data under `store-backup-v<n>`.
- **Every write is validated against the schema** before it reaches storage, so a bug cannot persist a malformed store.
