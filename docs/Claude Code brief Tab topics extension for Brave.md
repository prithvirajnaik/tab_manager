# Claude Code brief: Tab topics extension for Brave

Oct 27, 2026 · @prithvi

Paste the prompt below into Claude Code, drop the rest of this doc into the repo as PLAN.md, and it builds the extension in gated phases with tests and its own code review before each push. Decisions locked in: Brave (Chromium, Manifest V3), live-linked topics, local-first storage, auto-park after 14 days.

## Kickoff prompt

Paste this as your first message in an empty repo, after saving the sections below as PLAN.md.

```text
You are building "Tab Topics", a Manifest V3 browser extension for Brave (Chromium). Read PLAN.md in this repo first. It is the source of truth for scope, architecture, phases and standards.

Product in one paragraph: the new tab page lists my "topics" (for example Japanese, Programming). A topic is live-linked to a browser window: as I open, close, move and group tabs in that window, the saved topic updates automatically. One click on a topic opens it in a new window; one click parks it (saves and closes). Idle tabs are parked automatically after 14 days, never deleted. All data stays local, with JSON export and import.

How to work:
1. Work through the phases in PLAN.md in order. One git branch per phase, named phase-N-short-name. Do not start phase N+1 until phase N's gate passes.
2. Test first for all logic modules: write the failing test, then the code. Keep browser API calls behind a thin adapter so the logic is unit-testable without a browser.
3. Before relying on any extension API behavior, check it against the current official Chrome extension docs at developer.chrome.com. If you cannot verify something, say so in the phase report instead of guessing.
4. Before every push, run the full verify command (lint, typecheck, unit tests, build, end-to-end tests). Then run the self-review protocol in PLAN.md using a fresh-context reviewer. Fix every blocker and major finding, re-run verify, and only then push the branch and open a pull request.
5. Never push to main, never force-push, never skip hooks or tests. Never write code that deletes user data: parking moves tabs, it does not destroy them.
6. If a decision is not covered in PLAN.md, pick the simplest default, record it in docs/decisions.md with one line of reasoning, and continue. Ask me only when blocked.
7. At the end of each phase, report: what shipped, test results, review findings fixed, and open questions.

Start by reading PLAN.md, then scaffold the repo and complete Phase 0.
```

## Build plan

Eight phases, each on its own branch and each ending in a gate Claude Code must pass before moving on. Phases 0 to 3 give you a usable save-and-reopen tool; phase 4 adds live-linking; phase 6 adds auto-parking.

| Phase | Deliverable | Tests required | Gate |
| --- | --- | --- | --- |
| 0. Scaffold | Repo, TypeScript strict, Vite with a maintained MV3 plugin, lint, format, Vitest, Playwright, CI, pre-push hook, a `verify` script, minimal manifest | Smoke test: Playwright loads the built extension and finds its service worker | CI green on an empty extension; extension loads manually in Brave and overrides the new tab page |
| 1. Data layer | Typed Topic model, versioned schema with migrations, storage adapter, JSON export and import with validation, rolling snapshots | Unit: migrations, import rejects malformed files, snapshot rotation, serialized writes | 90%+ line coverage on `src/core`; export then import round-trips exactly |
| 2. Save and reopen | Save current window as a named topic; open a topic in a new window; park (save and close) | Unit with a fake browser adapter; e2e: save, close, reopen restores the same URLs and pinned state | e2e passes; manual check in Brave |
| 3. New tab page | Topic list, open and park buttons, rename and delete with undo, renders from local storage | Component tests; e2e on the new tab page; render timing check with 50 topics | Page renders without waiting on any async call beyond one storage read |
| 4. Live link | A window stays bound to its topic; tab create, update, move, close and window events update the topic; reconcile on browser start; closed tabs kept 30 days in the topic's Recently closed | Unit: event-sequence tests for the reducer and reconciler, including a simulated service worker restart; e2e for add, close, move | No event sequence in the tests can lose a saved tab; manual check after a full Brave restart |
| 5. Sections and search | Group tabs into named sections inside a topic, mirrored to Chrome tab groups; search across all topics by title and URL; move tabs between topics | Unit: grouping and search ranking; e2e: group, reopen, groups restored | Grouping survives close and reopen |
| 6. Auto-park and discard | Alarm-driven park rule (default 14 days, adjustable), pinned, active and audible tabs exempt, Parked list with one-click restore, discard background tabs in topic windows | Unit: the rule as a pure function with a fixed clock, covering every exemption; e2e with an injected clock | A dry-run mode lists what would be parked and parks nothing; restore returns every tab |
| 7. Hardening | Export and import UI, error states, keyboard and screen-reader pass, README, release build, Brave acceptance checklist | Full verify, plus a written manual checklist run in Brave | All earlier gates still green; checklist signed off in the PR |

## Architecture and data model

Browser events reach the service worker through one adapter, the worker hands state to a pure core and gets new state back, and the new tab page only reads storage and sends commands.

&#91;embedded content: extension architecture · 6 components\]

Because the core never imports `chrome.*`, the reducer, reconciler and park rule can be tested with plain inputs and a fixed clock.

**Data model** (a starting point; Claude Code may refine it and must record changes in `docs/decisions.md`):

```ts
type SavedTab = {
  id: string; url: string; title: string; favIconUrl?: string;
  pinned: boolean; sectionId?: string;
  lastActiveAt: number;        // own record, updated from tabs.onActivated
  openerTabId?: string;        // for tangent tracking later
};

type Topic = {
  id: string; name: string; note?: string;
  windowId: number | null;     // live link; null while its window is closed
  tabs: SavedTab[];
  sections: { id: string; name: string }[];
  recentlyClosed: (SavedTab & { closedAt: number })[];  // kept 30 days
  parked: SavedTab[];          // auto-parked or parked by hand
  createdAt: number; updatedAt: number;
};

type Store = {
  schemaVersion: number;
  topics: Topic[];
  unsortedParked: SavedTab[];  // idle tabs from windows with no topic
  settings: { autoParkDays: number };   // default 14
  snapshots: { at: number; topics: Topic[] }[];  // rolling, newest first
};
```

