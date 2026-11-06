// Tab position like Edge: a strip on top, or a sidebar on the left (vertical tabs).
// The choice and the sidebar width stay in this browser (localStorage).
import { useSyncExternalStore } from 'react';

const KEY = 'sqlwb.verticalTabs';
const WIDTH_KEY = 'sqlwb.tabSidebarWidth';
export const SIDEBAR_MIN = 140;
export const SIDEBAR_MAX = 480;
const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage blocked: choice lasts for this page only */
  }
}

let vertical = read(KEY) === '1';
let width = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Number(read(WIDTH_KEY)) || 220));

const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function setVerticalTabs(v: boolean) {
  vertical = v;
  write(KEY, v ? '1' : '0');
  notify();
}

export function toggleVerticalTabs() {
  setVerticalTabs(!vertical);
}

export function setSidebarWidth(w: number, save = true) {
  width = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));
  if (save) write(WIDTH_KEY, String(width));
  notify();
}

export function useVerticalTabs(): boolean {
  return useSyncExternalStore(subscribe, () => vertical);
}

export function useSidebarWidth(): number {
  return useSyncExternalStore(subscribe, () => width);
}
