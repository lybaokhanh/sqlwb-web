// Action handlers. An action without a handler shows as disabled.
import type { ActionId } from './shortcuts';
import { client } from './api/client';
import { editorBridge } from './editor/bridge';
import { toggleTheme } from './theme';
import { toggleVerticalTabs } from './tabLayout';
import { isAutoComplete, toggleAutoComplete } from './editor/autoComplete';
import { saveNow } from './state/persist';
import { logout } from './boot';
import {
  activeTab, addTab, cancelExec, closeTab, cycleTab, disconnectTab, ensureConnected, execute, formatSql, log, updateTab, useStore,
} from './state/store';
import { splitStatements } from './sql/split';
import { optimizeWidths } from './components/gridUtil';
import { deleteRow, hasEdits, insertRow } from './state/edits';
import { saveResultChanges } from './state/save';
import { buildText, type ExportFormat } from './state/exporter';
import { openExplorer } from './state/features';

type Handler = () => void;
const ed = () => editorBridge.current;
const tabConnected = () => activeTab()?.conn === 'connected';
const activeResult = () => {
  const t = activeTab();
  return t?.results.find((r) => r.id === t.activeResult);
};

/** Loaded rows to the clipboard (TSV or INSERT statements). */
function copyResult(fmt: ExportFormat) {
  const t = activeTab();
  const r = activeResult();
  if (!t || !r) return;
  const text = buildText(r, fmt);
  const ok = () => log(t.id, 'info', `${r.rowCount} rows copied to clipboard${fmt === 'sql' ? ' as INSERT statements' : ''}.`);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(ok, () => log(t.id, 'error', 'Clipboard not available (needs https or localhost).'));
  } else {
    log(t.id, 'error', 'Clipboard not available (needs https or localhost).');
  }
}

function prompt(title: string, value: string, onOk: (v: string) => void) {
  useStore.setState({ dialog: { kind: 'prompt', title, value, onOk } });
}

function setHistory(pos: number) {
  const t = activeTab();
  if (!t || t.history.length === 0) return;
  const p = Math.max(0, Math.min(t.history.length - 1, pos));
  updateTab(t.id, { histPos: p, sql: t.history[p] });
  ed().setText(t.id, t.history[p]);
}

