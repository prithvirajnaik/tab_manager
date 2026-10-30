import { useEffect, useRef } from 'preact/hooks';
import { RECENTLY_CLOSED_DAYS, type Topic } from '../core/model';
import { hostOf, plural, timeAgo } from './format';
import { CloseIcon } from './icons';
import { RestoreButton, TabRow } from './TabRows';
import { TabsPanel, type TopicRef } from './TabsPanel';
import { stateLabel, TopicTile, type DrawerPanel, type TopicActions } from './TopicCard';

type Props = {
  topic: Topic;
  panel: DrawerPanel;
  isCurrentWindow: boolean;
  busy: boolean;
  now: number;
  favicon: (url: string) => string;
  actions: TopicActions;
  otherTopics: TopicRef[];
  onPanel: (panel: DrawerPanel) => void;
  onClose: () => void;
};

const PANELS: { id: DrawerPanel; label: string }[] = [
  { id: 'tabs', label: 'Tabs' },
  { id: 'parked', label: 'Parked' },
  { id: 'closed', label: 'Recently closed' },
];

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled])';

/** A side sheet with one topic's tabs, parked and recently closed lists. Modal. */
export function TopicDrawer(props: Props) {
  const { topic, panel, busy, now, favicon, actions, onPanel, onClose } = props;
  const sheet = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = `drawer-${topic.id}`;
  const count = {
    tabs: topic.tabs.length,
    parked: topic.parked.length,
    closed: topic.recentlyClosed.length,
  };

  useEffect(() => closeButton.current?.focus(), []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !sheet.current) return;
    // Keep focus inside while the sheet is open.
    const items = [...sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  const onTabKey = (e: KeyboardEvent) => {
    const i = PANELS.findIndex((p) => p.id === panel);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = PANELS[(i + step + PANELS.length) % PANELS.length];
    if (!next) return;
    onPanel(next.id);
    sheet.current?.querySelector<HTMLElement>(`#tab-${next.id}`)?.focus();
  };

  return (
    <div class="drawer" onKeyDown={onKeyDown}>
      <div class="drawer__backdrop" onClick={onClose} />
      <div
        ref={sheet}
        class="drawer__sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header class="drawer__head">
          <TopicTile topic={topic} />
          <div class="card__heading">
            <h2 id={titleId} class="card__title">
              {topic.name}
            </h2>
            <p class="card__meta">
              {stateLabel(topic, props.isCurrentWindow)} · {plural(topic.tabs.length, 'tab')} ·
              updated {timeAgo(topic.updatedAt, now)}
            </p>
          </div>
          <button
            ref={closeButton}
            type="button"
            class="btn btn--icon"
            aria-label="Close"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div class="tablist" role="tablist" aria-label={`Lists of ${topic.name}`}>
          {PANELS.map((p) => (
            <button
              key={p.id}
              id={`tab-${p.id}`}
              type="button"
              role="tab"
              class="tablist__tab"
              aria-selected={panel === p.id}
              aria-controls={`panel-${p.id}`}
              tabIndex={panel === p.id ? 0 : -1}
              onClick={() => onPanel(p.id)}
              onKeyDown={onTabKey}
            >
              {p.label}
              <span class="chip__n">{count[p.id]}</span>
            </button>
          ))}
        </div>

        <div
          id={`panel-${panel}`}
          class="drawer__body"
          role="tabpanel"
          aria-labelledby={`tab-${panel}`}
        >
          {panel === 'tabs' &&
            (topic.tabs.length ? (
              <TabsPanel
                topic={topic}
                otherTopics={props.otherTopics}
                busy={busy}
                favicon={favicon}
                onGroup={(ids, name) => actions.group(topic.id, ids, name)}
                onUngroup={(sectionId) => actions.ungroup(topic.id, sectionId)}
                onMove={(tabId, to) => actions.move(topic.id, tabId, to)}
              />
            ) : (
              <p class="hint">This topic has no tabs. Open it and add some.</p>
            ))}

          {panel === 'parked' &&
            (topic.parked.length ? (
              <>
                <div class="drawer__bar">
                  <p class="hint">Parked tabs are kept until you restore them.</p>
                  <button
                    type="button"
                    class="btn btn--small"
                    disabled={busy}
                    aria-label={`Restore all parked tabs of ${topic.name}`}
                    onClick={() => actions.restoreAllParked(topic.id)}
                  >
                    Restore all
                  </button>
                </div>
                <ul class="rows">
                  {topic.parked.map((t) => (
                    <TabRow
                      key={t.id}
                      tab={t}
                      favicon={favicon}
                      meta={`${hostOf(t.url)} · parked ${timeAgo(t.parkedAt, now)}`}
                      action={
                        <RestoreButton
                          tab={t}
                          busy={busy}
                          onRestore={() => actions.restore(topic.id, t.id, 'parked')}
                        />
                      }
                    />
                  ))}
                </ul>
              </>
            ) : (
              <p class="hint">Nothing is parked in this topic.</p>
            ))}

          {panel === 'closed' &&
            (topic.recentlyClosed.length ? (
              <ul class="rows">
                {topic.recentlyClosed.map((t) => (
                  <TabRow
                    key={t.id}
                    tab={t}
                    favicon={favicon}
                    meta={`${hostOf(t.url)} · closed ${timeAgo(t.closedAt, now)}`}
                    action={
                      <RestoreButton
                        tab={t}
                        busy={busy}
                        onRestore={() => actions.restore(topic.id, t.id, 'recentlyClosed')}
                      />
                    }
                  />
                ))}
              </ul>
            ) : (
              <p class="hint">
                Tabs you close in this topic's window stay here for {RECENTLY_CLOSED_DAYS} days.
              </p>
            ))}
        </div>
      </div>
    </div>
  );
}
