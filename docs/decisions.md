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

## Phase 3

- **`favicon` permission added.** Favicons render from the browser's cache (`/_favicon/?pageUrl=...`), so the new tab page makes no network requests to the sites in your topics.
- **The page reads storage once and renders.** It then subscribes to `storage.onChanged` and asks for its own window id after first paint, to label "This window".
- **Topics are listed in creation order.** Ordering by last update would make cards jump while you browse.
- **Delete moves the topic to `trash`** (kept 30 days) after a snapshot; the toast offers Undo, and its timer pauses while hovered or focused. The deleted topic's window stays open, unlinked. Undo relinks that window if it is still open and not linked to another topic; the hint lives in session storage (`links.deletedFrom`), so after a restart, when window ids can be reused, Undo restores the topic unlinked. A Trash list in the UI (to restore after the toast is gone) is deferred to phase 7, with the other recovery screens.
- **Components take an injected `Api`** (`src/ui/api.ts`), so component tests run in jsdom without `chrome.*`.
- **Opening a topic reports tabs that could not be opened** in a toast, and the card lists Parked and Recently closed tabs with Restore buttons.
- **Cards are memoised** with stable actions and a minute-granular clock, and tab lists render only while their `<details>` is open, and unchanged topics keep their object identity across storage changes, so per-event writes in phase 4 redraw only the card that changed.
- **Rename commits once.** Enter or Escape settles the edit, so the blur that follows is ignored; focus returns to the Rename button.
- **Render timing is measured with a `performance.mark`** placed right after the render call, and a unit test asserts `loadStore` reads storage exactly once.

## Phase 4

- **Every relevant browser event schedules one debounced sync** (300 ms, at most 2 s after the first event) that reconciles all linked windows from a fresh `tabs.query`. There is no incremental per-event reducer: the reconciler is the reducer, and a full re-read cannot drift from the browser. The pending timer is the worker's only in-memory state, and losing it is harmless.
- **`tabs.onActivated` does not trigger a sync.** `lastActiveAt` comes from `Tab.lastAccessed` (Chrome 121+, verified on developer.chrome.com), picked up on the next sync; syncing on every tab switch would write storage constantly.
- **Window closing is flagged, not inferred.** `tabs.onRemoved` with `isWindowClosing` marks the window as closing (for at most 10 s, in case the close is cancelled), and syncs skip it until `windows.onRemoved`. A sync that already ran as the close began may have moved tabs to Recently closed; those closes are recorded for 5 s and put back when the window turns out to be closing. A linked window with no tabs at all is never reconciled. Trade-off: a tab closed less than 5 s before its window is kept as part of the window.
- **Restored windows are relinked by URL similarity** (Jaccard of saved URL sets at least 0.8, or at least 0.5 with two or more shared URLs; greedy, one-to-one) after any browser restart, extension update or reload, after a snapshot. Browsers can restore windows after the extension starts, so matching is retried for 2 minutes; topics still unmatched after that are marked closed and keep every tab. Until the grace period ends, syncs of a relinked window add tabs but close none (and keep sections whose groups are not restored yet), so a partial restore or a wrong match cannot empty a topic. Trade-off: a tab closed in that window during the first 2 minutes after a restart is only moved to Recently closed once the grace period is over.
- **Quitting does not unlink.** When a sync finds no windows open at all, the browser is most likely quitting, so topics stay marked open and relink on the next start.
- **Unlink (detach) command.** An open topic can be unlinked from its window, which stays open; the window's tab links are dropped too. Restoring a snapshot from the UI is deferred to phase 7.
- **"This window" comes from session links**, not the stored `windowId`, which may be a stale id from before a restart.
- **A dragged tab keeps its saved id**, even through Chrome's temporary drag window: tab links survive in unlinked windows, a linked live tab can reclaim its id from any topic's Recently closed, and the topic it came from lets go of it (`adopted` ids). Prerendered tab swaps (`tabs.onReplaced`) carry the link over.
- **Section mirroring (`src/core/sections.ts`) landed in phase 4's sync rewrite** rather than phase 5, because the reconcile loop had to change in one place; phase 5 adds the commands and UI.
- **A 30-minute `maintenance` alarm** (checked on every worker start) expires Recently closed entries and trash older than 30 days, then syncs, as a safety net for missed events.
- **Imports reject repeated saved-tab ids** across topics.
- **Randomized event-sequence test**: 150 seeded sequences of 40 steps (add, close, navigate, pin, move within and across windows, close window, open, park, worker restart, browser restart, navigate to an unsaveable URL) assert that no saved-tab id ever disappears from the store. Steps also include a close caught half-way by a sync, a drag through a temporary window, a restart onto the new tab page followed by a late restore, and detach. Invariants: no saved id ever disappears, and none is ever in two places. A mutation check (dropping closed tabs in the reconciler) makes it fail on seed 1.

## Phase 5

