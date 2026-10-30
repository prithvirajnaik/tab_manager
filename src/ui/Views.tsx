import { RECENTLY_CLOSED_DAYS, type ClosedTab, type ParkedTab, type Settings } from '../core/model';
import { hostOf, plural, timeAgo } from './format';
import { ArchiveIcon, ClockIcon } from './icons';
import type { TabGroup } from './selectors';
import { EmptyState, RestoreButton, TabRow } from './TabRows';

type Common = { busy: boolean; now: number; favicon: (url: string) => string };

/** Recently closed tabs of every topic, grouped by topic. */
export function ClosedView({
  groups,
  busy,
  now,
  favicon,
  onRestore,
}: Common & {
  groups: TabGroup<ClosedTab, string>[];
  onRestore: (topicId: string, tabId: string) => void;
}) {
  if (groups.length === 0) {
    return (
      <EmptyState icon={<ClockIcon size={28} />} title="Nothing recently closed">
        <p>
          Tabs you close in a topic's window are kept here for {RECENTLY_CLOSED_DAYS} days, so you
          can bring them back.
        </p>
      </EmptyState>
    );
  }
  return (
    <div class="groups">
      {groups.map((g) => (
        <section key={g.topicId} class="group" aria-label={g.name}>
          <header class="group__head">
            <h2 class="group__title">{g.name}</h2>
            <span class="count">{g.tabs.length}</span>
          </header>
          <ul class="rows">
            {g.tabs.map((t) => (
              <TabRow
                key={t.id}
                tab={t}
                favicon={favicon}
                meta={`${hostOf(t.url)} · closed ${timeAgo(t.closedAt, now)}`}
                action={
                  <RestoreButton tab={t} busy={busy} onRestore={() => onRestore(g.topicId, t.id)} />
                }
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function emptyParkedText(settings: Settings) {
  switch (settings.autoParkMode) {
    case 'on':
      return `Tabs you have not looked at for ${plural(settings.autoParkDays, 'day')} are parked here: saved and closed, never deleted.`;
    case 'dry-run':
      return 'Auto-park is set to preview only, so nothing is parked automatically.';
    case 'off':
      return 'Auto-park is off. Tabs that could not be reopened with their topic are kept here too.';
  }
}

/** Parked tabs of every topic, then the ones from windows without a topic. */
export function ParkedView({
  groups,
  settings,
  busy,
  now,
  favicon,
  onRestore,
  onRestoreAll,
  onSettings,
}: Common & {
  groups: TabGroup<ParkedTab>[];
  settings: Settings;
  onRestore: (topicId: string | null, tabId: string) => void;
  onRestoreAll: (topicId: string | null) => void;
  onSettings: () => void;
}) {
  if (groups.length === 0) {
    return (
      <EmptyState icon={<ArchiveIcon size={28} />} title="Nothing parked">
        <p>{emptyParkedText(settings)}</p>
        <button type="button" class="btn" onClick={onSettings}>
          Auto-park settings
        </button>
      </EmptyState>
    );
  }
  return (
    <div class="groups">
      {groups.map((g) => (
        <section key={g.topicId ?? ''} class="group" aria-label={g.name}>
          <header class="group__head">
            <h2 class="group__title">{g.name}</h2>
            <span class="count">{g.tabs.length}</span>
            <button
              type="button"
              class="btn btn--small group__action"
              disabled={busy}
              aria-label={
                g.topicId
                  ? `Restore all parked tabs of ${g.name}`
                  : 'Restore all parked tabs without a topic'
              }
              onClick={() => onRestoreAll(g.topicId)}
            >
              Restore all
            </button>
          </header>
          <ul class="rows">
            {g.tabs.map((t) => (
              <TabRow
                key={t.id}
                tab={t}
                favicon={favicon}
                meta={`${hostOf(t.url)} · parked ${timeAgo(t.parkedAt, now)}`}
                action={
                  <RestoreButton tab={t} busy={busy} onRestore={() => onRestore(g.topicId, t.id)} />
                }
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
