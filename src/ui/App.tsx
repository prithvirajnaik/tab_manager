import { useDeferredValue } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Command, CommandResponse } from '../core/messages';
import { buildIndex, searchTabs } from '../core/search';
import type { Api, LoadResult } from './api';
import type { AutoParkResult } from '../core/commands';
import { AppearancePanel } from './AppearancePanel';
import { backgroundProblem } from './background';
import { BackupPanel } from './BackupPanel';
import { plural } from './format';
import { applyEffect, readEffect, writeEffect, type Effect } from './effects';
import { Home } from './Home';
import { CloseIcon, FolderIcon, GridIcon, ListIcon, ParkIcon, SearchIcon } from './icons';
import { ParkingPanel } from './ParkingPanel';
import { LAYOUTS, readPref, writePref, type Layout, type Theme } from './prefs';
import { SaveWindow } from './SaveWindow';
import { SearchResults } from './SearchResults';
import {
  allParked,
  allRecentlyClosed,
  applyOrder,
  autoParkSummary,
  backupStatus,
  counts,
  isMac,
  LIVE_SORTS,
  matchTopics,
  SORT_LABELS,
  SORTS,
  sortTopics,
  type SortKey,
} from './selectors';
import { Sidebar, VIEW_TITLES, viewFromHash, viewHref, type View } from './Sidebar';
import { applyTheme, readTheme } from './theme';
import { EmptyState } from './TabRows';
import type { TopicRef } from './TabsPanel';
import { TopicCard, type DrawerPanel, type TopicActions } from './TopicCard';
import { TopicDrawer } from './TopicDrawer';
import { ClosedView, ParkedView } from './Views';

type Props = { initial: LoadResult; api: Api; now?: () => number };

type Toast = { message: string; undo?: Command };

const TOAST_MS = 10_000;
const MINUTE = 60_000;

const count = (n: number) => (n === 1 ? '1 tab' : `${n} tabs`);

