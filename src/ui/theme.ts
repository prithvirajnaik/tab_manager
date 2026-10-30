import { readPref, THEMES, type Theme } from './prefs';

export const THEME_LABELS: Record<Theme, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

export const readTheme = (): Theme => readPref('theme', THEMES, 'system');

/** "System" removes the override, so the stylesheet follows the browser's colour scheme. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
