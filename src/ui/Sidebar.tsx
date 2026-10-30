import type { ComponentChildren } from 'preact';
import { timeAgo } from './format';
import { ArchiveIcon, ClockIcon, CloudIcon, FolderIcon, GearIcon } from './icons';
import type { BackupStatus, Counts } from './selectors';

export const VIEWS = ['topics', 'closed', 'parked', 'settings'] as const;
export type View = (typeof VIEWS)[number];

export const VIEW_TITLES: Record<View, string> = {
  topics: 'Topics',
  closed: 'Recently closed',
  parked: 'Parked tabs',
  settings: 'Settings',
};

export const viewHref = (view: View) => (view === 'topics' ? '#/' : `#/${view}`);

export function viewFromHash(hash: string): View {
  const name = hash.replace(/^#\/?/, '');
  return (VIEWS as readonly string[]).includes(name) ? (name as View) : 'topics';
}

type Props = {
  /** Slid into view. Out of view it is also out of the tab order. */
  open: boolean;
  view: View;
  /** Whether a view is open in the panel, so the current link is marked only then. */
  current: boolean;

  counts: Counts;
  backup: BackupStatus;
  busy: boolean;
  now: number;
  onNavigate: (view: View) => void;
  onExport: () => void;
};

function NavLink({
  view,
  current,
  icon,
  count,
  onNavigate,
}: {
  view: View;
  current: View | null;
  icon: ComponentChildren;
  count?: number;
  onNavigate: (view: View) => void;
}) {
  // The rail shows icons only, so the name (and any count) lives in the hover label.
  const tip = count ? `${VIEW_TITLES[view]} (${count})` : VIEW_TITLES[view];
  return (
    <li>
      <a
        class="nav__link"
        href={viewHref(view)}
        data-tip={tip}
        aria-current={view === current ? 'page' : undefined}
        onClick={(e) => {
          // Modified clicks open the view in a new tab, as links do.
          if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          onNavigate(view);
        }}
      >
        {icon}
        <span class="visually-hidden">{tip}</span>
      </a>
    </li>
  );
}

function BackupButton({
  status,
  busy,
  now,
  onExport,
}: {
  status: BackupStatus;
  busy: boolean;
  now: number;
  onExport: () => void;
}) {
  if (status.kind === 'none') return null;
  const [title, detail] =
    status.kind === 'ok'
      ? ['Backed up', `Last export ${timeAgo(status.at, now)}`]
      : status.kind === 'stale'
        ? ['Backup is out of date', `Last export ${timeAgo(status.at, now)}`]
        : ['Not backed up yet', 'Your topics live only in this browser profile.'];
  return (
    <section class={`backup backup--${status.kind}`} aria-label="Backup">
      <button
        type="button"
        class="nav__link nav__link--tip-up"
        data-tip={`${title} · ${detail} Click to export.`}
        aria-label="Export backup"
        disabled={busy}
        onClick={onExport}
      >
        <CloudIcon size={22} />
        <span class="dot" aria-hidden="true" />
      </button>
      <span class="visually-hidden">
        {title}. {detail}
      </span>
    </section>
  );
}

export function Sidebar({
  open,
  view,
  current,
  counts,
  backup,
  busy,
  now,
  onNavigate,
  onExport,
}: Props) {
  return (
    <aside class={`sidebar${open ? ' sidebar--open' : ''}`}>
      <nav class="nav" aria-label="Tab Topics">
        <ul class="nav__list">
          <NavLink
            view="topics"
            current={current ? view : null}
            icon={<FolderIcon />}
            count={counts.topics}
            onNavigate={onNavigate}
          />
          <NavLink
            view="closed"
            current={current ? view : null}
            icon={<ClockIcon />}
            count={counts.recentlyClosed}
            onNavigate={onNavigate}
          />
          <NavLink
            view="parked"
            current={current ? view : null}
            icon={<ArchiveIcon />}
            count={counts.parked}
            onNavigate={onNavigate}
          />
        </ul>
        <ul class="nav__list nav__list--end">
          <NavLink
            view="settings"
            current={current ? view : null}
            icon={<GearIcon />}
            onNavigate={onNavigate}
          />
        </ul>
      </nav>
      <BackupButton status={backup} busy={busy} now={now} onExport={onExport} />
    </aside>
  );
}
