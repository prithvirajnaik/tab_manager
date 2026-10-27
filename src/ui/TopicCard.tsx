import type { ComponentChildren } from 'preact';
import { memo } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ClosedTab, ParkedTab, SavedTab, Topic } from '../core/model';
import { hostOf, plural, timeAgo } from './format';

export type TopicActions = {
  open(topicId: string): void;
  park(topicId: string): void;
  rename(topicId: string, name: string): void;
  remove(topicId: string): void;
  restore(topicId: string, tabId: string, from: 'recentlyClosed' | 'parked'): void;
};

type Props = {
  topic: Topic;
  isCurrentWindow: boolean;
  busy: boolean;
  now: number;
  favicon: (url: string) => string;
  actions: TopicActions;
};

const MAX_ICONS = 12;

/** A <details> whose list is only rendered while open, so closed cards stay cheap. */
function Disclosure({ summary, children }: { summary: string; children: () => ComponentChildren }) {
  const [open, setOpen] = useState(false);
  return (
    <details class="tabs" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{summary}</summary>
      {open && <ul>{children()}</ul>}
    </details>
  );
}

type TabRowProps = {
  tab: SavedTab;
  favicon?: (url: string) => string;
  meta: string;
  action?: ComponentChildren;
};

function TabRow({ tab, favicon, meta, action }: TabRowProps) {
  return (
    <li class="tab" title={tab.url}>
      {favicon && <img src={favicon(tab.url)} alt="" width={16} height={16} loading="lazy" />}
      <span class="tab__title">{tab.title || tab.url}</span>
      {tab.pinned && <span class="tab__flag">pinned</span>}
      <span class="tab__host">{meta}</span>
      {action}
    </li>
  );
}

function TopicCardImpl({ topic, isCurrentWindow, busy, now, favicon, actions }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(topic.name);
  // Set once Enter/Escape has handled the edit, so the blur that follows does nothing.
  const settled = useRef(false);
  const renameButton = useRef<HTMLButtonElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  // Focus goes back to Rename after Enter or Escape, not after tabbing away.
  const refocus = useRef(false);
  const isOpen = topic.windowId !== null;
  const headingId = `topic-${topic.id}`;

  useEffect(() => {
    if (editing) renameInput.current?.focus();
    else if (refocus.current) {
      refocus.current = false;
      renameButton.current?.focus();
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

  const restoreButton = (t: ClosedTab | ParkedTab, from: 'recentlyClosed' | 'parked') => (
    <button
      type="button"
      class="btn btn--small"
      disabled={busy}
      aria-label={`Restore ${t.title || t.url}`}
      onClick={() => actions.restore(topic.id, t.id, from)}
    >
      Restore
    </button>
  );

  return (
    <article
      class={`card${isOpen ? ' card--open' : ''}`}
      {...(editing ? { 'aria-label': topic.name } : { 'aria-labelledby': headingId })}
    >
      <header class="card__head">
        {editing ? (
          <input
            class="card__rename"
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
        <span class={`badge${isOpen ? ' badge--open' : ''}`}>
          {isCurrentWindow ? 'This window' : isOpen ? 'Open' : 'Saved'}
        </span>
      </header>

      <p class="card__meta">
        {plural(topic.tabs.length, 'tab')} · updated {timeAgo(topic.updatedAt, now)}
      </p>

      {topic.tabs.length > 0 && (
        <ul class="icons" aria-hidden="true">
          {topic.tabs.slice(0, MAX_ICONS).map((t) => (
            <li key={t.id}>
              <img src={favicon(t.url)} alt="" width={16} height={16} loading="lazy" />
            </li>
          ))}
          {topic.tabs.length > MAX_ICONS && (
            <li class="icons__more">+{topic.tabs.length - MAX_ICONS}</li>
          )}
        </ul>
      )}

      <div class="card__actions">
        <button
          type="button"
          class="btn btn--primary"
          disabled={busy}
          aria-label={`${isOpen ? 'Switch to' : 'Open'} ${topic.name}`}
          onClick={() => actions.open(topic.id)}
        >
          {isOpen ? 'Switch to' : 'Open'}
        </button>
        {isOpen && (
          <button
            type="button"
            class="btn"
            disabled={busy}
            aria-label={`Park ${topic.name}`}
            onClick={() => actions.park(topic.id)}
          >
            Park
          </button>
        )}
        <button
          ref={renameButton}
          type="button"
          class="btn btn--quiet"
          // aria-disabled, not disabled: it must stay focusable while the rename is saving.
          aria-disabled={busy}
          aria-label={`Rename ${topic.name}`}
          onClick={() => {
            if (busy) return;
            settled.current = false;
            setDraft(topic.name);
            setEditing(true);
          }}
        >
          Rename
        </button>
        <button
          type="button"
          class="btn btn--quiet btn--danger"
          disabled={busy}
          aria-label={`Delete ${topic.name}`}
          onClick={() => actions.remove(topic.id)}
        >
          Delete
        </button>
      </div>

      {topic.tabs.length > 0 && (
        <Disclosure summary="Tabs">
          {() =>
            topic.tabs.map((t) => (
              <TabRow key={t.id} tab={t} favicon={favicon} meta={hostOf(t.url)} />
            ))
          }
        </Disclosure>
      )}

      {topic.parked.length > 0 && (
        <Disclosure summary={`Parked (${topic.parked.length})`}>
          {() =>
            topic.parked.map((t) => (
              <TabRow
                key={t.id}
                tab={t}
                meta={timeAgo(t.parkedAt, now)}
                action={restoreButton(t, 'parked')}
              />
            ))
          }
        </Disclosure>
      )}

      {topic.recentlyClosed.length > 0 && (
        <Disclosure summary={`Recently closed (${topic.recentlyClosed.length})`}>
          {() =>
            topic.recentlyClosed.map((t) => (
              <TabRow
                key={t.id}
                tab={t}
                meta={timeAgo(t.closedAt, now)}
                action={restoreButton(t, 'recentlyClosed')}
              />
            ))
          }
        </Disclosure>
      )}
    </article>
  );
}

export const TopicCard = memo(TopicCardImpl);
