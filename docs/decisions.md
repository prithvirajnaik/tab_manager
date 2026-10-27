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
