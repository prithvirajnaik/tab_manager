# Tab Topics

A Manifest V3 extension for Brave (and other Chromium browsers) that turns your new tab page into a list of **topics**. A topic is live-linked to a browser window: as you open, close, move and group tabs in that window, the saved topic updates itself. One click opens a topic in a new window; one click parks it. Idle tabs are parked after 14 days, never deleted. All data stays on your machine.

See [PLAN.md](PLAN.md) for scope and phases and [docs/decisions.md](docs/decisions.md) for design decisions.

## Develop

```sh
npm install
npx playwright install chromium
npm run dev      # WXT dev build with reload
npm run verify   # lint, typecheck, unit tests + coverage, build, e2e
```

## Load in Brave

1. `npm run build`
2. Open `brave://extensions`, enable **Developer mode**.
3. **Load unpacked** and pick `dist/chrome-mv3`.
4. Open a new tab. If Brave asks whether to keep the extension's new tab page, choose **Keep it**. Disable any other new-tab extension (Toby, Workona) first: only one extension can override the new tab page.