- **Where it lives.** `Store` sits in `chrome.storage.local`; the window-to-topic map sits in `chrome.storage.session`, since window IDs do not survive a restart.
- **Writes.** Every write goes through one queue in the service worker so two events cannot overwrite each other; a snapshot is taken before any bulk change.
- **Messages.** The new tab page sends typed commands (save window, open topic, park topic, restore tab) and never writes to storage itself.

## Engineering standards and definition of done

The standards keep logic testable without a browser and keep the extension safe to run on your real tabs.

- **Stack.** TypeScript in strict mode; Vite with whichever MV3 plugin (WXT or CRXJS) has the most recent releases, logged in `docs/decisions.md`; Preact for the new tab page to keep it small; zod to validate stored and imported data; Vitest for unit and component tests; Playwright for end-to-end tests; ESLint and Prettier.
- **Pure core, thin adapter.** All logic lives in `src/core` with no `chrome.*` imports. `src/adapters/browser.ts` wraps the browser APIs, and tests use a fake adapter.
- **Minimal permissions.** `tabs`, `storage`, `unlimitedStorage`, `alarms`, `tabGroups`, plus `favicon` only if needed. No host permissions, no remote code, no network requests, no analytics.
- **Git.** Conventional Commits, one branch per phase, pull request with the gate checklist, squash merge, never commit to main directly. A pre-push hook runs `npm run verify`.
- **`verify`** runs lint, typecheck, unit tests, build and end-to-end tests. CI runs the same script on every pull request.
- **Coverage.** At least 90% line coverage on `src/core`, and every bug fix ships with a regression test that failed before the fix.
- **End-to-end testing.** Use Playwright's bundled Chromium with `launchPersistentContext` and `--load-extension`, because Playwright's docs say Chrome and Edge removed the flags needed to side-load extensions ([Playwright docs](https://playwright.dev/docs/chrome-extensions)). I did not check whether Brave kept them, so Brave-specific behavior is covered by the manual checklist each phase.

**A phase is done when:**

1. `npm run verify` passes locally and in CI.
2. New logic has tests that were written first.
3. The self-review has no open blocker or major findings.
4. A manual check in Brave is recorded in the pull request.
5. README, PLAN.md and `docs/decisions.md` match the code.
6. The phase report is posted.

## Self-review protocol before every push

Claude Code reviews its own diff with a reviewer that has not seen how the code was written, then fixes what it finds before anything is pushed.

1. Run `npm run verify`. Do not review failing code.
2. Start a fresh-context reviewer (a subagent, or the built-in review command) and give it only the diff against the base branch, PLAN.md and the checklist below.
3. The reviewer returns findings tagged blocker, major, minor or nit, each with a file and line.
4. Fix every blocker and major, re-run `verify`, and re-review the changed areas. After three rounds with open blockers, stop and ask me.
5. Paste the final findings and what was done about each into the pull request description, then push.

**Reviewer checklist**

- **Data safety.** Can any code path delete or overwrite saved tabs without a snapshot or a way back? Is every write to storage serialized, so two events cannot overwrite each other?
- **Service worker.** No state in global variables; event listeners registered synchronously at the top level; every handler safe to run twice or after a restart.
- **Untrusted input.** Tab titles and URLs come from web pages and imported files. Nothing inserts them as raw HTML, and imports are validated against the schema.
- **Permissions and privacy.** No permission beyond the list in the standards; no network calls.
- **Tests.** Do the tests assert behavior, or just execute lines? Is there a test for each failure mode the code handles?
- **Performance.** Does the new tab page read storage once and render? Are event handlers debounced?
- **Scope.** Does the diff match the current phase, with nothing extra?

## Known risks

The biggest risk is a live-linked topic losing a tab you meant to keep; the rest are platform constraints to design around.

| Risk | What to do |
| --- | --- |
| Closing a tab in a live-linked window removes it from the topic, which recreates the fear of closing tabs | Closed tabs stay in the topic's Recently closed list for 30 days with one-click restore (built in phase 4) |
| The service worker is terminated after 30 seconds idle or a 5-minute request ([Chrome docs](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)), and globals are lost | Keep state in `chrome.storage`; register listeners synchronously at the top level; test a simulated restart |
| Window and tab IDs are only unique within a browser session (MDN), so the window-to-topic link breaks on restart | Reconcile at startup by matching each window's URL set to topics; let you attach or detach manually; verify the ID behavior against the Chrome docs |
| An extension can override only one built-in page and cannot override the new tab page in incognito windows ([Chrome docs](https://developer.chrome.com/docs/extensions/override)); I did not verify how Brave treats this | Test the override in Brave at the phase 0 gate; document any Brave setting you must change; another new-tab extension will conflict, so remove Toby or Workona's takeover first |
| Idle detection: `tab.lastAccessed` is documented on MDN, but I did not confirm it in Chrome's own reference | Check Chrome's reference; fall back to recording your own last-active time from `tabs.onActivated` |
| Active tabs cannot be discarded (MDN) | The park rule never touches the active tab |
| Alarms have a 30-second minimum period (Chrome 120 and later) | Run auto-park every 30 minutes; set a minimum browser version in the manifest |
| Browser profile reset wipes local storage | Rolling snapshots, plus a reminder in the new tab page to export a JSON backup |
