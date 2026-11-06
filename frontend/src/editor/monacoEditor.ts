// Monaco setup. This module is loaded lazily (own chunk).
// Only the core editor + SQL syntax. One worker: the editor worker.
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { editorBridge, type EditorBridge } from './bridge';
import { requestCompletion, updateTab, useStore } from '../state/store';
import type { CompletionKind } from '../api/protocol';
import { getTheme, onThemeChange } from '../theme';

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

const FONT = "'Cascadia Mono', 'JetBrains Mono', Consolas, 'SF Mono', Menlo, monospace";

monaco.editor.defineTheme('wb-dark', {
  base: 'vs-dark', inherit: true,
  rules: [
    { token: 'keyword', foreground: '7aa2f7' },
    { token: 'string', foreground: '9ece6a' },
    { token: 'number', foreground: 'ff9e64' },
    { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
  ],
  colors: {
    'editor.background': '#1b1d23',
    'editorGutter.background': '#1b1d23',
    'editor.lineHighlightBackground': '#23262e',
    'editorLineNumber.foreground': '#4b5263',
    'editorLineNumber.activeForeground': '#9aa3b2',
    'editor.selectionBackground': '#2f4a7a',
  },
});
monaco.editor.defineTheme('wb-light', {
  base: 'vs', inherit: true,
  rules: [
    { token: 'keyword', foreground: '1d4ed8' },
    { token: 'string', foreground: '15803d' },
    { token: 'number', foreground: 'b45309' },
    { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.lineHighlightBackground': '#f3f6fb',
    'editorLineNumber.foreground': '#a0a7b4',
    'editorLineNumber.activeForeground': '#4b5563',
  },
});

const KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'AS', 'ON', 'JOIN', 'LEFT', 'RIGHT',
  'INNER', 'OUTER', 'GROUP BY', 'ORDER BY', 'HAVING', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
  'CREATE TABLE', 'DROP TABLE', 'ALTER TABLE', 'UNION', 'UNION ALL', 'DISTINCT', 'CASE', 'WHEN', 'THEN',
  'ELSE', 'END', 'COMMIT', 'ROLLBACK', 'ASC', 'DESC', 'LIKE', 'BETWEEN', 'EXISTS', 'WITH', 'COUNT', 'SUM',
  'MIN', 'MAX', 'AVG', 'NVL', 'COALESCE', 'SYSDATE', 'ROWNUM', 'DUAL', 'FETCH FIRST', 'ROWS ONLY',
];
const K = monaco.languages.CompletionItemKind;
const KINDS: Record<CompletionKind, monaco.languages.CompletionItemKind> = {
  table: K.Struct, view: K.Interface, column: K.Field, keyword: K.Keyword, param: K.Property, value: K.Value, other: K.Text,
};
/** Editor model -> statement tab, so the provider asks the server for the right connection. */
const modelTab = new WeakMap<monaco.editor.ITextModel, string>();

// Ctrl+Space: the engine's list (tables, columns, Wb parameters) for the cursor position, as in the desktop app.
// Not connected or no answer: the keyword list.
monaco.languages.registerCompletionItemProvider('sql', {
  async provideCompletionItems(model, pos) {
    const w = model.getWordUntilPosition(pos);
    const range = new monaco.Range(pos.lineNumber, w.startColumn, pos.lineNumber, w.endColumn);
    const tabId = modelTab.get(model);
    const r = tabId ? await requestCompletion(tabId, model.getValue(), model.getOffsetAt(pos)) : null;
    if (r?.items.length) {
      return {
        suggestions: r.items.map((it, i) => ({
          label: it.label, kind: KINDS[it.kind] ?? K.Text, insertText: it.insert, detail: it.detail,
          sortText: String(i).padStart(5, '0'), range,
        })),
      };
    }
    return {
      suggestions: KEYWORDS.map((k) => ({ label: k, kind: K.Keyword, insertText: k, range })),
    };
  },
});

/** Read-only SQL viewer (DB Explorer "Source"). */
export function mountReadOnly(el: HTMLElement, text: string): { setText(t: string): void; dispose(): void } {
  const model = monaco.editor.createModel(text, 'sql');
  const ed = monaco.editor.create(el, {
    model, readOnly: true, domReadOnly: true,
    theme: getTheme() === 'dark' ? 'wb-dark' : 'wb-light',
    fontFamily: FONT, fontSize: 13, lineHeight: 19, minimap: { enabled: false }, automaticLayout: true,
    scrollBeyondLastLine: false, lineNumbersMinChars: 3, overviewRulerLanes: 0, renderLineHighlight: 'none',
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  });
  return {
    setText: (t) => model.setValue(t),
    dispose: () => { ed.dispose(); model.dispose(); },
  };
}

export function mountEditor(el: HTMLElement): { dispose(): void } {
  const editor = monaco.editor.create(el, {
    model: null,
    theme: getTheme() === 'dark' ? 'wb-dark' : 'wb-light',
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 19,
    minimap: { enabled: false },
    automaticLayout: true,
    scrollBeyondLastLine: false,
    lineNumbersMinChars: 3,
    renderLineHighlight: 'line',
    // Like the desktop app: completion only on Ctrl+Space.
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    wordBasedSuggestions: 'currentDocument',
    fixedOverflowWidgets: true,
    tabSize: 2,
    contextmenu: true,
    overviewRulerLanes: 0,
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  });

  const models = new Map<string, monaco.editor.ITextModel>();
  const views = new Map<string, monaco.editor.ICodeEditorViewState | null>();
  const decos = new Map<string, string[]>();
  const sqlTimers = new Map<string, number>();
  let currentTab = '';

  function modelFor(tabId: string): monaco.editor.ITextModel {
    let m = models.get(tabId);
    if (!m) {
      const tab = useStore.getState().tabs.find((t) => t.id === tabId);
      m = monaco.editor.createModel(tab?.sql ?? '', 'sql');
      models.set(tabId, m);
      modelTab.set(m, tabId);
      const model = m;
      model.onDidChangeContent(() => {
        // Store gets the text a bit later; snapshot() reads the model directly.
        window.clearTimeout(sqlTimers.get(tabId));
        sqlTimers.set(tabId, window.setTimeout(() => updateTab(tabId, { sql: model.getValue() }), 250));
      });
    }
    return m;
  }

  function show(tabId: string) {
    if (!tabId || tabId === currentTab) return;
    if (useStore.getState().tabs.find((t) => t.id === tabId)?.kind === 'explorer') return;
    if (currentTab && models.has(currentTab)) views.set(currentTab, editor.saveViewState());
    currentTab = tabId;
    editor.setModel(modelFor(tabId));
    const vs = views.get(tabId);
    if (vs) editor.restoreViewState(vs);
    else {
      const tab = useStore.getState().tabs.find((t) => t.id === tabId);
      if (tab) editor.setPosition({ lineNumber: tab.cursor.line, column: tab.cursor.col });
    }
    if (!useStore.getState().dialog) editor.focus();
  }

  editor.onDidChangeCursorPosition((e) => {
    if (currentTab) updateTab(currentTab, { cursor: { line: e.position.lineNumber, col: e.position.column } });
  });

  const bridge: EditorBridge = {
    snapshot(tabId) {
      const m = models.get(tabId);
      if (!m) return null;
      const sql = m.getValue();
      if (tabId !== currentTab) return { sql, cursor: sql.length, selStart: 0, selEnd: 0 };
      const pos = editor.getPosition();
      const sel = editor.getSelection();
      return {
        sql,
        cursor: pos ? m.getOffsetAt(pos) : 0,
        selStart: sel ? m.getOffsetAt(sel.getStartPosition()) : 0,
        selEnd: sel ? m.getOffsetAt(sel.getEndPosition()) : 0,
      };
    },
    setText(tabId, sql) {
      const m = modelFor(tabId);
      // Keep undo: replace through an edit, not setValue.
      m.pushEditOperations([], [{ range: m.getFullModelRange(), text: sql }], () => null);
    },
    insert(text) {
      const sel = editor.getSelection();
      if (!sel) return;
      editor.executeEdits('wb', [{ range: sel, text, forceMoveMarkers: true }]);
      editor.focus();
    },
    run(actionId) {
      editor.focus();
      editor.trigger('wb', actionId, null);
    },
    focus() { editor.focus(); },
    setCursorOffset(tabId, offset) {
      const m = models.get(tabId);
      if (!m || tabId !== currentTab) return;
      const p = m.getPositionAt(offset);
      editor.setPosition(p);
      editor.revealPositionInCenterIfOutsideViewport(p);
    },
    highlight(tabId, start, length) {
      const m = models.get(tabId);
      if (!m) return;
      const a = m.getPositionAt(start);
      const b = m.getPositionAt(start + length);
      decos.set(tabId, m.deltaDecorations(decos.get(tabId) ?? [], [{
        range: new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column),
        options: { className: 'running-stmt', isWholeLine: false },
      }]));
    },
    clearHighlight(tabId) {
      const m = models.get(tabId);
      if (m) decos.set(tabId, m.deltaDecorations(decos.get(tabId) ?? [], []));
    },
    disposeTab(tabId) {
      models.get(tabId)?.dispose();
      models.delete(tabId);
      views.delete(tabId);
      decos.delete(tabId);
      if (currentTab === tabId) currentTab = '';
    },
  };
  editorBridge.current = bridge;

  show(useStore.getState().activeTabId);
  const unsubStore = useStore.subscribe((s) => show(s.activeTabId));
  const unsubTheme = onThemeChange(() => monaco.editor.setTheme(getTheme() === 'dark' ? 'wb-dark' : 'wb-light'));

  return {
    dispose() {
      unsubStore();
      unsubTheme();
      editor.dispose();
      models.forEach((m) => m.dispose());
    },
  };
}
