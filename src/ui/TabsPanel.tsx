import { useState } from 'preact/hooks';
import type { SavedTab, Topic } from '../core/model';
import { hostOf } from './format';
import { MoveTo } from './MoveTo';

export type TopicRef = { id: string; name: string };

type Props = {
  topic: Topic;
  otherTopics: TopicRef[];
  busy: boolean;
  favicon: (url: string) => string;
  onGroup: (tabIds: string[], name: string) => void;
  onUngroup: (sectionId: string) => void;
  onMove: (tabId: string, toTopicId: string) => void;
};

/** The open "Tabs" list of a card: tabs by section, with grouping and moving. */
export function TabsPanel({
  topic,
  otherTopics,
  busy,
  favicon,
  onGroup,
  onUngroup,
  onMove,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const row = (t: SavedTab) => (
    <li key={t.id} class="tab" title={t.url}>
      <input
        type="checkbox"
        aria-label={`Select ${t.title || t.url}`}
        checked={selected.has(t.id)}
        disabled={t.pinned}
        onChange={() => toggle(t.id)}
      />
      <img src={favicon(t.url)} alt="" width={16} height={16} loading="lazy" />
      <span class="tab__text">
        <span class="tab__title">{t.title || t.url}</span>
        <span class="tab__host">
          {t.pinned ? 'Pinned · ' : ''}
          {hostOf(t.url)}
        </span>
      </span>
      {otherTopics.length > 0 && (
        <MoveTo
          label={t.title || t.url}
          topics={otherTopics}
          busy={busy}
          onMove={(to) => onMove(t.id, to)}
        />
      )}
    </li>
  );

  const sectionIds = new Set(topic.sections.map((s) => s.id));
  const loose = topic.tabs.filter((t) => !t.sectionId || !sectionIds.has(t.sectionId));
  const chosen = topic.tabs.filter((t) => selected.has(t.id)).map((t) => t.id);

  return (
    <div class="tabs-panel">
      {topic.sections.map((s) => {
        const tabs = topic.tabs.filter((t) => t.sectionId === s.id);
        if (tabs.length === 0) return null;
        const label = s.name || 'Unnamed section';
        return (
          <section key={s.id} class={`section section--${s.color ?? 'grey'}`} aria-label={label}>
            <header class="section__head">
              <h3 class="section__name">{label}</h3>
              <button
                type="button"
                class="btn btn--small btn--quiet"
                disabled={busy}
                aria-label={`Ungroup ${label}`}
                onClick={() => onUngroup(s.id)}
              >
                Ungroup
              </button>
            </header>
            <ul>{tabs.map(row)}</ul>
          </section>
        );
      })}
      {loose.length > 0 && <ul>{loose.map(row)}</ul>}
      {chosen.length > 0 && (
        <form
          class="group-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            onGroup(chosen, name);
            setSelected(new Set());
            setName('');
          }}
        >
          <input
            class="save__input"
            aria-label="Section name"
            placeholder={`Section for ${chosen.length} selected`}
            value={name}
            maxLength={200}
            onInput={(e) => setName(e.currentTarget.value)}
          />
          <button type="submit" class="btn btn--small" disabled={busy || !name.trim()}>
            Group
          </button>
        </form>
      )}
    </div>
  );
}
