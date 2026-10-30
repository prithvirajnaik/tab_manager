import { useState } from 'preact/hooks';
import type { ParkCandidate } from '../core/commands';
import type { AutoParkMode, Settings } from '../core/model';
import { hostOf, plural } from './format';
import { EyeIcon, ParkIcon } from './icons';

type Props = {
  settings: Settings;
  busy: boolean;
  onSettings: (patch: { autoParkDays?: number; autoParkMode?: AutoParkMode }) => void;
  onPreview: () => Promise<ParkCandidate[] | null>;
};

const MODES: { value: AutoParkMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'dry-run', label: 'Preview only' },
  { value: 'on', label: 'On' },
];

const DAY_PRESETS = [3, 7, 14, 30, 60, 90];

/** Auto-park mode and idle days, and a dry run of what would be parked right now. */
export function ParkingPanel({ settings, busy, onSettings, onPreview }: Props) {
  const [preview, setPreview] = useState<ParkCandidate[] | null>(null);
  // A stored value that is not a preset (any 1 to 365 is valid) is still offered as-is.
  const days = [...new Set([...DAY_PRESETS, settings.autoParkDays])].sort((a, b) => a - b);

  return (
    <section class="panel" aria-labelledby="parking-title">
      <header class="panel__head">
        <span class="panel__icon">
          <ParkIcon />
        </span>
        <div>
          <h2 id="parking-title" class="panel__title">
            Parking
          </h2>
          <p class="hint">
            Tabs you have not looked at for a while are parked: saved and closed, never deleted.
            Pinned, playing and active tabs are never parked.
          </p>
        </div>
      </header>

      <div class="panel__row">
        <fieldset class="segmented" disabled={busy}>
          <legend class="segmented__legend">Auto-park</legend>
          {MODES.map((m) => (
            <label key={m.value} class="segmented__option">
              <input
                type="radio"
                name="park-mode"
                value={m.value}
                checked={settings.autoParkMode === m.value}
                onChange={() => onSettings({ autoParkMode: m.value })}
              />
              <span>{m.label}</span>
            </label>
          ))}
        </fieldset>

        <span class="panel__field">
          <label for="park-days">Park after</label>
          <select
            id="park-days"
            class="select"
            value={String(settings.autoParkDays)}
            disabled={busy || settings.autoParkMode === 'off'}
            onChange={(e) => onSettings({ autoParkDays: Number(e.currentTarget.value) })}
          >
            {days.map((d) => (
              <option key={d} value={String(d)}>
                {plural(d, 'day')}
              </option>
            ))}
          </select>
          <span class="hint">idle</span>
        </span>

        <button
          type="button"
          class="btn panel__end"
          disabled={busy}
          onClick={() => void onPreview().then(setPreview)}
        >
          <EyeIcon size={16} />
          See what would be parked
        </button>
      </div>

      {preview && (
        <div class="panel__section" role="status">
          {preview.length === 0 ? (
            <p class="hint">Nothing would be parked right now.</p>
          ) : (
            <>
              <p class="hint">{plural(preview.length, 'tab')} would be parked:</p>
              <ul class="rows">
                {preview.map((t, i) => (
                  <li key={`${t.url}-${i}`} class="row" title={t.url}>
                    <span class="row__text">
                      <span class="row__title">{t.title || t.url}</span>
                      <span class="row__meta">
                        {hostOf(t.url)} · {t.topicName ?? 'No topic'}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
