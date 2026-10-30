import type { ComponentChildren } from 'preact';
import type { SavedTab } from '../core/model';

type RowProps = {
  tab: SavedTab;
  meta: string;
  favicon: (url: string) => string;
  action?: ComponentChildren;
};

/** One saved tab in a list: favicon, title, a line of detail, and an optional action. */
export function TabRow({ tab, meta, favicon, action }: RowProps) {
  return (
    <li class="row" title={tab.url}>
      <img class="row__icon" src={favicon(tab.url)} alt="" width={16} height={16} loading="lazy" />
      <span class="row__text">
        <span class="row__title">{tab.title || tab.url}</span>
        <span class="row__meta">{meta}</span>
      </span>
      {action}
    </li>
  );
}

export function RestoreButton({
  tab,
  busy,
  onRestore,
}: {
  tab: SavedTab;
  busy: boolean;
  onRestore: () => void;
}) {
  return (
    <button
      type="button"
      class="btn btn--small"
      disabled={busy}
      aria-label={`Restore ${tab.title || tab.url}`}
      onClick={onRestore}
    >
      Restore
    </button>
  );
}

/** A view or panel with nothing in it yet: what it is for, and how it fills. */
export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ComponentChildren;
  title: string;
  children: ComponentChildren;
}) {
  return (
    <section class="empty">
      <span class="empty__icon">{icon}</span>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
