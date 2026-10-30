# UI redesign plan: new tab page

Goal: move the new tab page to the reference layout (sidebar, header with search and save,
topic cards, parking and backup) **without showing anything the store cannot back up**. Every
number, label and state on screen comes from `Store`, session links or settings. No
placeholder copy, no features that do not exist, no data the model does not have.

Scope: `src/ui/**` and `src/ui/styles.css` only. No new commands. One optional schema change
(topic colour and icon) is kept for a later step.

---

## 1. The reference, element by element

Verdict key: **Keep** (real data, fits), **Change** (real but shown wrong or missing
something), **Cut** (fake, duplicated, or contradicts a decision), **Add** (exists in the
app, missing from the reference).

### Sidebar

| Element                                   | Data source                                       | Verdict                                                                                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logo + "Tab Topics"                       | `public/icon/48.png`                              | Keep                                                                                                                                                                                                                                |
| All topics · count                        | `topics.length`                                   | Keep                                                                                                                                                                                                                                |
| Recently closed · count                   | Σ `topic.recentlyClosed.length`                   | Keep. It needs a **new view** that lists them across topics (data exists; today it lives only inside each card).                                                                                                                    |
| Parked tabs · count                       | Σ `topic.parked.length` + `unsortedParked.length` | Keep, with a new cross-topic view. The count **must include unsorted**, or a tab parked from a window without a topic never shows up.                                                                                               |
| Settings                                  | `settings`                                        | Change: there is no settings page today. Make it a view that holds Auto-park and Backup and recovery (see §3).                                                                                                                      |
| "Backup ready · Last export: 2 hours ago" | `settings.lastExportAt`, `needsBackup()`          | Change. "Backup ready" means nothing. Show one of three real states: `Backed up 2 hours ago` (ok), `Last backup 3 weeks ago` (warn, same 14-day rule as `needsBackup`), `Never backed up` (warn). Hide it when there are no topics. |
| Export backup button                      | `exportData`                                      | Keep. It **replaces** the `BackupReminder` banner, so export is not offered in three places.                                                                                                                                        |
| _(missing)_ Badge on Parked / Closed      | counts                                            | Add: hide the count badge at 0 rather than showing "0".                                                                                                                                                                             |

### Header

