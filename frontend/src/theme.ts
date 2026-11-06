// Dark / light theme. Default follows the OS. The toggle saves a choice.
import { useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';
const KEY = 'sqlwb.theme';
const listeners = new Set<() => void>();

function saved(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'dark' || t === 'light' ? t : null;
  } catch {
    return null;
  }
}

function system(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getTheme(): Theme {
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'dark' ? 'dark' : 'light';
}

function apply(t: Theme) {
  document.documentElement.setAttribute('data-theme', t);
  listeners.forEach((l) => l());
}

/** Set and remember a theme. Fires 'sqlwb-theme' so the workspace saves. */
export function setTheme(t: Theme) {
  if (t === getTheme() && saved() === t) return;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* storage blocked: choice lasts for this page only */
  }
  apply(t);
  document.dispatchEvent(new Event('sqlwb-theme'));
}

export function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

export function initTheme() {
  apply(saved() ?? system());
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!saved()) apply(system());
  });
}

export function onThemeChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useTheme(): Theme {
  return useSyncExternalStore(onThemeChange, getTheme);
}
