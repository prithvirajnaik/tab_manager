import { useEffect, useState } from 'preact/hooks';
import type { ParkCandidate } from '../core/commands';
import type { AutoParkMode, ParkedTab, Settings } from '../core/model';
import { hostOf, timeAgo } from './format';

type Props = {
  settings: Settings;
  unsorted: ParkedTab[];
  busy: boolean;
  now: number;
  onSettings: (patch: { autoParkDays?: number; autoParkMode?: AutoParkMode }) => void;
  onPreview: () => Promise<ParkCandidate[] | null>;
  onRestore: (tabId: string) => void;
  onRestoreAll: () => void;
};

const MODES: { value: AutoParkMode; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'dry-run', label: 'Preview only (parks nothing)' },
  { value: 'off', label: 'Off' },
];

/** Auto-park settings, a dry-run preview, and tabs parked from windows with no topic. */
export function ParkingPanel(props: Props) {
  const { settings, unsorted, busy, now, onSettings, onPreview, onRestore, onRestoreAll } = props;
  const [days, setDays] = useState(String(settings.autoParkDays));
  useEffect(() => setDays(String(settings.autoParkDays)), [settings.autoParkDays]);
  const [preview, setPreview] = useState<ParkCandidate[] | null>(null);

  return (
    <section class="panel" aria-labelledby="parking-title">
      <h2 id="parking-title" class="panel__title">
        Parking
      </h2>
      <p class="panel__hint">
        Tabs you have not looked at for a while are parked: saved and closed, never deleted. Pinned,
        playing and active tabs are never parked.
      </p>
      <div class="panel__row">
        <label for="park-mode">Auto-park</label>
        <select
          id="park-mode"
          value={settings.autoParkMode}
          disabled={busy}
          onChange={(e) => onSettings({ autoParkMode: e.currentTarget.value as AutoParkMode })}
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <label for="park-days">after</label>
        <input
          id="park-days"
          type="number"
          aria-label="Days idle before parking"
          min={1}
          max={365}
          value={days}
          disabled={busy}
          class="panel__days"
          onInput={(e) => setDays(e.currentTarget.value)}
          // change fires on Enter or when focus leaves; read the field, not render state.
          onChange={(e) => {
            const n = Number(e.currentTarget.value);
            if (Number.isInteger(n) && n >= 1 && n <= 365 && n !== settings.autoParkDays) {
              onSettings({ autoParkDays: n });
            } else {
              e.currentTarget.value = String(settings.autoParkDays);
              setDays(String(settings.autoParkDays));
            }
          }}
        />
        <span>days idle</span>
        <button
          type="button"
          class="btn btn--small"
          disabled={busy}
          onClick={() => void onPreview().then(setPreview)}
        >
          Preview
        </button>
      </div>

      {preview && (
        <div class="panel__preview" role="status">
          {preview.length === 0 ? (
            <p>Nothing would be parked right now.</p>
          ) : (
            <>
              <p>{preview.length === 1 ? '1 tab' : `${preview.length} tabs`} would be parked:</p>
              <ul class="results">
                {preview.map((t, i) => (
                  <li key={`${t.url}-${i}`} class="result" title={t.url}>
                    <div class="result__text">
                      <span class="tab__title">{t.title || t.url}</span>
                      <span class="tab__host">
                        {hostOf(t.url)} · {t.topicName ?? 'No topic'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {unsorted.length > 0 && (
        <div class="panel__parked">
          <div class="panel__row">
            <h3 class="panel__subtitle">Parked from windows without a topic ({unsorted.length})</h3>
            <button type="button" class="btn btn--small" disabled={busy} onClick={onRestoreAll}>
              Restore all
            </button>
          </div>
          <ul class="results">
            {unsorted.map((t) => (
              <li key={t.id} class="result" title={t.url}>
                <div class="result__text">
                  <span class="tab__title">{t.title || t.url}</span>
                  <span class="tab__host">
                    {hostOf(t.url)} · parked {timeAgo(t.parkedAt, now)}
                  </span>
                </div>
                <button
                  type="button"
                  class="btn btn--small"
                  disabled={busy}
                  aria-label={`Restore ${t.title || t.url}`}
                  onClick={() => onRestore(t.id)}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
