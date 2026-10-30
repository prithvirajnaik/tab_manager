import { useRef } from 'preact/hooks';
import { MAX_BACKGROUND_BYTES } from './background';
import { EFFECT_LEVEL_LABELS, EFFECT_LEVELS, type Effect } from './effects';
import { GridIcon, ListIcon, PaletteIcon } from './icons';
import { LAYOUTS, THEMES, type Layout, type Theme } from './prefs';
import { SORT_LABELS, SORTS, type SortKey } from './selectors';
import { THEME_LABELS } from './theme';

type Props = {
  theme: Theme;
  layout: Layout;
  sort: SortKey;
  onTheme: (theme: Theme) => void;
  onLayout: (layout: Layout) => void;
  onSort: (sort: SortKey) => void;
  glass: Effect;
  onGlass: (glass: Effect) => void;
  transparency: Effect;
  onTransparency: (transparency: Effect) => void;
  /** Null when this browser cannot keep a background, so the setting is left out. */
  background: {
    has: boolean;
    error: string | null;
    onPick: (file: File) => void;
    onClear: () => void;
  } | null;
};

/** How the page looks. These are per-browser display preferences, not part of your topics. */
export function AppearancePanel({
  theme,
  layout,
  sort,
  onTheme,
  onLayout,
  onSort,
  glass,
  onGlass,
  transparency,
  onTransparency,
  background,
}: Props) {
  const file = useRef<HTMLInputElement>(null);
  return (
    <section class="panel" aria-labelledby="appearance-title">
      <header class="panel__head">
        <span class="panel__icon">
          <PaletteIcon />
        </span>
        <div>
          <h2 id="appearance-title" class="panel__title">
            Appearance
          </h2>
          <p class="hint">
            Saved in this browser only. They are not part of a backup, and your topics are never
            changed by them.
          </p>
        </div>
      </header>

      <div class="settings">
        <div class="setting">
          <div>
            <p class="setting__name">Theme</p>
            <p class="hint">System follows your browser's light or dark setting.</p>
          </div>
          <fieldset class="segmented">
            <legend class="visually-hidden">Theme</legend>
            {THEMES.map((t) => (
              <label key={t} class="segmented__option">
                <input
                  type="radio"
                  name="theme"
                  value={t}
                  checked={theme === t}
                  onChange={() => onTheme(t)}
                />
                <span>{THEME_LABELS[t]}</span>
              </label>
            ))}
          </fieldset>
        </div>

        <div class="setting">
          <div>
            <p class="setting__name">Topic layout</p>
            <p class="hint">Cards in a grid, or one compact row per topic.</p>
          </div>
          <fieldset class="segmented">
            <legend class="visually-hidden">Topic layout</legend>
            {LAYOUTS.map((l) => (
              <label key={l} class="segmented__option">
                <input
                  type="radio"
                  name="layout"
                  value={l}
                  checked={layout === l}
                  onChange={() => onLayout(l)}
                />
                <span class="segmented__label">
                  {l === 'grid' ? <GridIcon size={16} /> : <ListIcon size={16} />}
                  {l === 'grid' ? 'Grid' : 'List'}
                </span>
              </label>
            ))}
          </fieldset>
        </div>

        <div class="setting">
          <div>
            <p class="setting__name">
              <label for="settings-sort">Sort topics by</label>
            </p>
            <p class="hint">"Last updated" and "Most tabs" are ordered once, so cards stay put.</p>
          </div>
          <select
            id="settings-sort"
            class="select"
            value={sort}
            onChange={(e) => onSort(e.currentTarget.value as SortKey)}
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <EffectSetting
          name="Glass effect"
          group="glass"
          hint="Frosted, blurred surfaces on the rail, panel and home search."
          value={glass}
          onChange={onGlass}
        />
        <EffectSetting
          name="Transparency"
          group="transparency"
          hint="See-through surfaces without blur, on the same parts. It can be combined with glass."
          value={transparency}
          onChange={onTransparency}
        />
        <p class="hint">
          Both show best over a background image, and are off when your system asks for less
          transparency.
        </p>

        {background && (
          <div class="setting">
            <div>
              <p class="setting__name">Home background</p>
              <p class="hint">
                {background.has
                  ? 'Your image is behind the home page search bar.'
                  : `A plain gradient. Choose an image up to ${MAX_BACKGROUND_BYTES / 1024 / 1024} MB.`}{' '}
                It stays in this browser and is not part of a backup.
              </p>
              {background.error && (
                <p class="field-error" role="alert">
                  {background.error}
                </p>
              )}
            </div>
            <div class="setting__actions">
              <input
                ref={file}
                class="visually-hidden"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                aria-label="Choose a home background image"
                onChange={(e) => {
                  const picked = e.currentTarget.files?.[0];
                  e.currentTarget.value = '';
                  if (picked) background.onPick(picked);
                }}
              />
              <button type="button" class="btn" onClick={() => file.current?.click()}>
                {background.has ? 'Change image' : 'Choose image'}
              </button>
              {background.has && (
                <button type="button" class="btn" onClick={background.onClear}>
                  Remove
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function EffectSetting(props: {
  name: string;
  group: string;
  hint: string;
  value: Effect;
  onChange: (next: Effect) => void;
}) {
  const { name, group, hint, value, onChange } = props;
  return (
    <div class="setting">
      <div>
        <p class="setting__name">{name}</p>
        <p class="hint">{hint}</p>
      </div>
      <div class="setting__actions">
        <label class="switch">
          <input
            type="checkbox"
            role="switch"
            aria-label={name}
            checked={value.on}
            onChange={(e) => onChange({ ...value, on: e.currentTarget.checked })}
          />
          <span>{value.on ? 'On' : 'Off'}</span>
        </label>
        <fieldset class="segmented" disabled={!value.on}>
          <legend class="visually-hidden">{name} strength</legend>
          {EFFECT_LEVELS.map((l) => (
            <label key={l} class="segmented__option">
              <input
                type="radio"
                name={`${group}-level`}
                value={l}
                checked={value.level === l}
                onChange={() => onChange({ ...value, level: l })}
              />
              <span>{EFFECT_LEVEL_LABELS[l]}</span>
            </label>
          ))}
        </fieldset>
      </div>
    </div>
  );
}
