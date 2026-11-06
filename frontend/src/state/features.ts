// DB Explorer tab, macros and bookmarks.
import type { Macro } from '../api/protocol';
import { editorBridge } from '../editor/bridge';
import {
  activeTab, ensureConnected, executeText, log, makeTab, selectTab, useStore,
} from './store';

// ---- DB Explorer ----
export function openExplorer() {
  const s = useStore.getState();
  const cur = activeTab();
  if (!cur) return;
  const existing = s.tabs.find((t) => t.kind === 'explorer' && t.profileId === cur.profileId);
  if (existing) { selectTab(existing.id); return; }
  const tab = {
    ...makeTab('DB Explorer', cur.profileId),
    kind: 'explorer' as const,
    sourceTabId: cur.kind === 'explorer' ? cur.sourceTabId : cur.id,
  };
  useStore.setState({ tabs: [...s.tabs, tab], activeTabId: tab.id });
  void ensureConnected(tab.id);
}

// ---- Macros ----
export function saveMacros(macros: Macro[]) {
  useStore.setState({ macros });
}

/** Like the desktop app: run the macro text in the current tab, or insert it. */
export function runMacro(m: Macro, how: 'run' | 'insert' = 'run') {
  const tab = activeTab();
  if (!tab || tab.kind === 'explorer') return;
  if (how === 'insert') {
    editorBridge.current.insert(m.sql);
    return;
  }
  log(tab.id, 'info', `Macro: ${m.name}`);
  void executeText(tab.id, m.sql);
}

// ---- Bookmarks: "-- @WbTag name" lines in the SQL of the tabs ----
export interface Bookmark { tabId: string; tabTitle: string; name: string; line: number }
const TAG = /^\s*--\s*@WbTag\s+(.+?)\s*$/;

export function findBookmarks(): Bookmark[] {
  const out: Bookmark[] = [];
  for (const t of useStore.getState().tabs) {
    if (t.kind === 'explorer') continue;
    const sql = editorBridge.current.snapshot(t.id)?.sql ?? t.sql;
    sql.split('\n').forEach((l, i) => {
      const m = l.match(TAG);
      if (m) out.push({ tabId: t.id, tabTitle: t.title, name: m[1], line: i + 1 });
    });
  }
  return out;
}

export function jumpTo(b: Bookmark) {
  selectTab(b.tabId);
  const t = useStore.getState().tabs.find((x) => x.id === b.tabId);
  if (!t) return;
  const sql = editorBridge.current.snapshot(t.id)?.sql ?? t.sql;
  const lines = sql.split('\n');
  let offset = 0;
  for (let i = 0; i < b.line - 1 && i < lines.length; i++) offset += lines[i].length + 1;
  // Next frame: the editor shows the tab first.
  requestAnimationFrame(() => {
    editorBridge.current.setCursorOffset(t.id, offset);
    editorBridge.current.focus();
  });
}
