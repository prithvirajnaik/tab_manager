# Brave acceptance checklist

Run this by hand in Brave before trusting the extension with real tabs. The automated tests use Playwright's bundled Chromium, which may differ from Brave. Note the Brave version and tick each line in the pull request.

Brave version: ________ Date: ________ Result: pass / fail

## Install (phase 0)

- [ ] `npm run build`, load `dist/chrome-mv3` unpacked in `brave://extensions`; no errors on the extension card.
- [ ] A new tab shows Tab Topics (choose **Keep it** if Brave asks). The icon shows in the extensions menu.
- [ ] An incognito window still shows Brave's own new tab page.

## Save, open, park (phase 2 and 3)

- [ ] Save a window with a pinned tab and three normal tabs; the card shows 4 tabs and **This window**.
- [ ] **Park**: the window closes; the card says **Saved**.
- [ ] **Open**: a new window opens with the same tabs in order, the pinned tab still pinned.
- [ ] **Open** again on an open topic focuses its window instead of opening a second one.
- [ ] Rename (Enter saves, Escape cancels), Delete, then **Undo** in the toast; the topic comes back still linked.
- [ ] Favicons show on the cards (from the browser cache; no network requests in DevTools > Network).

## Live link (phase 4)

- [ ] In a topic window, open a tab, navigate it, drag it to another position: the card follows within a second.
- [ ] Close a tab: it appears under **Recently closed**; **Restore** reopens it in the window.
- [ ] Close the whole window with its X: the card says **Saved** and still lists every tab.
- [ ] Drag a tab from one topic window into another topic's window: it moves to the other topic, and is not listed as closed in the first.
- [ ] **Full restart**: with two topic windows open and Brave set to _Continue where you left off_, quit Brave and start it again. Both cards relink to their restored windows (they show **Open**, and new tabs in them are saved).
- [ ] Restart again with Brave set to open the new tab page: topics show **Saved** within about two minutes, with every tab kept.
- [ ] Reload the extension in `brave://extensions` with topic windows open: they stay linked.

## Sections and search (phase 5)

- [ ] Group two tabs in a topic window, name and colour the group: the card shows the section.
- [ ] Park and reopen the topic: the group comes back with its name and colour.
- [ ] Group tabs from the card's tab list (select, name, **Group**); ungroup from the card.
- [ ] Search (press `/`): results from several topics; Move a result to another topic with the **Move** button.

## Auto-park (phase 6)

- [ ] Set the mode to **Preview only** and press **Preview**: a list appears and no tab closes.
- [ ] Set the days to 1 and come back after a day (or test with the e2e clock): idle tabs move to **Parked**; pinned, active and playing tabs stay.
- [ ] **Restore all** on a card and in the Parking panel brings every parked tab back.

## Hardening (phase 7)

- [ ] **Export to a file** downloads `tab-topics-<date>.json`; the backup reminder disappears.
- [ ] **Import from a file** with that export adds copies and leaves the originals untouched.
- [ ] **Show snapshots** lists snapshots; restoring one asks for confirmation first.
- [ ] Keyboard only: Tab reaches every control with a visible focus ring; `/` focuses search; Escape clears it.
- [ ] Screen reader (Narrator or NVDA): cards are announced by topic name; buttons say which topic they act on; toasts are announced.
- [ ] Dark mode (`brave://settings/appearance`): the page follows it and stays readable.
- [ ] `npm run release` produces `dist/tab-topics-<version>-chrome.zip`, and that zip loads in Brave.
