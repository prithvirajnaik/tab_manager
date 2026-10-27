import { useEffect, useRef, useState } from 'preact/hooks';
import type { Command, CommandResponse } from '../core/messages';
import type { Api, LoadResult } from './api';
import { TopicCard, type TopicActions } from './TopicCard';

type Props = { initial: LoadResult; api: Api; now?: () => number };

type Toast = { message: string; undo?: Command };

const TOAST_MS = 10_000;

export function App({ initial, api, now = Date.now }: Props) {
  const [load, setLoad] = useState<LoadResult>(initial);
  const [windowId, setWindowId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [name, setName] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => api.subscribe(setLoad), [api]);
  useEffect(() => {
    void api.currentWindowId().then(setWindowId);
  }, [api]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const showToast = (t: Toast) => {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };

  async function run(command: Command): Promise<CommandResponse> {
    setBusy(true);
    setError(null);
    try {
      const res = await api.send(command);
      if (!res.ok) setError(res.error);
      return res;
    } finally {
      setBusy(false);
    }
  }

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
  const currentTopic = topics.find((t) => windowId !== null && t.windowId === windowId);

  const actions: TopicActions = {
    open: (topicId) =>
      void run({ type: 'openTopic', topicId }).then((res) => {
        const failed = res.ok ? (res.data as { failed?: number } | undefined)?.failed : 0;
        if (failed) {
          showToast({
            message: `${failed === 1 ? '1 tab' : `${failed} tabs`} could not be opened and moved to Parked.`,
          });
        }
      }),
    park: (topicId) => void run({ type: 'parkTopic', topicId }),
    rename: (topicId, newName) => void run({ type: 'renameTopic', topicId, name: newName }),
    restore: (topicId, tabId, from) => void run({ type: 'restoreTab', topicId, tabId, from }),
    remove: (topicId) => {
      const topic = topics.find((t) => t.id === topicId);
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

  const save = async (e: Event) => {
    e.preventDefault();
    if ((await run({ type: 'saveWindow', name })).ok) {
      setName('');
      showToast({ message: `Saved this window as "${name.trim()}".` });
    }
  };

  const at = now();

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
              now={at}
              favicon={api.favicon}
              actions={actions}
            />
          ))}
        </section>
      )}

      <div class="toast-region" role="status" aria-live="polite">
        {toast && (
          <div class="toast">
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
