// Central shortcut registry. Menus, toolbar tooltips, the command palette
// and the global key handler all read this list.
// Keys follow SQL Workbench/J. Some keys are reserved by browsers
// (Ctrl+T, Ctrl+W, Ctrl+Tab): those actions also get an Alt alternative.

export type ActionId =
  | 'connect' | 'disconnect' | 'reconnect' | 'logout' | 'newTab' | 'closeTab' | 'renameTab' | 'nextTab' | 'prevTab'
  | 'saveWorkspace' | 'loadWorkspace' | 'exit'
  | 'undo' | 'redo' | 'find' | 'replace' | 'toggleComment' | 'lowerCase' | 'upperCase'
  | 'matchBracket' | 'gotoLine' | 'commandPalette'
  | 'focusEditor' | 'sqlEditor' | 'focusMaxRows' | 'expandEditor' | 'toggleTheme' | 'verticalTabs'
  | 'saveChanges' | 'insertRow' | 'copyRow' | 'deleteRow' | 'filter' | 'findInData'
  | 'copyData' | 'copyAsInsert' | 'saveDataAs' | 'optimizeWidths' | 'closeResult' | 'bookmarks' | 'loadRun'
  | 'execCurrent' | 'execSelected' | 'execAll' | 'cancel' | 'reformat' | 'completion' | 'autoCompletion'
  | 'jumpToStatement' | 'commit' | 'rollback'
  | 'histFirst' | 'histBack' | 'histNext' | 'histLast'
  | 'manageMacros' | 'runMacro' | 'dbExplorer' | 'files' | 'options' | 'shortcutList' | 'about';

export interface ActionDef {
  id: ActionId;
  label: string;
  /** First key is the main one. Others are alternatives. */
  keys?: string[];
  /** Key is handled by Monaco itself (the global handler leaves it alone). */
  native?: boolean;
}

export const ACTIONS: ActionDef[] = [
  // File / tabs
  { id: 'connect', label: 'Connect window', keys: ['Alt+C'] },
  { id: 'disconnect', label: 'Disconnect' },
  { id: 'reconnect', label: 'Reconnect' },
  { id: 'logout', label: 'Log out' },
  { id: 'newTab', label: 'Add tab', keys: ['Ctrl+T', 'Alt+T'] },
  { id: 'closeTab', label: 'Close tab', keys: ['Ctrl+K'] },
  { id: 'renameTab', label: 'Rename tab' },
  { id: 'nextTab', label: 'Next tab', keys: ['Ctrl+Tab', 'Alt+PageDown'] },
  { id: 'prevTab', label: 'Previous tab', keys: ['Ctrl+Shift+Tab', 'Alt+PageUp'] },
  { id: 'saveWorkspace', label: 'Save workspace', keys: ['Ctrl+Shift+S'] },
  { id: 'loadWorkspace', label: 'Load workspace...' },
  { id: 'exit', label: 'Exit' },
  // Edit
  { id: 'undo', label: 'Undo', keys: ['Ctrl+Z'], native: true },
  { id: 'redo', label: 'Redo', keys: ['Ctrl+Shift+Z'], native: true },
  { id: 'find', label: 'Find...', keys: ['Ctrl+F'], native: true },
  { id: 'replace', label: 'Replace...', keys: ['Ctrl+H'], native: true },
  { id: 'toggleComment', label: 'Toggle comment', keys: ['Ctrl+Shift+C'] },
  { id: 'lowerCase', label: 'Make lowercase', keys: ['Ctrl+L'] },
  { id: 'upperCase', label: 'Make uppercase', keys: ['Ctrl+U'] },
  { id: 'matchBracket', label: 'Match bracket', keys: ['Ctrl+B'] },
  { id: 'gotoLine', label: 'Jump to line...', keys: ['Ctrl+G'], native: true },
  { id: 'commandPalette', label: 'Command palette...', keys: ['Ctrl+Shift+P'] },
  // View
  { id: 'focusEditor', label: 'Focus editor', keys: ['Ctrl+1'] },
  { id: 'sqlEditor', label: 'SQL editor', keys: ['F5'] },
  { id: 'focusMaxRows', label: 'Max. rows field', keys: ['F7'] },
  { id: 'expandEditor', label: 'Expand editor', keys: ['Ctrl+Shift+D'] },
  { id: 'toggleTheme', label: 'Toggle dark / light theme' },
  { id: 'verticalTabs', label: 'Tabs on the side (vertical tabs)', keys: ['Ctrl+Shift+,', 'Alt+Shift+T'] },
  // Data
  { id: 'saveChanges', label: 'Save changes to database' },
  { id: 'insertRow', label: 'Insert row' },
  { id: 'copyRow', label: 'Copy row' },
  { id: 'deleteRow', label: 'Delete row' },
  { id: 'filter', label: 'Filter data' },
  { id: 'findInData', label: 'Find in data...', keys: ['Ctrl+Shift+F'] },
  { id: 'copyData', label: 'Copy data to clipboard', keys: ['Ctrl+Y'] },
  { id: 'copyAsInsert', label: 'Copy as SQL INSERT' },
  { id: 'saveDataAs', label: 'Save data as...' },
  { id: 'optimizeWidths', label: 'Optimize column widths', keys: ['Ctrl+W', 'Alt+W'] },
  { id: 'closeResult', label: 'Close result', keys: ['Ctrl+Shift+K'] },
  // SQL
  { id: 'execCurrent', label: 'Execute Current', keys: ['Ctrl+Enter'] },
  { id: 'execSelected', label: 'Execute Selected', keys: ['Ctrl+E'] },
  { id: 'execAll', label: 'Execute All', keys: ['Ctrl+Shift+E'] },
  { id: 'cancel', label: 'Cancel' },
  { id: 'reformat', label: 'Reformat SQL', keys: ['Ctrl+R'] },
  { id: 'completion', label: 'Code completion', keys: ['Ctrl+Space'], native: true },
  { id: 'autoCompletion', label: 'Auto completion while typing (on / off)' },
  { id: 'jumpToStatement', label: 'Jump to statement #...', keys: ['Ctrl+J'] },
  { id: 'commit', label: 'Commit', keys: ['Alt+M'] },
  { id: 'rollback', label: 'Rollback', keys: ['Alt+R'] },
  { id: 'histFirst', label: 'First statement in history' },
  { id: 'histBack', label: 'Previous statement in history', keys: ['Alt+Left'] },
  { id: 'histNext', label: 'Next statement in history', keys: ['Alt+Right'] },
  { id: 'histLast', label: 'Last statement in history' },
  // Macros / Tools / Help
  { id: 'manageMacros', label: 'Manage macros...', keys: ['Ctrl+M'] },
  { id: 'runMacro', label: 'Run macro...' },
  { id: 'dbExplorer', label: 'DB Explorer', keys: ['Ctrl+D'] },
  { id: 'files', label: 'Files (WbExport / WbImport)...' },
  { id: 'options', label: 'Options...' },
  { id: 'bookmarks', label: 'Bookmarks...' },
  { id: 'loadRun', label: 'Load run...' },
  { id: 'shortcutList', label: 'Keyboard shortcuts' },
  { id: 'about', label: 'About' },
];

