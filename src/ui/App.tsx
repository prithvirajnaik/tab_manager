import { useDeferredValue } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Command, CommandResponse } from '../core/messages';
import { buildIndex, searchTabs } from '../core/search';
import type { Api, LoadResult } from './api';
import type { AutoParkResult } from '../core/commands';
import { BackupPanel, BackupReminder, needsBackup } from './BackupPanel';
import { ParkingPanel } from './ParkingPanel';
import { SearchResults } from './SearchResults';
import type { TopicRef } from './TabsPanel';
import { TopicCard, type TopicActions } from './TopicCard';

type Props = { initial: LoadResult; api: Api; now?: () => number };

type Toast = { message: string; undo?: Command };

const TOAST_MS = 10_000;
const MINUTE = 60_000;

const count = (n: number) => (n === 1 ? '1 tab' : `${n} tabs`);

/**
 * Reuses the previous object for every topic that did not change, so memoised cards skip
 * re-rendering when one topic's window changes.
 */
export function keepUnchanged(prev: LoadResult, next: LoadResult): LoadResult {
  if (!prev.ok || !next.ok) return next;
  const before = new Map(prev.store.topics.map((t) => [t.id, t]));
  const topics = next.store.topics.map((t) => {
    const old = before.get(t.id);
    return old && JSON.stringify(old) === JSON.stringify(t) ? old : t;
  });
  return { ok: true, store: { ...next.store, topics } };
}

/** Shown when stored data cannot be read: save it as-is, or start fresh keeping a backup. */
function UnreadableActions({
  onDownload,
  onReset,
}: {
  onDownload: () => void;
  onReset: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirm) confirmButton.current?.focus();
  }, [confirm]);
  return (
    <div class="panel__row">
      <button type="button" class="btn" onClick={onDownload}>
        Download the stored data
      </button>
      {confirm ? (
        <button ref={confirmButton} type="button" class="btn btn--primary" onClick={onReset}>
          Start fresh (the old data is kept as a backup)
        </button>
      ) : (
        <button type="button" class="btn" onClick={() => setConfirm(true)}>
          Start fresh…
        </button>
      )}
    </div>
  );
}

