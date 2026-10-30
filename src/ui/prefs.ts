/**
 * Per-page display preferences (sort, layout). They are not user data, so they live in this
 * page's localStorage rather than the store, and the page works the same without them.
 */
const PREFIX = 'tab-topics:';

export const LAYOUTS = ['grid', 'list'] as const;
export type Layout = (typeof LAYOUTS)[number];

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(PREFIX + key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // Storage blocked or full: the preference just does not persist.
  }
}
