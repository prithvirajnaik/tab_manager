import type { ComponentChildren } from 'preact';
import { memo } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Topic } from '../core/model';
import { plural, timeAgo } from './format';
import {
  ArchiveIcon,
  ClockIcon,
  FolderIcon,
  ParkIcon,
  PencilIcon,
  PlayIcon,
  TrashIcon,
  UnlinkIcon,
} from './icons';
import { Menu, type MenuItem } from './Menu';
import { monogram, topicAccent, uniqueSites } from './selectors';

export type DrawerPanel = 'tabs' | 'parked' | 'closed';

export type TopicActions = {
  open(topicId: string): void;
  park(topicId: string): void;
  detach(topicId: string): void;
  rename(topicId: string, name: string): void;
  remove(topicId: string): void;
  restore(topicId: string, tabId: string, from: 'recentlyClosed' | 'parked'): void;
  group(topicId: string, tabIds: string[], name: string): void;
  ungroup(topicId: string, sectionId: string): void;
  move(fromTopicId: string, tabId: string, toTopicId: string): void;
  restoreAllParked(topicId: string): void;
  /** Opens the topic drawer on one of its lists. */
  show(topicId: string, panel: DrawerPanel): void;
};

type Props = {
  topic: Topic;
  isCurrentWindow: boolean;
  busy: boolean;
  now: number;
  favicon: (url: string) => string;
  actions: TopicActions;
};

/** Websites shown in one row at the narrowest card width; the rest show as "+N". */
const MAX_ICONS = 6;

/** The topic's tile: its first character on its accent colour. */
export function TopicTile({ topic }: { topic: Topic }) {
  return (
    <span class={`tile accent--${topicAccent(topic.id)}`} aria-hidden="true">
      {monogram(topic.name)}
    </span>
  );
}

export function stateLabel(topic: Topic, isCurrentWindow: boolean) {
  return isCurrentWindow ? 'This window' : topic.windowId !== null ? 'Open' : 'Saved';
}

function TopicCardImpl({ topic, isCurrentWindow, busy, now, favicon, actions }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(topic.name);
  // Set once Enter/Escape has handled the edit, so the blur that follows does nothing.
  const settled = useRef(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  // Focus goes back to the menu button after Enter or Escape, not after tabbing away.
  const refocus = useRef(false);
  const isOpen = topic.windowId !== null;
  const headingId = `topic-${topic.id}`;

  useEffect(() => {
    if (editing) renameInput.current?.focus();
    else if (refocus.current) {
      refocus.current = false;
      menuButton.current?.focus();
    }
  }, [editing]);

  const finish = (save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const name = draft.trim();
    if (save && name && name !== topic.name) actions.rename(topic.id, name);
    else setDraft(topic.name);
    setEditing(false);
  };

  const items: MenuItem[] = [
    {
      label: 'Rename',
      ariaLabel: `Rename ${topic.name}`,
      icon: <PencilIcon size={16} />,
      disabled: busy,
      onSelect: () => {
        settled.current = false;
        setDraft(topic.name);
        setEditing(true);
      },
    },
    ...(isOpen
      ? [
          {
            label: 'Unlink from window',
            ariaLabel: `Unlink ${topic.name} from its window`,
            icon: <UnlinkIcon size={16} />,
            title: 'Stop syncing this topic with its window. The window stays open.',
            disabled: busy,
            onSelect: () => actions.detach(topic.id),
          },
        ]
      : []),
    {
      label: 'Delete',
      ariaLabel: `Delete ${topic.name}`,
      icon: <TrashIcon size={16} />,
      danger: true,
      disabled: busy,
      onSelect: () => actions.remove(topic.id),
    },
  ];

  const stats: {
    panel: DrawerPanel;
    icon: ComponentChildren;
    title: string;
    aria: string;
    n: number;
  }[] = [
    {
      panel: 'tabs',
      icon: <FolderIcon size={20} />,
      title: topic.sections.length ? 'Tabs and sections' : 'Tabs',
      aria: `Show tabs of ${topic.name}`,
      n: topic.tabs.length,
    },
    {
      panel: 'parked',
      icon: <ArchiveIcon size={20} />,
      title: 'Parked',
      aria: `Show parked tabs of ${topic.name}`,
      n: topic.parked.length,
    },
    {
      panel: 'closed',
      icon: <ClockIcon size={20} />,
      title: 'Recently closed',
      aria: `Show recently closed tabs of ${topic.name}`,
      n: topic.recentlyClosed.length,
    },
  ];
  const shown = stats.filter((c) => c.n > 0);
  const sites = uniqueSites(topic.tabs);

  return (
    <article
      class={`card accent--${topicAccent(topic.id)}${isOpen ? ' card--open' : ''}`}
      {...(editing ? { 'aria-label': topic.name } : { 'aria-labelledby': headingId })}
    >
      <header class="card__head">
        <TopicTile topic={topic} />
        <div class="card__heading">
          {editing ? (
            <input
              class="input card__rename"
              aria-label={`New name for ${topic.name}`}
              value={draft}
              maxLength={200}
              ref={renameInput}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onBlur={() => finish(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  refocus.current = true;
                  finish(e.key === 'Enter');
                }
              }}
            />
          ) : (
            <h2 id={headingId} class="card__title">
              {topic.name}
            </h2>
          )}
          <p class="card__meta">Updated {timeAgo(topic.updatedAt, now)}</p>
        </div>
        {/* Open or saved shows in the buttons; only "this window" is not visible elsewhere. */}
        {isCurrentWindow && <span class="badge badge--here">This window</span>}
        <Menu label={`More actions for ${topic.name}`} items={items} triggerRef={menuButton} />
      </header>

      {sites.length > 0 && (
        <ul class="icons" aria-hidden="true">
          {sites.slice(0, MAX_ICONS).map((site) => (
            <li key={site.key} title={`${site.key} · ${plural(site.count, 'tab')}`}>
              <img src={favicon(site.url)} alt="" width={22} height={22} loading="lazy" />
              {site.count > 1 && <span class="icons__n">{site.count}</span>}
            </li>
          ))}
          {sites.length > MAX_ICONS && <li class="icons__more">+{sites.length - MAX_ICONS}</li>}
        </ul>
      )}

      <div class="card__bar">
        <div class="card__actions">
          <button
            type="button"
            class="btn btn--primary btn--lg"
            disabled={busy}
            aria-label={`${isOpen ? 'Switch to' : 'Open'} ${topic.name}`}
            onClick={() => actions.open(topic.id)}
          >
            <PlayIcon size={14} />
            {isOpen ? 'Switch to' : 'Open'}
          </button>
          {isOpen && (
            <button
              type="button"
              class="btn btn--lg"
              disabled={busy}
              aria-label={`Park ${topic.name}`}
              title="Save the window's tabs and close it."
              onClick={() => actions.park(topic.id)}
            >
              <ParkIcon size={18} />
              Park
            </button>
          )}
        </div>
        {shown.length > 0 && (
          <div class="card__stats">
            {shown.map((c) => (
              <button
                key={c.panel}
                type="button"
                class="stat"
                title={c.title}
                aria-label={`${c.aria} (${c.n})`}
                onClick={() => actions.show(topic.id, c.panel)}
              >
                {c.icon}
                <span>{c.n}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

export const TopicCard = memo(TopicCardImpl);
