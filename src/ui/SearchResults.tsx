import type { SearchResult } from '../core/search';
import { hostOf } from './format';
import type { TopicRef } from './TabsPanel';

type Props = {
  query: string;
  results: SearchResult[];
  topics: TopicRef[];
  busy: boolean;
  favicon: (url: string) => string;
  onOpenTopic: (topicId: string) => void;
  onMove: (fromTopicId: string, tabId: string, toTopicId: string) => void;
  onRestore: (topicId: string, tabId: string, from: 'parked' | 'recentlyClosed') => void;
};

const LIST_LABEL = { tabs: '', parked: 'Parked', recentlyClosed: 'Recently closed' } as const;

export function SearchResults({
  query,
  results,
  topics,
  busy,
  favicon,
  onOpenTopic,
  onMove,
  onRestore,
}: Props) {
  if (results.length === 0) {
    return (
      <p class="empty" role="status">
        No tabs match “{query}”.
      </p>
    );
  }
  return (
    <section aria-label="Search results">
      <p class="page__hint" role="status">
        {results.length === 1 ? '1 tab' : `${results.length} tabs`} found
      </p>
      <ul class="results">
        {results.map((r) => {
          const title = r.tab.title || r.tab.url;
          return (
            <li key={`${r.topicId}:${r.list}:${r.tab.id}`} class="result" title={r.tab.url}>
              <img src={favicon(r.tab.url)} alt="" width={16} height={16} loading="lazy" />
              <div class="result__text">
                <span class="tab__title">{title}</span>
                <span class="tab__host">
                  {hostOf(r.tab.url)} · {r.topicName}
                  {LIST_LABEL[r.list] && ` · ${LIST_LABEL[r.list]}`}
                </span>
              </div>
              {r.list === 'tabs' ? (
                <>
                  <button
                    type="button"
                    class="btn btn--small"
                    disabled={busy}
                    aria-label={`Open ${r.topicName}`}
                    onClick={() => onOpenTopic(r.topicId)}
                  >
                    Open topic
                  </button>
                  <select
                    class="tab__move"
                    aria-label={`Move ${title} to another topic`}
                    disabled={busy}
                    value=""
                    onChange={(e) => {
                      const to = e.currentTarget.value;
                      e.currentTarget.value = '';
                      if (to) onMove(r.topicId, r.tab.id, to);
                    }}
                  >
                    <option value="">Move to…</option>
                    {topics
                      .filter((t) => t.id !== r.topicId)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </>
              ) : (
                <button
                  type="button"
                  class="btn btn--small"
                  disabled={busy}
                  aria-label={`Restore ${title}`}
                  onClick={() =>
                    onRestore(r.topicId, r.tab.id, r.list as 'parked' | 'recentlyClosed')
                  }
                >
                  Restore
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
