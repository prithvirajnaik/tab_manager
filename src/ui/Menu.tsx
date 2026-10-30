import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { MoreIcon } from './icons';

export type MenuItem = {
  label: string;
  /** Accessible name; it includes what the item acts on. */
  ariaLabel: string;
  icon?: ComponentChildren;
  title?: string;
  danger?: boolean;
  /** aria-disabled, not disabled, so the item stays reachable by arrow keys. */
  disabled?: boolean;
  onSelect: () => void;
};

type Props = {
  label: string;
  items: MenuItem[];
  /** The trigger, so callers can return focus to it. */
  triggerRef?: RefObject<HTMLButtonElement | null>;
};

/** A ⋮ menu button: arrow keys, Home/End, Escape and Tab close it; a click outside too. */
export function Menu({ label, items, triggerRef }: Props) {
  const [open, setOpen] = useState(false);
  const own = useRef<HTMLButtonElement>(null);
  const trigger = triggerRef ?? own;
  const list = useRef<HTMLUListElement>(null);

  const itemButtons = () => [
    ...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
  ];

  useEffect(() => {
    if (!open) return;
    itemButtons()[0]?.focus();
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!list.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const buttons = itemButtons();
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (n: number) => buttons[(n + buttons.length) % buttons.length]?.focus();
    if (e.key === 'ArrowDown') focus(i + 1);
    else if (e.key === 'ArrowUp') focus(i - 1);
    else if (e.key === 'Home') focus(0);
    else if (e.key === 'End') focus(buttons.length - 1);
    else if (e.key === 'Escape') close(true);
    else if (e.key === 'Tab') return close(false);
    else return;
    e.preventDefault();
  };

  return (
    <div class="menu">
      <button
        ref={trigger}
        type="button"
        class="btn btn--icon"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreIcon />
      </button>
      {open && (
        <ul ref={list} class="menu__list" role="menu" aria-label={label} onKeyDown={onKeyDown}>
          {items.map((item) => (
            <li key={item.ariaLabel} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                class={`menu__item${item.danger ? ' menu__item--danger' : ''}`}
                aria-label={item.ariaLabel}
                aria-disabled={item.disabled}
                title={item.title}
                onClick={() => {
                  if (item.disabled) return;
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