| Element                                          | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Your workspace" / "Pick up where you left off." | Cut the tagline (filler). Title = current view name ("All topics", "Recently closed"…). Subtitle = **real window state**: `This window is Japanese` when linked, otherwise `This window is not saved · 8 tabs` (needs a tab count; see §4).                                                                                                                                                                                                         |
| Search "topics, tabs or domains"                 | Change. `src/core/search.ts` indexes tab title, host and URL, **not topic names**. Either add topic-name matching to the index (small, testable) or use the true placeholder "Search tabs and sites". Recommended: add topic matching, since it is what people will type.                                                                                                                                                                           |
| "Ctrl K" hint                                    | Change. Keep `/` (existing) and add Ctrl+K / ⌘K. Pick the label from the platform at runtime, never a hardcoded "Ctrl". **Research:** Chrome gives the address bar focus first on every new tab, and a page cannot take it ([Override Chrome pages](https://developer.chrome.com/docs/extensions/override)). So the shortcut only works after the user clicks the page. The search box still needs to be clearly clickable. Do not try `autofocus`. |
| "Save current window" button                     | Change. It is real (`saveWindow`), but it needs a name, so the button opens a small popover with the name field (Enter saves, Escape closes, focus returns to the button). When this window is already a topic, show `Linked to Japanese` (with a Switch/Park menu) instead of the button. Today's rule (no saving a linked window) stays.                                                                                                          |

### Stats row (2 saved topics · 23 tabs · 5 recently closed)

**Cut.** All three numbers are real, but two of them repeat the sidebar badges and none of
them leads to an action. If a summary is wanted, put one line under the "Saved topics"
heading: `2 topics · 23 tabs · 1 open`. It costs 20px instead of 100px, and "open" is the one
number the sidebar does not show.

### "Saved topics" toolbar

| Element             | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Count chip          | Keep (`topics.length`; it matches the active filter while searching).                                                                                                                                                                                                                                                                                                                                                        |
| Sort "Last updated" | Change. `docs/decisions.md` (Phase 3) chose **creation order because live re-sorting makes cards jump**. Offer `Created` (default), `Name`, `Last updated`, `Most tabs`. For the time-based sorts, compute the order once when the sort is chosen or the page loads, and do not re-sort on store changes, so nothing jumps. Save the choice as a per-page preference in `localStorage` (try/catch), not in the synced store. |
| Grid / list toggle  | Keep, step 4. A compact list (one row per topic) is useful past ~12 topics. Same preference storage as sort.                                                                                                                                                                                                                                                                                                                 |

### Topic card

| Element                                 | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coloured left edge + icon tile (あ, 💬) | Change. **The model has no topic colour or icon**, and those glyphs were chosen by hand. Step 1 derives both: colour = stable hash of `topic.id` into the existing `SECTION_COLORS` palette (it matches tab group colours and survives renames), tile = first grapheme of the name (`Intl.Segmenter`, so emoji and あ work). Step 5 (optional) adds `color?` and `icon?` to `TopicSchema` with a picker. That is a schema v2 migration, plus export/import round-trip tests. |
| Name, "17 tabs · Updated 7 minutes ago" | Keep (`plural`, `timeAgo`).                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| "17" chip                               | Cut. It repeats "17 tabs". Use that place for the **state badge the reference drops**: `This window` / `Open` / `Saved`. Open vs saved is the main thing this extension tracks.                                                                                                                                                                                                                                                                                              |
| Favicon row, "+8"                       | Keep (`api.favicon`, browser cache, no network). Show as many as fit in one row (measure, or 9 at card width), not a fixed 12 that wraps. `+N` = the rest. Keep `aria-hidden`; the tab list is the accessible version.                                                                                                                                                                                                                                                       |
| Open (primary)                          | Change: it reads `Switch to` when the topic is open, as today.                                                                                                                                                                                                                                                                                                                                                                                                               |
| Rename, Delete as buttons + ⋮ menu      | Change. The reference shows both buttons and a menu, but leaves out **Park** and **Unlink**, which are core actions. Visible: primary `Open/Switch to`, plus `Park` when open. In ⋮: Rename, Unlink (when open), Delete. Delete stays one click, with the Undo toast. The menu is a button with `aria-haspopup="menu"`, arrow-key navigation and Escape to close; every item's accessible name includes the topic name.                                                      |
| "Recently closed (5)" + ⌄ + ›           | Change. It has two affordances (expand and navigate), and a card today can have up to three lists (Tabs, Parked, Recently closed). Replace them with one footer row of real chips: `Tabs & sections (1)` · `Parked 3` · `Closed 5`, each hidden at 0. Clicking a chip opens the **topic drawer** (§3) on that tab. This also fixes the current grid problem where an expanded `<details>` makes one card very tall.                                                          |

### Parking panel

| Element                          | Verdict                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Explanation text                 | Keep (it is accurate).                                                                                                                     |
| On/off toggle                    | Change. The model has **three** modes: `on`, `dry-run`, `off`. A toggle loses dry-run. Use a segmented control: `Off · Preview only · On`. |
| "14" dropdown                    | Change. Presets 3/7/14/30/60/90, plus the stored value if it is not a preset (1–365 are valid). Otherwise a stored `21` would show as 14.  |
| "Preview parked tabs"            | Change the label. It is a dry run of what **would** be parked, not a list of parked tabs: "See what would be parked now".                  |
| _(missing)_ unsorted parked list | Add, in the Parked view.                                                                                                                   |
| Placement                        | Move to Settings. On All topics, at most one status line: `Auto-park on · after 14 days` linking to Settings.                              |

### Backup and recovery panel

| Element                                              | Verdict                                                                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Export backup now / Import backup                    | Keep. Add the existing note "Importing adds topics; it never replaces the ones you have."                                    |
| "You can also set up automatic backups in settings." | **Cut. Automatic backups do not exist.**                                                                                     |
| _(missing)_ Deleted topics (30-day trash), snapshots | Add. Both exist today (`store.trash`, `listSnapshots` / `restoreSnapshot` with a confirm step) and the reference drops them. |
| Placement                                            | Move to Settings. The sidebar status card covers the everyday case.                                                          |

### States the reference does not show, which must survive

- Empty store (no topics): onboarding text plus the Save action, with the sidebar still shown.
- Search results view (`SearchResults`): replaces the grid while a query is typed.
- Error notice (`role="alert"`) and the toast with Undo (polite live region, pauses while hovered or focused).
- Unreadable store screen (`UnreadableActions`): no sidebar, just download / start fresh.
- Dark mode. Today's tokens have a dark set and the reference is light only. Every new token needs both.
- Narrow windows: below ~760px the sidebar collapses into a top bar with a horizontal nav.
- `prefers-reduced-motion`.

---

## 2. Rules for "no hardcoded data"

1. **One selectors module**: `src/ui/selectors.ts`. Pure functions from `Store` (+ `now`,
   `currentTopicId`) to view data: `counts(store)`, `backupStatus(settings, hasTopics, now)`,
   `allRecentlyClosed(store)`, `allParked(store)`, `sortTopics(topics, key)`,
   `topicAccent(id)`, `monogram(name)`. Components never add up arrays themselves. Each
   selector gets unit tests, including zero and one.
2. **Numbers go through `plural()`, times through `timeAgo()`.** No `"5 tabs"` in JSX.
3. **Durations come from constants**: `settings.autoParkDays`, `RECENTLY_CLOSED_DAYS`,
   `TRASH_DAYS` and the backup reminder's `REMIND_AFTER_MS`. "Kept 30 days" is currently a
   literal in `BackupPanel.tsx` and should use `TRASH_DAYS`.
4. **Every count has a zero state**: hide the badge or chip, or show an empty-view message
   that says what fills it ("Tabs you close in a topic window appear here for 30 days").
5. **No copy for features that do not exist** (automatic backups, cloud sync, "Ctrl" on a Mac).
6. **Platform labels at runtime**: `navigator.userAgentData?.platform ?? navigator.platform`.
7. **A test fixture, not a demo**. For screenshots, use `tests/unit/factories.ts` in a
   Playwright fixture. Nothing in `src/` ever ships sample topics.

---

## 3. Information architecture

```
┌ Sidebar ──────────┐┌ Main ─────────────────────────────────────────────────┐
│ Tab Topics        ││ <View title>           [ Search… / ]  [Save window ▸] │
│ ▸ All topics    N ││ <This window is X | not saved · N tabs>               │
│   Recently closed N││                                                       │
│   Parked        N ││ View body:                                            │
│ ───────────────── ││   All topics  → toolbar (count · sort · grid/list)   │
│   Settings        ││                 + cards  + auto-park status line      │
│                   ││   Recently closed → one list across topics, grouped  │
│ ┌ backup status ┐ ││                 by topic, Restore per row             │
│ │ ● Backed up 2h│ ││   Parked → per topic + "No topic" group,             │
│ │ [Export]      │ ││                 Restore / Restore all                 │
│ └───────────────┘ ││   Settings → Auto-park · Backup · Deleted · Snapshots│
└───────────────────┘└───────────────────────────────────────────────────────┘
                       Topic drawer (right, over the main view):
                       Tabs & sections | Parked | Recently closed
                       = today's TabsPanel + restore lists, unchanged logic
```

- **Routing**: `location.hash` (`#/`, `#/closed`, `#/parked`, `#/settings`, `#/topic/<id>/<tab>`).
  No router dependency. Back and forward work, and a reload keeps the view.
- **Search is global**: typing in any view shows the results view; Escape clears it and
  returns to the view you were on.
- **Drawer**: `<dialog>` used as a non-modal side sheet (or `role="dialog"` with a focus trap),
  closed with Escape, focus returned to the chip that opened it. It reuses `TabsPanel` and the
  restore rows as they are, so grouping, moving and restore logic does not change.

---

## 4. Gaps in the data, and what to do about them

| Wanted in UI                             | Have it?                                             | Plan                                                                                                          |
| ---------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Topic colour / icon                      | No                                                   | Derive now (§1). Optional schema v2 later.                                                                    |
| Tab count of the current, unsaved window | No (the page only knows its window id)               | `chrome.tabs.query({ currentWindow: true })` in `Api`, refreshed on `onLinks` / focus. Fall back to no count. |
| Search by topic name                     | No                                                   | Add topic entries to `buildIndex`; results show a topic row first.                                            |
| "Open" topics count                      | Yes (`windowId !== null`), but stale after a restart | Use session links (as `currentTopicId` does), not the stored `windowId`.                                      |
| Sort / view preference                   | No                                                   | `localStorage`, per page, with try/catch. It is not user data, so no migration.                               |
| Automatic backups                        | No                                                   | Out of scope. Do not mention it.                                                                              |

---

## 5. Visual system

- Keep the token approach in `styles.css` (`:root` + `prefers-color-scheme: dark`) and extend it:
  `--sidebar-bg`, `--surface-2`, `--accent-soft`, `--warn`, `--ok`, `--shadow-1`, radius 12/8, and a
  4px spacing scale. Topic accents map to `SECTION_COLORS`, with a light and a dark value each,
  checked for contrast (≥ 3:1 for the edge and tile, ≥ 4.5:1 for any text on them).
- Icons: a small inline SVG set (folder, clock, archive, gear, search, plus, more, chevron,
  eye, upload, cloud, car→"park"). Inline in one `icons.tsx`: no icon font, no CDN, no new
  permission, which keeps the page network-free.
- System font stack, as today. Card grid `repeat(auto-fill, minmax(340px, 1fr))`.
- Performance: cards stay `memo`'d, and the drawer renders lists only while open. The
  first-render `performance.mark` budget from Phase 3 still applies.

---

## 6. Build steps (each one a PR, `npm run verify` green)

1. **Selectors and tokens.** Add `selectors.ts` with tests, `icons.tsx`, the new CSS tokens
   (light and dark), and `topicAccent` / `monogram`. No visible change yet.
2. **Shell.** Sidebar, header (view title, live window line, search, Save popover), hash
   routing, and the sidebar backup card replacing `BackupReminder`. Move Parking and Backup to
   `#/settings`. Update the e2e specs that click into these panels.
3. **Cards and drawer.** Card redesign (state badge, favicon row, ⋮ menu with Rename, Unlink
   and Delete, footer chips) and the topic drawer hosting `TabsPanel` and the restore lists.
4. **Cross-topic views and toolbar.** Recently closed and Parked views, the sort menu with the
   no-jump rule, the grid/list toggle, and topic-name search.
5. **(Optional) Topic colour and icon.** Schema v2 migration, picker in the ⋮ menu, and
   export/import round-trip tests.

Each step adds an entry to `docs/decisions.md` and keeps these tests green: keyboard access
(every action reachable, names include the topic), axe checks in jsdom for the new views,
both colour schemes, and a 375px-wide screenshot in Playwright.

---

## 7. Open questions

- Should **Delete** move into ⋮ (fewer misclicks, one more step), or stay visible as in the
  reference? Recommended: ⋮, since Undo covers mistakes but the button sits next to Open.
- Should the **list view** be in v1, or wait until someone has more than ~12 topics?
- Should we take on the **schema v2** colour/icon step at all, or are derived accents enough?

---

## 8. Revision: home page with a slide-in rail (workflow image)

The workflow shows three frames: (1) a calm browser home with a search bar, (2) Ctrl+K slides
the icon rail in from the left, (3) a panel of topic cards rises from the bottom. This replaces
the "rail and cards always on screen" layout from sections 3 and 6.

### What is not possible

Frames 1 and 2 draw the rail over Brave's own new tab page. Extensions cannot run on
browser-internal pages, so we cannot overlay that page. The nearest option is to own the whole
new tab page (we already do) and make it look like the calm home in frame 1. Brave's logo,
widgets and wallpaper are not available to us and are not copied.

### Decisions (from the user)

| Question                                    | Decision                                                                                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Home hides the rail and topics until Ctrl+K | Yes, as in the workflow                                                                                                                        |
| Search bar on home                          | Yes. Adds the `search` permission; runs the default engine with `chrome.search.query` in the current tab                                       |
| Background                                  | An image the user picks, saved in this browser only. Until one is chosen, a gradient built from the theme tokens. No remote images, no network |

### Flow and states

1. **Home.** Background, search bar, and a small hint "Press Ctrl+K for your topics". No topic
   data on screen. The search input is focused on load.
2. **Rail open.** Ctrl+K (⌘K on Mac) or moving the pointer to the left edge slides the pill rail
   in. Esc, Ctrl+K again, or a click outside hides it. Reduced motion: no slide, it just appears.
3. **Panel open.** Choosing a rail item raises a bottom sheet with that view: All topics,
   Recently closed, Parked tabs or Settings. The sheet reuses the existing views unchanged.
   Esc closes the sheet first, then the rail. The URL hash still names the open view, so a
   reload or a new-tab link lands on the same sheet.
4. **Deep links.** A hash such as `#/settings` opens straight to the sheet with the rail visible,
   so existing e2e paths and bookmarks keep working.

### Impact on what exists

- **Shortcuts.** Ctrl+K moves from "focus the topic search" to "toggle the rail". Topic search
  moves into the sheet header and keeps `/`. The focus-first caveat stays: a new tab gives the
  address bar focus, so the shortcut only works after the page is focused. The search input is
  auto-focused on load to cover the common case, to be checked in Brave.
- **Backup cloud and counts.** They live on the rail, unchanged. Counts remain in hover labels.
- **Search permission.** The README privacy statement must say the new tab page can run a web
  search in the default engine only when the user submits the bar.
- **Background image.** Stored as a Blob in IndexedDB (too large for `localStorage`), excluded
  from export like the other display preferences, and removable. Size is capped, so a huge
  photo cannot fill storage. A broken or missing image falls back to the gradient.

### Build steps

1. **Home and search.** `Home.tsx` with the gradient background and search bar, the `search`
   permission, tests for query submission and empty input.
2. **Rail and sheet choreography.** Rail hidden by default, slide-in on Ctrl+K and the left edge,
   bottom sheet with focus trap, Esc order, hash sync, reduced motion. Update the e2e specs.
3. **Background picker.** Settings control, IndexedDB storage with a size cap, fallback, remove.
4. **Docs.** `docs/decisions.md`, README privacy and shortcut lines.

### Risks to check before building

- Whether Brave focuses the page or the address bar on an overridden new tab.
- Whether `chrome.search.query` with `disposition: 'CURRENT_TAB'` behaves the same in Brave as in
  Chromium.
- Ctrl+K is the browser's own "search" shortcut when the address bar has focus, so the extension
  must not claim it as a global command. It is a page-level key handler only.
