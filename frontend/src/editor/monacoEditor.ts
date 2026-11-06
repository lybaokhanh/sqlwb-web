// Monaco setup. This module is loaded lazily (own chunk).
// Only the core editor + SQL syntax. One worker: the editor worker.
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution';
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { editorBridge, type EditorBridge } from './bridge';
import { requestCompletion, updateTab, useStore } from '../state/store';
import type { CompletionKind } from '../api/protocol';
import { getTheme, onThemeChange } from '../theme';
import { isAutoComplete, onAutoComplete } from './autoComplete';

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

// JSON for the cell dialog: a small Monarch tokenizer (the full JSON language needs its own worker).
if (!monaco.languages.getLanguages().some((l) => l.id === 'json')) {
  monaco.languages.register({ id: 'json', extensions: ['.json'] });
  monaco.languages.setMonarchTokensProvider('json', {
    tokenizer: {
      root: [
        [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'type'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
        [/\b(?:true|false|null)\b/, 'keyword'],
        [/[{}[\],:]/, 'delimiter'],
      ],
    },
  });
  monaco.languages.setLanguageConfiguration('json', {
    brackets: [['{', '}'], ['[', ']']],
    autoClosingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '"', close: '"' }],
  });
}

const KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'AS', 'ON', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN',
  'INNER JOIN', 'FULL OUTER JOIN', 'CROSS JOIN', 'GROUP BY', 'ORDER BY', 'HAVING', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET',
  'DELETE FROM', 'MERGE INTO', 'USING', 'MATCHED', 'CREATE TABLE', 'CREATE INDEX', 'CREATE OR REPLACE', 'DROP TABLE',
  'ALTER TABLE', 'ADD', 'MODIFY', 'TRUNCATE TABLE', 'UNION', 'UNION ALL', 'MINUS', 'INTERSECT', 'DISTINCT', 'CASE', 'WHEN',
  'THEN', 'ELSE', 'END', 'COMMIT', 'ROLLBACK', 'ASC', 'DESC', 'NULLS FIRST', 'NULLS LAST', 'LIKE', 'BETWEEN', 'EXISTS',
  'WITH', 'OVER', 'PARTITION BY', 'FETCH FIRST', 'ROWS ONLY', 'OFFSET', 'LIMIT', 'GRANT', 'REVOKE', 'CONNECT BY',
  'START WITH', 'PRIOR', 'DUAL', 'ROWNUM', 'ROWID', 'SYSDATE', 'SYSTIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIMESTAMP',
];
const FUNCTIONS = [
  'COUNT', 'SUM', 'MIN', 'MAX', 'AVG', 'NVL', 'NVL2', 'COALESCE', 'NULLIF', 'DECODE', 'CAST', 'TO_CHAR', 'TO_DATE',
  'TO_NUMBER', 'TO_TIMESTAMP', 'TRUNC', 'ROUND', 'SUBSTR', 'INSTR', 'LENGTH', 'UPPER', 'LOWER', 'TRIM', 'LTRIM', 'RTRIM',
  'REPLACE', 'LPAD', 'RPAD', 'CONCAT', 'REGEXP_LIKE', 'REGEXP_SUBSTR', 'REGEXP_REPLACE', 'ADD_MONTHS', 'MONTHS_BETWEEN',
  'LAST_DAY', 'EXTRACT', 'LISTAGG', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD', 'JSON_VALUE', 'JSON_QUERY',
  'JSON_TABLE', 'JSON_OBJECT', 'JSON_ARRAYAGG', 'XMLTYPE', 'GREATEST', 'LEAST', 'ABS', 'MOD', 'FLOOR', 'CEIL',
];
const SNIPPETS: { label: string; text: string; doc: string }[] = [
  { label: 'select-from', text: 'SELECT ${2:*}\nFROM ${1:table}\nWHERE ${3:1 = 1}', doc: 'SELECT ... FROM ... WHERE' },
  { label: 'select-count', text: 'SELECT COUNT(*)\nFROM ${1:table}', doc: 'SELECT COUNT(*) FROM' },
  { label: 'select-group-count', text: 'SELECT ${2:col}, COUNT(*)\nFROM ${1:table}\nGROUP BY ${2:col}\nORDER BY 2 DESC', doc: 'Count per value' },
  { label: 'insert-into', text: 'INSERT INTO ${1:table} (${2:cols})\nVALUES (${3:values})', doc: 'INSERT INTO ... VALUES' },
  { label: 'update-set', text: 'UPDATE ${1:table}\nSET ${2:col} = ${3:value}\nWHERE ${4:cond}', doc: 'UPDATE ... SET ... WHERE' },
  { label: 'delete-from', text: 'DELETE FROM ${1:table}\nWHERE ${2:cond}', doc: 'DELETE FROM ... WHERE' },
  { label: 'case-when', text: 'CASE WHEN ${1:cond} THEN ${2:a} ELSE ${3:b} END', doc: 'CASE expression' },
  { label: 'fetch-first', text: 'FETCH FIRST ${1:100} ROWS ONLY', doc: 'Row limit (Oracle 12c+)' },
];
/** After these words a space opens the list (tables or columns). */
const SPACE_CONTEXT = /\b(from|join|into|update|table|select|where|and|or|on|by|set|having|describe|desc)\s$/i;
const K = monaco.languages.CompletionItemKind;
const KINDS: Record<CompletionKind, monaco.languages.CompletionItemKind> = {
  table: K.Struct, view: K.Interface, column: K.Field, keyword: K.Keyword, param: K.Property, value: K.Value, other: K.Text,
};
/** Editor model -> statement tab, so the provider asks the server for the right connection. */
const modelTab = new WeakMap<monaco.editor.ITextModel, string>();

