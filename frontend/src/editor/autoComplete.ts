// Auto completion while typing: on/off, kept in this browser. Ctrl+Space works in both cases.
const KEY = 'sqlwb.autoComplete';
let on = (() => {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
})();
const listeners = new Set<(on: boolean) => void>();

export function isAutoComplete(): boolean {
  return on;
}

export function setAutoComplete(v: boolean) {
  on = v;
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    /* storage blocked: choice lasts for this page only */
  }
  listeners.forEach((l) => l(v));
}

export function toggleAutoComplete() {
  setAutoComplete(!on);
}

export function onAutoComplete(l: (on: boolean) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
