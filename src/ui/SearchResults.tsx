import type { Topic } from '../core/model';
import type { SearchResult } from '../core/search';
import { hostOf, plural } from './format';
import { MoveTo } from './MoveTo';
import type { TopicRef } from './TabsPanel';
import { stateLabel, TopicTile } from './TopicCard';

type Props = {
  query: string;
  results: SearchResult[];
  /** Topics whose name matches. */
  topicMatches: Topic[];
  currentTopicId: string | null;
  topics: TopicRef[];
  busy: boolean;
  favicon: (url: string) => string;
  onOpenTopic: (topicId: string) => void;
  onMove: (fromTopicId: string, tabId: string, toTopicId: string) => void;
  onRestore: (topicId: string, tabId: string, from: 'parked' | 'recentlyClosed') => void;
  onRestoreUnsorted: (tabId: string) => void;
};

const LIST_LABEL = {
  tabs: '',
  parked: 'Parked',
  unsortedParked: 'Parked',
  recentlyClosed: 'Recently closed',
} as const;

function summary(topics: number, tabs: number) {
  if (topics === 0) return `${plural(tabs, 'tab')} found`;
  if (tabs === 0) return `${plural(topics, 'topic')} found`;
  return `${plural(topics, 'topic')} and ${plural(tabs, 'tab')} found`;
}

export function SearchResults({
  query,
  results,
  topicMatches,
  currentTopicId,
  topics,
  busy,
  favicon,
  onOpenTopic,
  onMove,
  onRestore,
  onRestoreUnsorted,
}: Props) {
  if (results.length === 0 && topicMatches.length === 0) {
    return (
      <p class="empty" role="status">
        Nothing matches “{query}”.
      </p>
    );
  }
  return (
    <section class="search-results" aria-label="Search results">
      <p class="hint" role="status">
        {summary(topicMatches.length, results.length)}
      </p>

      {topicMatches.length > 0 && (
        <>
          <h2 class="group__title">Topics</h2>
          <ul class="rows">
            {topicMatches.map((t) => {
              const isOpen = t.windowId !== null;
              return (
                <li key={t.id} class="row">
                  <TopicTile topic={t} />
                  <span class="row__text">
                    <span class="row__title">{t.name}</span>
                    <span class="row__meta">
                      {stateLabel(t, t.id === currentTopicId)} · {plural(t.tabs.length, 'tab')}
                    </span>
                  </span>
                  <button
                    type="button"
                    class="btn btn--small btn--primary"
                    disabled={busy}
                    aria-label={`${isOpen ? 'Switch to' : 'Open'} ${t.name}`}
                    onClick={() => onOpenTopic(t.id)}
                  >
                    {isOpen ? 'Switch to' : 'Open'}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {results.length > 0 && (
        <>
          {topicMatches.length > 0 && <h2 class="group__title">Tabs</h2>}
          <ul class="rows">
            {results.map((r) => {
              const title = r.tab.title || r.tab.url;
              return (
                <li key={`${r.topicId}:${r.list}:${r.tab.id}`} class="row" title={r.tab.url}>
                  <img
                    class="row__icon"
                    src={favicon(r.tab.url)}
                    alt=""
                    width={16}
                    height={16}
                    loading="lazy"
                  />
                  <span class="row__text">
                    <span class="row__title">{title}</span>
                    <span class="row__meta">
                      {hostOf(r.tab.url)} · {r.topicName}
                      {LIST_LABEL[r.list] && ` · ${LIST_LABEL[r.list]}`}
                    </span>
                  </span>
                  {r.list === 'tabs' ? (
                    <>
                      <button
                        type="button"
                        class="btn btn--small"
                        disabled={busy}
                        aria-label={`Open topic ${r.topicName}`}
                        onClick={() => onOpenTopic(r.topicId)}
                      >
                        Open topic
                      </button>
                      <MoveTo
                        label={title}
                        topics={topics.filter((t) => t.id !== r.topicId)}
                        busy={busy}
                        onMove={(to) => onMove(r.topicId, r.tab.id, to)}
                      />
                    </>
                  ) : (
                    <button
                      type="button"
                      class="btn btn--small"
                      disabled={busy}
                      aria-label={`Restore ${title}`}
                      onClick={() =>
                        r.list === 'unsortedParked'
                          ? onRestoreUnsorted(r.tab.id)
                          : onRestore(r.topicId, r.tab.id, r.list as 'parked' | 'recentlyClosed')
                      }
                    >
                      Restore
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