export function App({ initial, api, now = Date.now }: Props) {
  const [load, setLoad] = useState<LoadResult>(initial);
  const [currentTopicId, setCurrentTopicId] = useState<string | null>(null);
  // A counter, so overlapping commands do not clear each other's busy state.
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  // Minute-granular, so "updated 3 minutes ago" does not re-render every card constantly.
  const [minute, setMinute] = useState(() => Math.floor(now() / MINUTE) * MINUTE);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const topicsRef = useRef(load.ok ? load.store.topics : []);
  topicsRef.current = load.ok ? load.store.topics : [];

  useEffect(() => {
    const refreshCurrent = () => void api.currentTopicId().then(setCurrentTopicId);
    refreshCurrent();
    return api.subscribe((next) => setLoad((prev) => keepUnchanged(prev, next)), refreshCurrent);
  }, [api]);
  useEffect(() => {
    const id = setInterval(() => setMinute(Math.floor(now() / MINUTE) * MINUTE), MINUTE);
    return () => clearInterval(id);
  }, [now]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.closest(
        'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
      );
      if (e.key === '/' && !e.isComposing && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const box = document.getElementById('search');
        if (box) {
          e.preventDefault();
          box.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Latest closures behind stable functions, so memoised cards only re-render when their
  // own topic changes.
  const latest = useRef({ api, setToast });
  latest.current = { api, setToast };

  const helpers = useMemo(() => {
    const startToastTimer = () => {
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => latest.current.setToast(null), TOAST_MS);
    };
    const pauseToastTimer = () => clearTimeout(toastTimer.current);
    const showToast = (t: Toast) => {
      latest.current.setToast(t);
      startToastTimer();
    };
    const run = async (command: Command): Promise<CommandResponse> => {
      setPending((n) => n + 1);
      setError(null);
      try {
        const res = await latest.current.api.send(command);
        if (!res.ok) setError(res.error);
        return res;
      } finally {
        setPending((n) => n - 1);
      }
    };
    const reportRestore = (res: CommandResponse) => {
      const failed = res.ok ? (res.data as { failed?: number } | undefined)?.failed : 0;
      if (failed) showToast({ message: `${count(failed)} could not be opened and stayed parked.` });
    };
    const actions: TopicActions = {
      open: (topicId) =>
        void run({ type: 'openTopic', topicId }).then((res) => {
          const failed = res.ok ? (res.data as { failed?: number } | undefined)?.failed : 0;
          if (failed)
            showToast({ message: `${count(failed)} could not be opened and moved to Parked.` });
        }),
      detach: (topicId) => void run({ type: 'detachWindow', topicId }),
      park: (topicId) =>
        void run({ type: 'parkTopic', topicId }).then((res) => {
          const left = res.ok ? (res.data as { leftOpen?: number } | undefined)?.leftOpen : 0;
          if (left)
            showToast({ message: `${count(left)} could not be saved, so they were left open.` });
        }),
      rename: (topicId, newName) => void run({ type: 'renameTopic', topicId, name: newName }),
      restore: (topicId, tabId, from) => void run({ type: 'restoreTab', topicId, tabId, from }),
      group: (topicId, tabIds, sectionName) =>
        void run({ type: 'groupTabs', topicId, tabIds, name: sectionName }),
      ungroup: (topicId, sectionId) => void run({ type: 'ungroupSection', topicId, sectionId }),
      restoreAllParked: (topicId) =>
        void run({ type: 'restoreAllParked', topicId }).then(reportRestore),
      move: (fromTopicId, tabId, toTopicId) =>
        void run({ type: 'moveTab', fromTopicId, tabId, toTopicId }),
      remove: (topicId) => {
        const topic = topicsRef.current.find((t) => t.id === topicId);
        void run({ type: 'deleteTopic', topicId }).then((res) => {
          if (res.ok) {
            showToast({
              message: `Deleted "${topic?.name ?? 'topic'}".`,
              undo: { type: 'undoDelete', topicId },
            });
          }
        });
      },
    };
    const parking = {
      settings: (patch: { autoParkDays?: number; autoParkMode?: 'on' | 'dry-run' | 'off' }) =>
        void run({ type: 'updateSettings', ...patch }),
      preview: async () => {
        const res = await run({ type: 'autoPark', dryRun: true });
        return res.ok ? (res.data as AutoParkResult).tabs : null;
      },
      restore: (tabId: string) => void run({ type: 'restoreUnsorted', tabId }),
      restoreAll: () => void run({ type: 'restoreAllParked', topicId: null }).then(reportRestore),
    };
    // Local date, so a backup made just before midnight is not dated tomorrow.
    const dateStamp = () => new Date().toLocaleDateString('sv-SE');
    const backup = {
      export: async () => {
        const res = await run({ type: 'exportData' });
        if (res.ok) {
          latest.current.api.download(
            `tab-topics-${dateStamp()}.json`,
            (res.data as { text: string }).text,
          );
        }
      },
      import: async (text: string) => {
        const res = await run({ type: 'importData', text });
        if (res.ok) {
          const { topics, tabs } = res.data as { topics: number; tabs: number };
          showToast({
            message: `Imported ${topics === 1 ? '1 topic' : `${topics} topics`} with ${tabs === 1 ? '1 tab' : `${tabs} tabs`}.`,
          });
        }
      },
      listSnapshots: async () => {
        const res = await run({ type: 'listSnapshots' });
        return res.ok ? (res.data as { at: number; topics: number; tabs: number }[]) : null;
      },
      restoreSnapshot: (at: number) => void run({ type: 'restoreSnapshot', at }),
      undoDelete: (topicId: string) => void run({ type: 'undoDelete', topicId }),
      downloadRaw: async () =>
        latest.current.api.download(
          `tab-topics-raw-${dateStamp()}.json`,
          await latest.current.api.rawStore(),
        ),
      reset: () =>
        void run({ type: 'resetStore' }).then((res) => {
          if (res.ok) {
            const key = (res.data as { backupKey?: string } | undefined)?.backupKey;
            showToast({
              message: key
                ? `Started fresh. The old data is kept in storage as "${key}".`
                : 'Started fresh. The old data is kept in storage as a backup.',
            });
          }
        }),
      importError: (message: string) => setError(message),
    };
    return { run, actions, parking, backup, showToast, startToastTimer, pauseToastTimer };
  }, []);

  const topicsForRefs = load.ok ? load.store.topics : [];
  const refsKey = JSON.stringify(topicsForRefs.map((t) => [t.id, t.name]));
  const topicRefs = useMemo<TopicRef[]>(
    () => topicsForRefs.map((t) => ({ id: t.id, name: t.name })),
    // Recomputed only when ids or names change, so cards are not re-rendered for nothing.
    [refsKey],
  );
  // The index is rebuilt only when the store changes; typing just filters it.
  const index = useMemo(() => (load.ok ? buildIndex(load.store) : []), [load]);
  const deferredQuery = useDeferredValue(query);
  const results = useMemo(
    () => (deferredQuery.trim() ? searchTabs(index, deferredQuery) : []),
    [index, deferredQuery],
  );

  if (!load.ok) {
    return (
      <main class="page">
        <h1 class="page__title">Tab Topics</h1>
        <div class="notice notice--error" role="alert">
          <p>Your saved topics could not be read, so nothing has been changed.</p>
          <p class="notice__detail">{load.error}</p>
        </div>
        <UnreadableActions
          onDownload={() => void helpers.backup.downloadRaw()}
          onReset={helpers.backup.reset}
        />
        {error && (
          <div class="notice notice--error" role="alert">
            {error}
          </div>
        )}
        <div class="toast-region" role="status" aria-live="polite">
          {toast && <div class="toast">{toast.message}</div>}
        </div>
      </main>
    );
  }

  const { topics } = load.store;
  const busy = pending > 0;
  const currentTopic = topics.find((t) => t.id === currentTopicId);
  const { run, actions, parking, backup, showToast, startToastTimer, pauseToastTimer } = helpers;

  const save = async (e: Event) => {
    e.preventDefault();
    if ((await run({ type: 'saveWindow', name })).ok) {
      showToast({ message: `Saved this window as "${name.trim()}".` });
      setName('');
    }
  };

  return (
    <main class="page">
      <header class="page__head">
        <h1 class="page__title">Tab Topics</h1>
        {currentTopic ? (
          <p class="page__hint">
            This window is <strong>{currentTopic.name}</strong>.
          </p>
        ) : (
          <form class="save" onSubmit={save}>
            <label class="save__label" for="save-name">
              Save this window as
            </label>
            <input
              id="save-name"
              class="save__input"
              placeholder="Topic name, e.g. Japanese"
              value={name}
              maxLength={200}
              required
              onInput={(e) => setName(e.currentTarget.value)}
            />
            <button type="submit" class="btn btn--primary" disabled={busy || !name.trim()}>
              Save
            </button>
          </form>
        )}
      </header>

      {error && (
        <div class="notice notice--error" role="alert">
          {error}
        </div>
      )}

      {needsBackup(load.store.settings.lastExportAt, topics.length > 0, minute) && (
        <BackupReminder busy={busy} onExport={() => void backup.export()} />
      )}

      {topics.length > 0 && (
        <div class="search">
          <input
            id="search"
            type="search"
            class="save__input search__input"
            aria-keyshortcuts="/"
            aria-label="Search all topics"
            placeholder="Search tabs in all topics  ( / )"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
            }}
          />
        </div>
      )}

      {query.trim() ? (
        <SearchResults
          query={query.trim()}
          results={results}
          topics={topicRefs}
          busy={busy}
          favicon={api.favicon}
          onOpenTopic={actions.open}
          onMove={actions.move}
          onRestore={actions.restore}
          onRestoreUnsorted={parking.restore}
        />
      ) : topics.length === 0 ? (
        <section class="empty">
          <h2>No topics yet</h2>
          <p>
            Gather the tabs for one subject in a window, then save that window as a topic. It stays
            in sync as you open and close tabs, and you can park it and bring it back in one click.
          </p>
        </section>
      ) : (
        <section class="grid" aria-label="Topics">
          {topics.map((t) => (
            <TopicCard
              key={t.id}
              topic={t}
              isCurrentWindow={t.id === currentTopic?.id}
              busy={busy}
              now={minute}
              favicon={api.favicon}
              actions={actions}
              topicRefs={topicRefs}
            />
          ))}
        </section>
      )}

      {!query.trim() && (
        <ParkingPanel
          settings={load.store.settings}
          unsorted={load.store.unsortedParked}
          busy={busy}
          now={minute}
          onSettings={parking.settings}
          onPreview={parking.preview}
          onRestore={parking.restore}
          onRestoreAll={parking.restoreAll}
        />
      )}

      {!query.trim() && (
        <BackupPanel
          lastExportAt={load.store.settings.lastExportAt}
          hasTopics={topics.length > 0}
          trash={load.store.trash}
          busy={busy}
          now={minute}
          onExport={() => void backup.export()}
          onImport={(text) => void backup.import(text)}
          onImportError={backup.importError}
          onUndoDelete={backup.undoDelete}
          onListSnapshots={backup.listSnapshots}
          onRestoreSnapshot={backup.restoreSnapshot}
        />
      )}

      <div class="toast-region" role="status" aria-live="polite">
        {toast && (
          <div
            class="toast"
            onMouseEnter={pauseToastTimer}
            onMouseLeave={startToastTimer}
            onFocusIn={pauseToastTimer}
            onFocusOut={startToastTimer}
          >
            <span>{toast.message}</span>
            {toast.undo && (
              <button
                type="button"
                class="btn btn--small"
                onClick={() => {
                  const undo = toast.undo;
                  setToast(null);
                  if (undo) void run(undo);
                }}
              >
                Undo
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
