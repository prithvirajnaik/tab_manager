import { useState } from 'preact/hooks';
import type { Topic } from '../core/model';
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

export function TopicCard({ topic, isCurrentWindow, busy, now, favicon, actions }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(topic.name);
  const isOpen = topic.windowId !== null;
  const headingId = `topic-${topic.id}`;

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== topic.name) actions.rename(topic.id, draft);
    else setDraft(topic.name);
  };

  return (
    <article class={`card${isOpen ? ' card--open' : ''}`} aria-labelledby={headingId}>
      <header class="card__head">
        {editing ? (
          <input
            class="card__rename"
            aria-label={`New name for ${topic.name}`}
            value={draft}
            maxLength={200}
            autoFocus
            onInput={(e) => setDraft(e.currentTarget.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(topic.name);
                setEditing(false);
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
          onClick={() => actions.open(topic.id)}
        >
          {isOpen ? 'Switch to' : 'Open'}
        </button>
        {isOpen && (
          <button type="button" class="btn" disabled={busy} onClick={() => actions.park(topic.id)}>
            Park
          </button>
        )}
        <button
          type="button"
          class="btn btn--quiet"
          disabled={busy}
          aria-label={`Rename ${topic.name}`}
          onClick={() => {
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
        <details class="tabs">
          <summary>Tabs</summary>
          <ul>
            {topic.tabs.map((t) => (
              <li key={t.id} class="tab" title={t.url}>
                <img src={favicon(t.url)} alt="" width={16} height={16} loading="lazy" />
                <span class="tab__title">{t.title || t.url}</span>
                {t.pinned && <span class="tab__flag">pinned</span>}
                <span class="tab__host">{hostOf(t.url)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {topic.parked.length > 0 && (
        <details class="tabs">
          <summary>Parked ({topic.parked.length})</summary>
          <ul>
            {topic.parked.map((t) => (
              <li key={t.id} class="tab" title={t.url}>
                <span class="tab__title">{t.title || t.url}</span>
                <span class="tab__host">{timeAgo(t.parkedAt, now)}</span>
                <button
                  type="button"
                  class="btn btn--small"
                  disabled={busy}
                  aria-label={`Restore ${t.title || t.url}`}
                  onClick={() => actions.restore(topic.id, t.id, 'parked')}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {topic.recentlyClosed.length > 0 && (
        <details class="tabs">
          <summary>Recently closed ({topic.recentlyClosed.length})</summary>
          <ul>
            {topic.recentlyClosed.map((t) => (
              <li key={t.id} class="tab" title={t.url}>
                <span class="tab__title">{t.title || t.url}</span>
                <span class="tab__host">{timeAgo(t.closedAt, now)}</span>
                <button
                  type="button"
                  class="btn btn--small"
                  disabled={busy}
                  aria-label={`Restore ${t.title || t.url}`}
                  onClick={() => actions.restore(topic.id, t.id, 'recentlyClosed')}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
