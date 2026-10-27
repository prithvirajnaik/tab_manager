import { useEffect, useRef, useState } from 'preact/hooks';
import type { TrashEntry } from '../core/model';
import { plural, timeAgo } from './format';

const REMIND_AFTER_MS = 14 * 86_400_000;
/** The command channel accepts up to 50 MB; real exports are far smaller. */
export const MAX_IMPORT_BYTES = 50_000_000;

type SnapshotInfo = { at: number; topics: number; tabs: number };

type Props = {
  lastExportAt: number | null;
  hasTopics: boolean;
  trash: TrashEntry[];
  busy: boolean;
  now: number;
  onExport: () => void;
  onImport: (text: string) => void;
  onImportError: (message: string) => void;
  onUndoDelete: (topicId: string) => void;
  onListSnapshots: () => Promise<SnapshotInfo[] | null>;
  onRestoreSnapshot: (at: number) => void;
};

/** Should the page nag about backups? Local data is lost on a profile reset. */
export function needsBackup(lastExportAt: number | null, hasTopics: boolean, now: number) {
  return hasTopics && (lastExportAt === null || now - lastExportAt > REMIND_AFTER_MS);
}

export function BackupReminder({ onExport, busy }: { onExport: () => void; busy: boolean }) {
  return (
    <div class="notice" role="note">
      <p>
        Your topics live only in this browser profile. Export a backup now and then, in case the
        profile is reset.{' '}
        <button type="button" class="btn btn--small" disabled={busy} onClick={onExport}>
          Export backup
        </button>
      </p>
    </div>
  );
}

/** Export and import, trash, and snapshots. */
export function BackupPanel(props: Props) {
  const { lastExportAt, trash, busy, now } = props;
  const file = useRef<HTMLInputElement>(null);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[] | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (confirming !== null) confirmButton.current?.focus();
  }, [confirming]);

  return (
    <section class="panel" aria-labelledby="backup-title">
      <h2 id="backup-title" class="panel__title" ref={heading} tabIndex={-1}>
        Backup and recovery
      </h2>
      <p class="panel__hint">
        {lastExportAt === null ? 'Never exported.' : `Last exported ${timeAgo(lastExportAt, now)}.`}{' '}
        Importing adds topics; it never replaces the ones you have.
      </p>
      <div class="panel__row">
        <button type="button" class="btn btn--small" disabled={busy} onClick={props.onExport}>
          Export to a file
        </button>
        <button
          type="button"
          class="btn btn--small"
          disabled={busy}
          onClick={() => file.current?.click()}
        >
          Import from a file
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          class="visually-hidden"
          aria-label="Choose a Tab Topics export file"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const chosen = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (!chosen) return;
            if (chosen.size > MAX_IMPORT_BYTES) {
              props.onImportError('That file is too large to be a Tab Topics export.');
              return;
            }
            chosen
              .text()
              .then(props.onImport, () => props.onImportError('That file could not be read.'));
          }}
        />
      </div>

      {trash.length > 0 && (
        <div class="panel__parked">
          <h3 class="panel__subtitle">Deleted topics (kept 30 days)</h3>
          <ul class="results">
            {trash.map((e) => (
              <li key={e.topic.id} class="result">
                <div class="result__text">
                  <span class="tab__title">{e.topic.name}</span>
                  <span class="tab__host">
                    {plural(e.topic.tabs.length, 'tab')} · deleted {timeAgo(e.deletedAt, now)}
                  </span>
                </div>
                <button
                  type="button"
                  class="btn btn--small"
                  disabled={busy}
                  aria-label={`Restore deleted topic ${e.topic.name}`}
                  onClick={() => props.onUndoDelete(e.topic.id)}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div class="panel__parked">
        <div class="panel__row">
          <h3 class="panel__subtitle">Snapshots</h3>
          <button
            type="button"
            class="btn btn--small"
            disabled={busy}
            onClick={() => void props.onListSnapshots().then(setSnapshots)}
          >
            {snapshots ? 'Refresh' : 'Show snapshots'}
          </button>
        </div>
        {snapshots && snapshots.length === 0 && (
          <p class="panel__hint">No snapshots yet. One is taken before every bulk change.</p>
        )}
        {snapshots && snapshots.length > 0 && (
          <ul class="results">
            {snapshots.map((s) => (
              <li key={s.at} class="result">
                <div class="result__text">
                  <span class="tab__title">{new Date(s.at).toLocaleString()}</span>
                  <span class="tab__host">
                    {plural(s.topics, 'topic')} · {plural(s.tabs, 'tab')}
                  </span>
                </div>
                {confirming === s.at ? (
                  <button
                    ref={confirmButton}
                    type="button"
                    class="btn btn--small btn--primary"
                    disabled={busy}
                    onClick={() => {
                      setConfirming(null);
                      setSnapshots(null);
                      heading.current?.focus();
                      props.onRestoreSnapshot(s.at);
                    }}
                  >
                    Replace current topics
                  </button>
                ) : (
                  <button
                    type="button"
                    class="btn btn--small"
                    disabled={busy}
                    aria-label={`Restore snapshot from ${new Date(s.at).toLocaleString()}`}
                    onClick={() => setConfirming(s.at)}
                  >
                    Restore…
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
