import { useEffect, useRef, useState } from 'preact/hooks';
import { TRASH_DAYS, type TrashEntry } from '../core/model';
import { plural, timeAgo } from './format';
import { CloudIcon, DownloadIcon, HistoryIcon, UploadIcon } from './icons';

/** The command channel accepts up to 50 MB; real exports are far smaller. */
export const MAX_IMPORT_BYTES = 50_000_000;

type SnapshotInfo = { at: number; topics: number; tabs: number };

type Props = {
  lastExportAt: number | null;
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
      <header class="panel__head">
        <span class="panel__icon">
          <CloudIcon />
        </span>
        <div>
          <h2 id="backup-title" class="panel__title" ref={heading} tabIndex={-1}>
            Backup and recovery
          </h2>
          <p class="hint">
            {lastExportAt === null
              ? 'Never exported.'
              : `Last exported ${timeAgo(lastExportAt, now)}.`}{' '}
            Your topics live only in this browser profile, so export them now and then. Importing
            adds topics; it never replaces the ones you have.
          </p>
        </div>
      </header>
      <div class="panel__row">
        <button type="button" class="btn" disabled={busy} onClick={props.onExport}>
          <UploadIcon size={16} />
          Export to a file
        </button>
        <button type="button" class="btn" disabled={busy} onClick={() => file.current?.click()}>
          <DownloadIcon size={16} />
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
        <div class="panel__section">
          <h3 class="panel__subtitle">Deleted topics (kept {TRASH_DAYS} days)</h3>
          <ul class="rows">
            {trash.map((e) => (
              <li key={e.topic.id} class="row">
                <span class="row__text">
                  <span class="row__title">{e.topic.name}</span>
                  <span class="row__meta">
                    {plural(e.topic.tabs.length, 'tab')} · deleted {timeAgo(e.deletedAt, now)}
                  </span>
                </span>
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

      <div class="panel__section">
        <div class="panel__row">
          <h3 class="panel__subtitle">Snapshots</h3>
          <button
            type="button"
            class="btn btn--small panel__end"
            disabled={busy}
            onClick={() => void props.onListSnapshots().then(setSnapshots)}
          >
            <HistoryIcon size={14} />
            {snapshots ? 'Refresh' : 'Show snapshots'}
          </button>
        </div>
        {snapshots && snapshots.length === 0 && (
          <p class="hint">No snapshots yet. One is taken before every bulk change.</p>
        )}
        {snapshots && snapshots.length > 0 && (
          <ul class="rows">
            {snapshots.map((s) => (
              <li key={s.at} class="row">
                <span class="row__text">
                  <span class="row__title">{new Date(s.at).toLocaleString()}</span>
                  <span class="row__meta">
                    {plural(s.topics, 'topic')} · {plural(s.tabs, 'tab')}
                  </span>
                </span>
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