const handlers: Partial<Record<ActionId, Handler>> = {
  connect: () => useStore.setState({ dialog: { kind: 'connect' } }),
  disconnect: () => { const t = activeTab(); if (t) disconnectTab(t.id); },
  reconnect: () => { const t = activeTab(); if (t) void ensureConnected(t.id); },
  logout: () => void logout(),
  newTab: addTab,
  closeTab: () => { const t = activeTab(); if (t) closeTab(t.id); },
  renameTab: () => {
    const t = activeTab();
    if (t) prompt('Rename tab', t.title, (v) => v.trim() && updateTab(t.id, { title: v.trim() }));
  },
  nextTab: () => cycleTab(1),
  prevTab: () => cycleTab(-1),
  saveWorkspace: () => {
    const t = activeTab();
    void saveNow().then((ok) => {
      if (t) log(t.id, ok ? 'info' : 'warn', ok ? 'Workspace saved.' : 'Server not reachable: workspace saved in this browser only.');
    });
  },
  undo: () => ed().run('undo'),
  redo: () => ed().run('redo'),
  find: () => ed().run('actions.find'),
  replace: () => ed().run('editor.action.startFindReplaceAction'),
  toggleComment: () => ed().run('editor.action.commentLine'),
  lowerCase: () => ed().run('editor.action.transformToLowercase'),
  upperCase: () => ed().run('editor.action.transformToUppercase'),
  matchBracket: () => ed().run('editor.action.jumpToBracket'),
  gotoLine: () => ed().run('editor.action.gotoLine'),
  commandPalette: () => useStore.setState({ palette: true }),
  focusEditor: () => ed().focus(),
  sqlEditor: () => ed().focus(),
  focusMaxRows: () => {
    const el = document.getElementById('max-rows') as HTMLInputElement | null;
    el?.focus();
    el?.select();
  },
  expandEditor: () => {
    const t = activeTab();
    if (!t) return;
    if (t.split >= 0.99) updateTab(t.id, { split: t.prevSplit ?? 0.45, prevSplit: undefined });
    else updateTab(t.id, { prevSplit: t.split, split: 1 });
  },
  toggleTheme,
  verticalTabs: toggleVerticalTabs,
  filter: () => {
    const t = activeTab();
    if (t) updateTab(t.id, { filterOpen: !t.filterOpen });
  },
  findInData: () => {
    const t = activeTab();
    if (!t) return;
    updateTab(t.id, { filterOpen: true });
    setTimeout(() => (document.getElementById('grid-filter') as HTMLInputElement | null)?.focus(), 0);
  },
  copyData: () => copyResult('tsv'),
  copyAsInsert: () => copyResult('sql'),
  saveDataAs: () => {
    const t = activeTab();
    const r = activeResult();
    if (t && r) useStore.setState({ dialog: { kind: 'export', tabId: t.id, resultId: r.id } });
  },
  saveChanges: () => {
    const t = activeTab();
    const r = activeResult();
    if (t && r) void saveResultChanges(t.id, r.id);
  },
  insertRow: () => { const t = activeTab(); const r = activeResult(); if (t && r) insertRow(t.id, r.id); },
  copyRow: () => { const t = activeTab(); const r = activeResult(); if (t && r && r.sel != null) insertRow(t.id, r.id, r.sel); },
  deleteRow: () => { const t = activeTab(); const r = activeResult(); if (t && r && r.sel != null) deleteRow(t.id, r.id, r.sel); },
  dbExplorer: openExplorer,
  manageMacros: () => useStore.setState({ dialog: { kind: 'macros' } }),
  runMacro: () => useStore.setState({ dialog: { kind: 'macros' } }),
  bookmarks: () => useStore.setState({ dialog: { kind: 'bookmarks' } }),
  files: () => useStore.setState({ dialog: { kind: 'files' } }),
  loadRun: () => { const t = activeTab(); if (t) updateTab(t.id, { loadOpen: true, activeResult: 'load', split: Math.min(t.split, 0.45) }); },
  optimizeWidths: () => {
    const t = activeTab();
    const r = activeResult();
    if (t && r) updateTab(t.id, { results: t.results.map((x) => (x.id === r.id ? { ...x, widths: optimizeWidths(x) } : x)) });
  },
  closeResult: () => {
    const t = activeTab();
    const r = activeResult();
    if (!t || !r) return;
    const results = t.results.filter((x) => x.id !== r.id);
    updateTab(t.id, { results, activeResult: results[0]?.id ?? 'messages' });
  },
  execCurrent: () => void execute('current'),
  execSelected: () => void execute('selected'),
  execAll: () => void execute('all'),
  cancel: cancelExec,
  reformat: () => {
    const t = activeTab();
    if (!t) return;
    const snap = ed().snapshot(t.id);
    const sql = snap ? snap.sql : t.sql;
    void formatSql(t.id, sql).then((f) => {
      ed().setText(t.id, f);
      updateTab(t.id, { sql: f });
    });
  },
  completion: () => ed().run('editor.action.triggerSuggest'),
  autoCompletion: () => {
    toggleAutoComplete();
    const t = activeTab();
    if (t) log(t.id, 'info', `Auto completion while typing: ${isAutoComplete() ? 'on' : 'off (Ctrl+Space still works)'}`);
  },
  jumpToStatement: () => {
    const t = activeTab();
    if (!t) return;
    const sql = ed().snapshot(t.id)?.sql ?? t.sql;
    const stmts = splitStatements(sql);
    prompt(`Jump to statement # (1 - ${stmts.length})`, '1', (v) => {
      const n = parseInt(v, 10);
      const s = stmts[n - 1];
      if (s) { ed().setCursorOffset(t.id, s.start); ed().focus(); }
    });
  },
  commit: () => { const t = activeTab(); if (t) client.send({ type: 'commit', tabId: t.id }); },
  rollback: () => { const t = activeTab(); if (t) client.send({ type: 'rollback', tabId: t.id }); },
  histFirst: () => setHistory(0),
  histBack: () => setHistory((activeTab()?.histPos ?? 0) - 1),
  histNext: () => setHistory((activeTab()?.histPos ?? 0) + 1),
  histLast: () => setHistory((activeTab()?.history.length ?? 1) - 1),
  shortcutList: () => useStore.setState({ dialog: { kind: 'shortcuts' } }),
  about: () => {
    void client.version().then((v) => {
      const s = useStore.getState();
      const lines = [v.app, `SQL Workbench/J build ${v.wbBuild} (${v.wbBuildDate})`];
      if (s.session?.user) lines.push(`Logged in as ${s.session.user}${s.session.admin ? ' (admin)' : ''}`);
      if (s.update?.updateAvailable) lines.push(`Build ${s.update.latest} available${s.update.latestDate ? ` (${s.update.latestDate})` : ''}`);
      if (client.mock) lines.push('Mock server (no backend)');
      useStore.setState({ dialog: { kind: 'about', text: lines.join('\n') } });
    });
  },
};

/** Extra conditions on top of "has a handler". */
const conditions: Partial<Record<ActionId, () => boolean>> = {
  closeTab: () => useStore.getState().tabs.length > 1,
  cancel: () => !!activeTab()?.running,
  commit: () => tabConnected() && !useStore.getState().profiles[activeTab()!.profileId]?.autocommit,
  rollback: () => tabConnected() && !useStore.getState().profiles[activeTab()!.profileId]?.autocommit,
  disconnect: tabConnected,
  reconnect: () => { const t = activeTab(); return !!t && t.conn !== 'connected' && t.conn !== 'connecting'; },
  copyData: () => !!activeResult(),
  copyAsInsert: () => !!activeResult(),
  saveDataAs: () => !!activeResult(),
  saveChanges: () => { const r = activeResult(); return !!r?.table && hasEdits(r.id); },
  insertRow: () => !!activeResult()?.table,
  copyRow: () => { const r = activeResult(); return !!r?.table && r.sel != null; },
  deleteRow: () => { const r = activeResult(); return !!r?.table && r.sel != null; },
  dbExplorer: () => !!activeTab(),
  loadRun: () => activeTab()?.kind !== 'explorer',
  filter: () => !!activeResult(),
  findInData: () => !!activeResult(),
  optimizeWidths: () => !!activeResult(),
  closeResult: () => !!activeResult(),
  histFirst: () => (activeTab()?.history.length ?? 0) > 0,
  histBack: () => (activeTab()?.histPos ?? 0) > 0,
  histNext: () => { const t = activeTab(); return !!t && t.histPos < t.history.length - 1; },
  histLast: () => (activeTab()?.history.length ?? 0) > 0,
};

export function hasHandler(id: ActionId): boolean {
  return !!handlers[id];
}

export function isEnabled(id: ActionId): boolean {
  if (!handlers[id]) return false;
  const c = conditions[id];
  return c ? c() : true;
}

export function runAction(id: ActionId) {
  if (isEnabled(id)) handlers[id]!();
}
