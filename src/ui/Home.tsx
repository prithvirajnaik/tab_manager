import { useEffect, useRef, useState } from 'preact/hooks';
import { SearchIcon } from './icons';

/** A saved topic or tab matching what is typed, picked straight from the home page. */
export type Suggestion = { key: string; label: string; detail: string; onPick: () => void };

type Props = {
  image: string | null;
  /** Null when the browser cannot run a search, so the bar is left out. */
  onSearch: ((text: string) => void) | null;
  /** Saved topics and tabs matching the text. Local only: no request leaves the browser. */
  suggest: (text: string) => Suggestion[];
  active: boolean;
};

const LISTBOX = 'home-suggestions';

/** The calm start screen: a background and a web search bar with matches from your topics. */
export function Home({ image, onSearch, suggest, active }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);

  // Typing is possible straight away, and again whenever the topics panel is put away.
  useEffect(() => {
    if (active) input.current?.focus();
  }, [active]);

  const query = text.trim();
  const options: Suggestion[] = query
    ? [
        ...(onSearch
          ? [
              {
                key: 'web',
                label: `Search the web for “${query}”`,
                detail: '',
                onPick: () => onSearch(query),
              },
            ]
          : []),
        ...suggest(query),
      ]
    : [];
  const showing = open && options.length > 0;
  const current = Math.min(cursor, options.length - 1);

  const pick = (option: Suggestion | undefined) => {
    if (!option) return;
    setOpen(false);
    option.onPick();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (options.length === 0) return;
      e.preventDefault();
      setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setCursor((current + step + options.length) % options.length);
    } else if (e.key === 'Escape' && showing) {
      // Closes the list first; the page-level handler leaves a handled Escape alone.
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      pick(options[current]);
    }
  };

  if (!onSearch) {
    return (
      <div
        class={`home${image ? ' home--image' : ''}${active ? '' : ' home--covered'}`}
        style={backdrop(image)}
      />
    );
  }

  return (
    <div
      class={`home${image ? ' home--image' : ''}${active ? '' : ' home--covered'}`}
      style={backdrop(image)}
    >
      <div class="home__body">
        <div class="home__search" role="search">
          <SearchIcon />
          <input
            ref={input}
            class="home__input"
            type="text"
            role="combobox"
            aria-label="Search the web"
            aria-expanded={showing}
            aria-controls={LISTBOX}
            aria-autocomplete="list"
            aria-activedescendant={showing ? `${LISTBOX}-${current}` : undefined}
            autocomplete="off"
            spellcheck={false}
            placeholder="Search the web"
            value={text}
            onInput={(e) => {
              setText(e.currentTarget.value);
              setCursor(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
          />
          {showing && (
            <ul class="home__list" id={LISTBOX} role="listbox" aria-label="Suggestions">
              {options.map((o, i) => (
                <li
                  key={o.key}
                  id={`${LISTBOX}-${i}`}
                  role="option"
                  aria-selected={i === current}
                  class="home__option"
                  // Keeps focus in the input, so a click does not close the list before it lands.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => setCursor(i)}
                  onClick={() => pick(o)}
                >
                  <span class="home__label">{o.label}</span>
                  {o.detail && <span class="home__detail">{o.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

const backdrop = (image: string | null) =>
  image ? { backgroundImage: `url("${image}")` } : undefined;