- **Sections are Chrome tab groups.** In an open topic, the browser's groups are the truth and syncs mirror them (name, colour, collapsed). Grouping from the new tab page creates a real group, and the sync then records it. In a closed topic, grouping edits the saved topic, and opening it recreates the groups. Pinned tabs cannot be grouped (a Chrome rule).
- **Group events** (`tabGroups.onCreated/onUpdated/onRemoved/onMoved`) schedule a sync, because renaming or recolouring a group does not fire `tabs.onUpdated`.
- **Collapsing a group is best effort**: the adapter sets title and colour first, then tries to collapse, so a refused collapse never loses a section's name.
- **Search is local and synchronous** over every topic's tabs, Parked and Recently closed lists. Every word must match. Scoring: start of a title word 3, inside the title 2, host 1.5, elsewhere in the URL 1, weighted by list (open 1, parked 0.8, closed 0.6). Accents and case are ignored. At most 100 results.
- **Moving a tab between topics**: if both topics are open, the real tab is moved and the sync hands it over with its saved id. Otherwise the saved tab is moved in storage first, then the live tab is closed or opened as needed, so the move never reads as a close. A moved tab leaves its section behind.
- **A move into an open topic opens the tab there first**, then updates storage, then closes the old copy; if the browser refuses the tab, nothing has moved.
- **"Move to…" is a select plus a Move button.** Arrow keys on a closed select change its value in Chromium, so choosing must never act on its own.
- **Search keeps a normalised index per store** (rebuilt only when the store changes), and the query is deferred, so typing stays fast with thousands of tabs. Only Latin diacritics are folded (U+0300 to U+036F); other scripts' marks, such as Japanese voicing, keep their meaning.
- **A half-closed window brings back its sections too**: the revert record keeps the topic's sections, since a window's groups vanish with it.
- **Grouping and ungrouping sync first**, and grouping in an open topic refuses when none of the chosen tabs is still open.

## Phase 6

- **The park rule is a pure function** (`src/core/autopark.ts`) of live tabs, saved activity and a clock. Idle means neither `Tab.lastAccessed` nor our saved `lastActiveAt` is within the configured days. Exempt: pinned, active and audible tabs, new tab pages, URLs that cannot be saved, tabs of unknown age, and windows that are closing or still being relinked after a restart.
- **Auto-park runs from the 30-minute maintenance alarm.** A topic window's idle tab moves to that topic's Parked list; an idle tab in a window with no topic goes to the unsorted Parked list. The store is written first (after a snapshot), then the tab links are dropped, then the tabs are closed, so parking never reads as a close.
- **Modes**: `on` (default, per PLAN.md), `dry-run` (computes, parks nothing) and `off`. The new tab page's Preview button always does a dry run.
- **The `autoPark` command accepts a clock override (`at`)** so the end-to-end test can simulate 15 days passing; commands are accepted only from this extension's own pages.
- **Parked tabs never expire.** Restore brings back one tab or all of them; into the topic's window if it is open, otherwise into the saved topic (or, for unsorted tabs, into the current window or a new one).
- **No discarding right after a topic opens.** Discarding a tab before its first navigation commits can blank it, and the next sync would then file it as closed (seen in the e2e run). Instead the maintenance alarm discards background tabs in topic windows that have been idle for an hour.
- **Restores open tabs one by one**; a tab the browser refuses stays parked and is reported as failed. Tabs that did open are linked before anything else, so a partial restore never duplicates.
- **No auto-park while a topic waits for its restored window** (the post-restart relink), so a restored topic window's tabs are never misfiled as having no topic. Previews still work.
- **Parking closes tabs one at a time** and skips any tab the user activated meanwhile.
- **Auto-park snapshots at most once a day** (or for 10 or more tabs at once), so a trickle of parking does not rotate useful snapshots out of the ten-slot ring.
- **Search also covers the unsorted Parked list**, with Restore from the result.

## Phase 7

- **Import merges, never replaces.** Imported topics are added next to the current ones after a snapshot; a clashing topic or tab id gets a new id, so the same file can be imported twice without damage. Replacing everything would be a bulk delete.
- **Export goes through the service worker** so it can record `lastExportAt`; the page turns the text into a download. A reminder banner shows when topics exist and nothing was exported in 14 days.
- **Recovery lives on the new tab page**: deleted topics (30-day trash) with Restore, and the snapshot list with a confirm step before a restore. When stored data cannot be read, the page offers only to download it as-is or to start fresh, which keeps the old data under a backup key.
- **Keyboard**: `/` focuses search, Escape clears it, every control is a native button, input or select with a visible focus ring, and every action button's accessible name includes the topic or tab it acts on. Toasts use a polite live region and pause while hovered or focused. Motion is disabled under `prefers-reduced-motion`.
- **Icons are generated** by `scripts/make-icons.mjs` (zlib only), so they are reproducible and need no image tools.
- **Release**: `npm run release` runs `verify`, then `wxt zip`, producing `dist/tab-topics-<version>-chrome.zip`.
- **Brave-specific behaviour is covered by `docs/brave-checklist.md`**, run by hand, since Playwright only drives its bundled Chromium.
- **Restoring a snapshot unlinks every window** (they stay open), so open windows cannot overwrite the restored topics on the next sync.
- **"Start fresh" is refused when the data can be read** again, so a stale page can never move readable data aside.
- **Imports and Undo avoid ids held by the trash**, so restoring a deleted topic after importing the same export never duplicates tab ids.
- **Import files over 50 MB are refused in the page**, before they reach the command channel.
