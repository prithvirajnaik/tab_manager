import { useEffect, useRef, useState } from 'preact/hooks';
import { PlusIcon } from './icons';

type Props = {
  busy: boolean;
  /** Resolves true when the window was saved. */
  onSave: (name: string) => Promise<boolean>;
};

/** "Save this window" button with a small name form under it. */
export function SaveWindow({ busy, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div class="popover-host" ref={root}>
      <button
        ref={button}
        type="button"
        class="btn btn--primary btn--lg"
        aria-expanded={open}
        aria-controls="save-form"
        onClick={() => setOpen(!open)}
      >
        <PlusIcon />
        Save this window
      </button>
      {open && (
        <form
          id="save-form"
          class="popover"
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
          }}
          onSubmit={(e) => {
            e.preventDefault();
            void onSave(name).then((ok) => {
              if (!ok) return;
              setName('');
              close();
            });
          }}
        >
          <label class="popover__label" for="save-name">
            Save this window as
          </label>
          <div class="popover__row">
            <input
              ref={input}
              id="save-name"
              class="input"
              placeholder="Topic name, e.g. Japanese"
              value={name}
              maxLength={200}
              required
              onInput={(e) => setName(e.currentTarget.value)}
            />
            <button type="submit" class="btn btn--primary" disabled={busy || !name.trim()}>
              Save
            </button>
          </div>
          <p class="popover__hint">
            Its tabs stay in sync as you open and close them in this window.
          </p>
        </form>
      )}
    </div>
  );
}
