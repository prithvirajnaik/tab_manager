import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Command, CommandResponse } from '../core/messages';
import type { Api, LoadResult } from './api';
import { TopicCard, type TopicActions } from './TopicCard';

type Props = { initial: LoadResult; api: Api; now?: () => number };

type Toast = { message: string; undo?: Command };

const TOAST_MS = 10_000;
const MINUTE = 60_000;

const count = (n: number) => (n === 1 ? '1 tab' : `${n} tabs`);

export function App({ initial, api, now = Date.now }: Props) {
  const [load, setLoad] = useState<LoadResult>(initial);
  const [windowId, setWindowId] = useState<number | null>(null);
  // A counter, so overlapping commands do not clear each other's busy state.
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [name, setName] = useState('');
  // Minute-granular, so "updated 3 minutes ago" does not re-render every card constantly.
  const [minute, setMinute] = useState(() => Math.floor(now() / MINUTE) * MINUTE);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const topicsRef = useRef(load.ok ? load.store.topics : []);
  topicsRef.current = load.ok ? load.store.topics : [];

  useEffect(() => api.subscribe(setLoad), [api]);
  useEffect(() => {
    void api.currentWindowId().then(setWindowId);
  }, [api]);
  useEffect(() => {
    const id = setInterval(() => setMinute(Math.floor(now() / MINUTE) * MINUTE), MINUTE);
    return () => clearInterval(id);
  }, [now]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

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
    const actions: TopicActions = {
      open: (topicId) =>
        void run({ type: 'openTopic', topicId }).then((res) => {
          const failed = res.ok ? (res.data as { failed?: number } | undefined)?.failed : 0;
          if (failed)
            showToast({ message: `${count(failed)} could not be opened and moved to Parked.` });
        }),
      park: (topicId) =>
        void run({ type: 'parkTopic', topicId }).then((res) => {
          const left = res.ok ? (res.data as { leftOpen?: number } | undefined)?.leftOpen : 0;
          if (left)
            showToast({ message: `${count(left)} could not be saved, so they were left open.` });
        }),
      rename: (topicId, newName) => void run({ type: 'renameTopic', topicId, name: newName }),
      restore: (topicId, tabId, from) => void run({ type: 'restoreTab', topicId, tabId, from }),
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
    return { run, actions, showToast, startToastTimer, pauseToastTimer };
  }, []);

  if (!load.ok) {
    return (
      <main class="page">
        <h1 class="page__title">Tab Topics</h1>
        <div class="notice notice--error" role="alert">
          <p>Your saved topics could not be read, so nothing has been changed.</p>
          <p class="notice__detail">{load.error}</p>
        </div>
      </main>
    );
  }

  const { topics } = load.store;
  const busy = pending > 0;
  const currentTopic = topics.find((t) => windowId !== null && t.windowId === windowId);
  const { run, actions, showToast, startToastTimer, pauseToastTimer } = helpers;

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

      {topics.length === 0 ? (
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
            />
          ))}
        </section>
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
