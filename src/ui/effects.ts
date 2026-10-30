import { readPref, writePref } from './prefs';

/** Surface effects (glass, transparency): each is a switch plus a strength. */
export const EFFECT_LEVELS = ['subtle', 'medium', 'strong'] as const;
export type EffectLevel = (typeof EFFECT_LEVELS)[number];

export const EFFECT_LEVEL_LABELS: Record<EffectLevel, string> = {
  subtle: 'Subtle',
  medium: 'Medium',
  strong: 'Strong',
};

export type EffectName = 'glass' | 'transparency';
export type Effect = { on: boolean; level: EffectLevel };

export const readEffect = (name: EffectName): Effect => ({
  on: readPref(name, ['on', 'off'], 'off') === 'on',
  level: readPref(`${name}-level`, EFFECT_LEVELS, 'medium'),
});

export function writeEffect(name: EffectName, { on, level }: Effect): void {
  writePref(name, on ? 'on' : 'off');
  writePref(`${name}-level`, level);
}

/** The stylesheet does the rest: no attribute means opaque surfaces. */
export function applyEffect(name: EffectName, { on, level }: Effect): void {
  const root = document.documentElement;
  if (on) root.setAttribute(`data-${name}`, level);
  else root.removeAttribute(`data-${name}`);
}