export const ACTION_BY_ID: Record<ActionId, ActionDef> = Object.fromEntries(
  ACTIONS.map((a) => [a.id, a]),
) as Record<ActionId, ActionDef>;

/** Text for menus and tooltips, e.g. "Ctrl+T / Alt+T". */
export function shortcutText(id: ActionId): string {
  return (ACTION_BY_ID[id].keys ?? []).join(' / ');
}

// ---- Key matching ----
interface Chord { ctrl: boolean; shift: boolean; alt: boolean; code: string }

const NAMED: Record<string, string> = {
  Enter: 'Enter', Tab: 'Tab', Space: 'Space', Left: 'ArrowLeft', Right: 'ArrowRight',
  Up: 'ArrowUp', Down: 'ArrowDown', PageDown: 'PageDown', PageUp: 'PageUp', Esc: 'Escape', ',': 'Comma',
};

function parse(key: string): Chord {
  const parts = key.split('+');
  const k = parts[parts.length - 1];
  let code: string;
  if (NAMED[k]) code = NAMED[k];
  else if (/^F\d+$/.test(k)) code = k;
  else if (/^[A-Z]$/.test(k)) code = `Key${k}`;
  else if (/^\d$/.test(k)) code = `Digit${k}`;
  else code = k;
  return { ctrl: parts.includes('Ctrl'), shift: parts.includes('Shift'), alt: parts.includes('Alt'), code };
}

const CHORDS: { id: ActionId; chord: Chord; native: boolean }[] = ACTIONS.flatMap((a) =>
  (a.keys ?? []).map((k) => ({ id: a.id, chord: parse(k), native: !!a.native })),
);

/** The action for a key event, or undefined. Native Monaco keys are skipped. */
export function matchEvent(e: KeyboardEvent): ActionId | undefined {
  const ctrl = e.ctrlKey || e.metaKey;
  for (const c of CHORDS) {
    if (c.native) continue;
    const ch = c.chord;
    if (ch.code === e.code && ch.ctrl === ctrl && ch.shift === e.shiftKey && ch.alt === e.altKey) return c.id;
  }
  return undefined;
}


/** True when the event matches a key text like "Ctrl+Alt+1" (macro shortcuts). */
export function matchKey(e: KeyboardEvent, key: string): boolean {
  const ch = parse(key.trim().split('+').map((p) => (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1))).join('+'));
  return ch.code === e.code && ch.ctrl === (e.ctrlKey || e.metaKey) && ch.shift === e.shiftKey && ch.alt === e.altKey;
}