const platform = () =>
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
  navigator.platform;

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
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>(() => viewFromHash(location.hash));
  const [drawer, setDrawer] = useState<{ topicId: string; panel: DrawerPanel } | null>(null);
  const [sort, setSort] = useState<SortKey>(() => readPref('sort', SORTS, 'created'));
  const [layout, setLayout] = useState<Layout>(() => readPref('layout', LAYOUTS, 'grid'));
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [glass, setGlass] = useState<Effect>(() => readEffect('glass'));
  const [transparency, setTransparency] = useState<Effect>(() => readEffect('transparency'));
  // Home is the resting state. Any hash (even a bare "#/") means a view is open in the panel.
  const [sheetOpen, setSheetOpen] = useState(() => location.hash !== '');
  const [railOpen, setRailOpen] = useState(false);
  const [background, setBackground] = useState<string | null>(null);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  // Minute-granular, so "updated 3 minutes ago" does not re-render every card constantly.
  const [minute, setMinute] = useState(() => Math.floor(now() / MINUTE) * MINUTE);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const topicsRef = useRef(load.ok ? load.store.topics : []);
  topicsRef.current = load.ok ? load.store.topics : [];
  // Where focus goes back to when the drawer closes.
  const drawerOpener = useRef<HTMLElement | null>(null);
  const mac = useMemo(() => isMac(platform()), []);

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
  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => applyEffect('glass', glass), [glass]);
  useEffect(() => applyEffect('transparency', transparency), [transparency]);
  useEffect(() => {
    const onHash = () => {
      setView(viewFromHash(location.hash));
      setSheetOpen(location.hash !== '');
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
  }, []);
  const backgroundUrl = useRef<string | null>(null);
  const showBackground = (blob: Blob | null) => {
    if (backgroundUrl.current) URL.revokeObjectURL(backgroundUrl.current);
    backgroundUrl.current = blob ? URL.createObjectURL(blob) : null;
    setBackground(backgroundUrl.current);
  };
  useEffect(() => {
    let gone = false;
    void api.background?.get().then((blob) => {
      if (!gone && blob) showBackground(blob);
    });
    return () => {
      gone = true;
      if (backgroundUrl.current) URL.revokeObjectURL(backgroundUrl.current);
    };
  }, [api]);
  const putAway = () => {
    if (location.hash !== '') history.pushState(null, '', location.pathname + location.search);
    setSheetOpen(false);
    setQuery('');
    setDrawer(null);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.closest(
        'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
      );
      const slash =
        e.key === '/' &&
        !e.isComposing &&
        !typing &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        sheetOpen;
      const modK =
        e.key.toLowerCase() === 'k' && !e.altKey && !e.shiftKey && (mac ? e.metaKey : e.ctrlKey);
      if (slash) {
        const box = document.getElementById('search');
        if (box) {
          e.preventDefault();
          box.focus();
        }
      } else if (modK) {
        e.preventDefault();
        if (sheetOpen || railOpen) {
          putAway();
          setRailOpen(false);
        } else {
          setRailOpen(true);
        }
      } else if (
        e.key === 'Escape' &&
        !e.defaultPrevented &&
        (sheetOpen || railOpen) &&
        // Menus, the drawer and every text field (rename, save, search) use Escape themselves.
        // The home search bar is the exception: there it puts the rail away.
        (!typing || target?.closest('.home')) &&
        !target?.closest('[role="menu"], .drawer, .popover')
      ) {
        if (sheetOpen) putAway();
        else setRailOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mac, sheetOpen, railOpen]);
  useEffect(() => {
    if (drawer || !drawerOpener.current) return;
    if (drawerOpener.current.isConnected) drawerOpener.current.focus();
    drawerOpener.current = null;
  }, [drawer]);

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
      show: (topicId, panel) => {
        drawerOpener.current = document.activeElement as HTMLElement | null;
        setDrawer({ topicId, panel });
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
      restoreAll: (topicId: string | null) =>
        void run({ type: 'restoreAllParked', topicId }).then(reportRestore),
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
  const topicMatches = useMemo(
    () => (deferredQuery.trim() ? matchTopics(topicsForRefs, deferredQuery) : []),
    [load, deferredQuery],
  );
  // "Last updated" and "Most tabs" are ordered once, when chosen or on load, and new topics
  // go first; re-sorting on every store change would make cards jump while you browse.
  const frozen = useRef<{ key: SortKey; ids: string[] } | null>(null);
  const ordered = useMemo(() => {
    if (!LIVE_SORTS.has(sort)) return sortTopics(topicsForRefs, sort);
    if (frozen.current?.key !== sort) {
      frozen.current = { key: sort, ids: sortTopics(topicsForRefs, sort).map((t) => t.id) };
    }
    return applyOrder(topicsForRefs, frozen.current.ids);
  }, [load, sort]);

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

  const { store } = load;
  const { topics, settings } = store;
  const busy = pending > 0;
  const currentTopic = topics.find((t) => t.id === currentTopicId);
  const totals = counts(store);
  const { run, actions, parking, backup, showToast, startToastTimer, pauseToastTimer } = helpers;
  const searchable = topics.length > 0 || store.unsortedParked.length > 0;
  const searching = query.trim() !== '';
  const drawerTopic = drawer && topics.find((t) => t.id === drawer.topicId);

  const changeSort = (next: SortKey) => {
    frozen.current = null;
    setSort(next);
    writePref('sort', next);
  };
  const changeLayout = (next: Layout) => {
    setLayout(next);
    writePref('layout', next);
  };
  const changeGlass = (next: Effect) => {
    setGlass(next);
    writeEffect('glass', next);
  };
  const changeTransparency = (next: Effect) => {
    setTransparency(next);
    writeEffect('transparency', next);
  };
  const changeTheme = (next: Theme) => {
    setTheme(next);
    writePref('theme', next);
  };

  const navigate = (next: View) => {
    if (location.hash !== viewHref(next)) history.pushState(null, '', viewHref(next));
    setView(next);
    setSheetOpen(true);
    setQuery('');
    setDrawer(null);
  };

  const pickBackground = async (file: File) => {
    const store = api.background;
    const problem = backgroundProblem(file);
    setBackgroundError(problem);
    if (!store || problem) return;
    try {
      await store.set(file);
      showBackground(file);
    } catch {
      setBackgroundError('That image could not be saved in this browser.');
    }
  };
  const clearBackground = async () => {
    setBackgroundError(null);
    try {
      await api.background?.clear();
    } finally {
      showBackground(null);
    }
  };

  const save = async (name: string) => {
    const res = await run({ type: 'saveWindow', name });
    if (res.ok) showToast({ message: `Saved this window as "${name.trim()}".` });
    return res.ok;
  };

  const topicsView =
    topics.length === 0 ? (
      <EmptyState icon={<FolderIcon size={28} />} title="No topics yet">
        <p>
          Gather the tabs for one subject in a window, then save that window as a topic. It stays in
          sync as you open and close tabs, and you can park it and bring it back in one click.
        </p>
      </EmptyState>
    ) : (
      <>
        <div class="toolbar">
          <h2 class="toolbar__title">Saved topics</h2>
          <div class="toolbar__end">
            <label class="visually-hidden" for="sort">
              Sort topics
            </label>
            <select
              id="sort"
              class="select"
              value={sort}
              onChange={(e) => changeSort(e.currentTarget.value as SortKey)}
            >
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABELS[s]}
                </option>
              ))}
            </select>
            <div class="toggle" role="group" aria-label="Layout">
              {LAYOUTS.map((l) => (
                <button
                  key={l}
                  type="button"
                  class="toggle__btn"
                  aria-label={l === 'grid' ? 'Grid view' : 'List view'}
                  aria-pressed={layout === l}
                  onClick={() => changeLayout(l)}
                >
                  {l === 'grid' ? <GridIcon /> : <ListIcon />}
                </button>
              ))}
            </div>
          </div>
        </div>
        <section class={`grid${layout === 'list' ? ' grid--list' : ''}`} aria-label="Topics">
          {ordered.map((t) => (
            <TopicCard
              key={t.id}
              topic={t}
              isCurrentWindow={t.id === currentTopic?.id}
              busy={busy}
              now={minute}
              favicon={api.favicon}
              actions={actions}
            />
          ))}
        </section>
        <p class="statusline">
          <ParkIcon size={16} />
          <span>{autoParkSummary(settings)}</span>
          <a
            href={viewHref('settings')}
            onClick={(e) => {
              e.preventDefault();
              navigate('settings');
            }}
          >
            Change
          </a>
        </p>
      </>
    );

  const body = searching ? (
    <SearchResults
      query={query.trim()}
      results={results}
      topicMatches={topicMatches}
      currentTopicId={currentTopic?.id ?? null}
      topics={topicRefs}
      busy={busy}
      favicon={api.favicon}
      onOpenTopic={actions.open}
      onMove={actions.move}
      onRestore={actions.restore}
      onRestoreUnsorted={parking.restore}
    />
  ) : view === 'closed' ? (
    <ClosedView
      groups={allRecentlyClosed(store)}
      busy={busy}
      now={minute}
      favicon={api.favicon}
      onRestore={(topicId, tabId) => actions.restore(topicId, tabId, 'recentlyClosed')}
    />
  ) : view === 'parked' ? (
    <ParkedView
      groups={allParked(store)}
      settings={settings}
      busy={busy}
      now={minute}
      favicon={api.favicon}
      onRestore={(topicId, tabId) =>
        topicId ? actions.restore(topicId, tabId, 'parked') : parking.restore(tabId)
      }
      onRestoreAll={parking.restoreAll}
      onSettings={() => navigate('settings')}
    />
  ) : view === 'settings' ? (
    <div class="stack">
      <AppearancePanel
        theme={theme}
        layout={layout}
        sort={sort}
        onTheme={changeTheme}
        onLayout={changeLayout}
        onSort={changeSort}
        glass={glass}
        onGlass={changeGlass}
        transparency={transparency}
        onTransparency={changeTransparency}
        background={
          api.background
            ? {
                has: background !== null,
                error: backgroundError,
                onPick: (f) => void pickBackground(f),
                onClear: () => void clearBackground(),
              }
            : null
        }
      />
      <ParkingPanel
        settings={settings}
        busy={busy}
        onSettings={parking.settings}
        onPreview={parking.preview}
      />
      <BackupPanel
        lastExportAt={settings.lastExportAt}
        trash={store.trash}
        busy={busy}
        now={minute}
        onExport={() => void backup.export()}
        onImport={(text) => void backup.import(text)}
        onImportError={backup.importError}
        onUndoDelete={backup.undoDelete}
        onListSnapshots={backup.listSnapshots}
        onRestoreSnapshot={backup.restoreSnapshot}
      />
    </div>
  ) : (
    topicsView
  );

  const railVisible = railOpen || sheetOpen;

  return (
    <div class="app">
      <Home
        image={background}
        onSearch={api.webSearch ? (text) => void api.webSearch?.(text) : null}
        suggest={(text) => [
          ...matchTopics(topics, text)
            .slice(0, 3)
            .map((t) => ({
              key: `topic:${t.id}`,
              label: t.name,
              detail: `Topic · ${plural(t.tabs.length, 'tab')}`,
              onPick: () => actions.open(t.id),
            })),
          ...searchTabs(index, text, 5)
            .filter((r) => r.topicId)
            .map((r) => ({
              key: `tab:${r.topicId}:${r.tab.id}`,
              label: r.tab.title || r.tab.url,
              detail: `In ${r.topicName}`,
              onPick: () => actions.open(r.topicId),
            })),
        ]}
        active={!sheetOpen}
      />
      {!railVisible && (
        <div class="edge" aria-hidden="true" onPointerEnter={() => setRailOpen(true)} />
      )}
      {railVisible && !sheetOpen && (
        <div class="scrim" aria-hidden="true" onPointerDown={() => setRailOpen(false)} />
      )}
      <Sidebar
        open={railVisible}
        view={view}
        current={sheetOpen}
        counts={totals}
        backup={backupStatus(settings.lastExportAt, topics.length > 0, minute)}
        busy={busy}
        now={minute}
        onNavigate={navigate}
        onExport={() => void backup.export()}
      />
      {sheetOpen && <div class="scrim scrim--sheet" aria-hidden="true" onPointerDown={putAway} />}
      <main class={`sheet${sheetOpen ? ' sheet--open' : ''}`}>
        <header class="topbar">
          <div class="topbar__title">
            <h1 class="page__title">{searching ? 'Search' : VIEW_TITLES[view]}</h1>
          </div>
          <div class="topbar__actions">
            {searchable && (
              <div class="search">
                <SearchIcon />
                <input
                  id="search"
                  type="search"
                  class="search__input"
                  aria-keyshortcuts="/"
                  aria-label="Search all topics"
                  placeholder="Search topics, tabs and sites"
                  value={query}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setQuery('');
                  }}
                />
                {!query && (
                  <kbd class="search__kbd" aria-hidden="true">
                    /
                  </kbd>
                )}
              </div>
            )}
            {!currentTopic && <SaveWindow busy={busy} onSave={save} />}
            <button
              type="button"
              class="btn btn--icon"
              aria-label="Close panel"
              title="Close (Esc)"
              onClick={putAway}
            >
              <CloseIcon />
            </button>
          </div>
        </header>

        {error && (
          <div class="notice notice--error" role="alert">
            {error}
          </div>
        )}

        {body}
      </main>

      {drawerTopic && (
        <TopicDrawer
          topic={drawerTopic}
          panel={drawer.panel}
          isCurrentWindow={drawerTopic.id === currentTopic?.id}
          busy={busy}
          now={minute}
          favicon={api.favicon}
          actions={actions}
          otherTopics={topicRefs.filter((t) => t.id !== drawerTopic.id)}
          onPanel={(panel) => setDrawer({ topicId: drawerTopic.id, panel })}
          onClose={() => setDrawer(null)}
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
    </div>
  );
}