/** True when the cursor is in a string literal or a comment of the current line (simple scan). */
function inStringOrComment(line: string): boolean {
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === "'") q = false; continue; }
    if (c === "'") q = true;
    else if (c === '-' && line[i + 1] === '-') return true;
  }
  return q;
}

/** Same case as the typed word: "sel" gives "select", "Sel"/"SEL" give "SELECT". Quoted or mixed-case names stay as they are. */
function caseLike(typed: string, text: string): string {
  if (!typed || typed !== typed.toLowerCase() || typed === typed.toUpperCase()) return text;
  return /^[A-Z0-9_$# ().*,]+$/.test(text) ? text.toLowerCase() : text;
}

// Completion: the engine's list (tables, columns, Wb parameters) for the cursor position, as in the desktop app,
// plus keywords, functions and snippets. Opens while typing (auto completion on), after "." and after "FROM " etc.
monaco.languages.registerCompletionItemProvider('sql', {
  triggerCharacters: ['.', ' '],
  async provideCompletionItems(model, pos, ctx) {
    const lineBefore = model.getLineContent(pos.lineNumber).slice(0, pos.column - 1);
    const auto = ctx.triggerKind !== monaco.languages.CompletionTriggerKind.Invoke;
    if (auto && inStringOrComment(lineBefore)) return { suggestions: [] };
    if (ctx.triggerCharacter === ' ' && !SPACE_CONTEXT.test(lineBefore)) return { suggestions: [] };
    const afterDot = /\.\w*$/.test(lineBefore);
    const w = model.getWordUntilPosition(pos);
    const range = new monaco.Range(pos.lineNumber, w.startColumn, pos.lineNumber, w.endColumn);
    const tabId = modelTab.get(model);
    const r = tabId ? await requestCompletion(tabId, model.getValue(), model.getOffsetAt(pos)) : null;
    const seen = new Set<string>();
    const out: monaco.languages.CompletionItem[] = [];
    (r?.items ?? []).forEach((it, i) => {
      seen.add(it.label.toUpperCase());
      out.push({
        label: { label: it.label, description: it.detail }, kind: KINDS[it.kind] ?? K.Text,
        insertText: it.kind === 'keyword' ? caseLike(w.word, it.insert) : it.insert,
        detail: it.detail, sortText: `a${String(i).padStart(5, '0')}`, range,
      });
    });
    // After "alias." only the engine's columns make sense.
    if (afterDot) return { suggestions: out };
    // After "FROM " etc. with an engine list: no keyword noise.
    if (ctx.triggerCharacter === ' ' && out.length) return { suggestions: out };
    for (const k of KEYWORDS) {
      if (seen.has(k)) continue;
      const kw = caseLike(w.word, k);
      out.push({ label: kw, kind: K.Keyword, insertText: kw, sortText: `b${k}`, range });
    }
    for (const f of FUNCTIONS) {
      if (seen.has(f)) continue;
      out.push({
        label: `${caseLike(w.word, f)}()`, filterText: caseLike(w.word, f), kind: K.Function, sortText: `c${f}`, range,
        insertText: `${caseLike(w.word, f)}($0)`, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      });
    }
    for (const s of SNIPPETS) {
      out.push({
        label: s.label, kind: K.Snippet, detail: s.doc, documentation: s.text.replace(/\$\{\d+:([^}]*)\}/g, '$1'),
        sortText: `d${s.label}`, range, insertText: s.text,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      });
    }
    return { suggestions: out };
  },
});

const suggestOptions = (on: boolean): monaco.editor.IEditorOptions => ({
  quickSuggestions: on ? { other: true, comments: false, strings: false } : false,
  suggestOnTriggerCharacters: on,
});

/** Editor for one cell value (cell dialog). */
export function mountCellEditor(el: HTMLElement, text: string, lang: string, readOnly: boolean) {
  const model = monaco.editor.createModel(text, lang);
  const ed = monaco.editor.create(el, {
    model, readOnly,
    theme: getTheme() === 'dark' ? 'wb-dark' : 'wb-light',
    fontFamily: FONT, fontSize: 13, lineHeight: 19, minimap: { enabled: false }, automaticLayout: true,
    scrollBeyondLastLine: false, lineNumbersMinChars: 3, wordWrap: 'on', folding: true,
    quickSuggestions: false, wordBasedSuggestions: 'off', tabSize: 2,
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  });
  ed.focus();
  return {
    getText: () => model.getValue(),
    setText: (t: string) => model.pushEditOperations([], [{ range: model.getFullModelRange(), text: t }], () => null),
    setLanguage: (l: string) => monaco.editor.setModelLanguage(model, l),
    onChange: (f: () => void) => model.onDidChangeContent(f),
    dispose: () => { ed.dispose(); model.dispose(); },
  };
}

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
    // Auto completion while typing (SQL → Auto completion while typing); Ctrl+Space always works.
    ...suggestOptions(isAutoComplete()),
    quickSuggestionsDelay: 150,
    suggestSelection: 'first',
    suggest: { localityBonus: true },
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
  const unsubAuto = onAutoComplete((on) => editor.updateOptions(suggestOptions(on)));

  return {
    dispose() {
      unsubStore();
      unsubTheme();
      unsubAuto();
      editor.dispose();
      models.forEach((m) => m.dispose());
    },
  };
}
