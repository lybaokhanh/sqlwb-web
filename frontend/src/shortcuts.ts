// Central shortcut registry. Menus, toolbar tooltips, the command palette,
// the key editor and the global key handler all read this file.
// Keys follow SQL Workbench/J. Some keys are reserved by the browser or the OS
// (Ctrl+T, Ctrl+W, Ctrl+Tab): those actions also get an Alt alternative.
//
// Key text form: modifiers in the order Mod, Ctrl, Alt, Shift, Meta, then the key.
// Mod = Cmd on macOS, Ctrl on Windows and Linux.
// Ctrl = the physical Control key on macOS. On Windows and Linux "Ctrl" becomes "Mod".
// Meta = the Windows / Super key on Windows and Linux. No default uses it.
import { useStore } from './state/store';

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
  | 'manageMacros' | 'runMacro' | 'dbExplorer' | 'compareData' | 'files' | 'options' | 'shortcutList' | 'about';

export type Platform = 'mac' | 'win' | 'linux';

export interface ActionDef {
  id: ActionId;
  label: string;
  /** Default keys. The first key is the main one. Others are alternatives. */
  keys?: string[];
  /** macOS defaults, when they are not the same as `keys`. */
  mac?: string[];
  /**
   * Monaco handles the default keys of this action itself. The global handler leaves them alone,
   * and the user cannot remove them (built-in keys). Keys that the user adds run from the app.
   */
  native?: boolean;
}

export const ACTIONS: ActionDef[] = [
  // File / tabs
  { id: 'connect', label: 'Connect window', keys: ['Alt+C'] },
  { id: 'disconnect', label: 'Disconnect' },
  { id: 'reconnect', label: 'Reconnect' },
  { id: 'logout', label: 'Log out' },
  { id: 'newTab', label: 'Add tab', keys: ['Mod+T', 'Alt+T'] },
  { id: 'closeTab', label: 'Close tab', keys: ['Mod+K'] },
  { id: 'renameTab', label: 'Rename tab' },
  { id: 'nextTab', label: 'Next tab', keys: ['Mod+Tab', 'Alt+PageDown'], mac: ['Ctrl+Alt+Right'] },
  { id: 'prevTab', label: 'Previous tab', keys: ['Mod+Shift+Tab', 'Alt+PageUp'], mac: ['Ctrl+Alt+Left'] },
  { id: 'saveWorkspace', label: 'Save workspace', keys: ['Mod+Shift+S'] },
  { id: 'loadWorkspace', label: 'Load workspace...' },
  { id: 'exit', label: 'Exit' },
  // Edit
  { id: 'undo', label: 'Undo', keys: ['Mod+Z'], native: true },
  { id: 'redo', label: 'Redo', keys: ['Mod+Shift+Z'], native: true },
  { id: 'find', label: 'Find...', keys: ['Mod+F'], native: true },
  { id: 'replace', label: 'Replace...', keys: ['Mod+H'], mac: ['Mod+Alt+F'], native: true },
  { id: 'toggleComment', label: 'Toggle comment', keys: ['Mod+Shift+C'] },
  { id: 'lowerCase', label: 'Make lowercase', keys: ['Mod+L'] },
  { id: 'upperCase', label: 'Make uppercase', keys: ['Mod+U'] },
  { id: 'matchBracket', label: 'Match bracket', keys: ['Mod+B'] },
  { id: 'gotoLine', label: 'Jump to line...', keys: ['Mod+G'], mac: ['Ctrl+G'], native: true },
  { id: 'commandPalette', label: 'Command palette...', keys: ['Mod+Shift+P'] },
  // View
  { id: 'focusEditor', label: 'Focus editor', keys: ['Mod+1'] },
  { id: 'sqlEditor', label: 'SQL editor', keys: ['F5'] },
  { id: 'focusMaxRows', label: 'Max. rows field', keys: ['F7'] },
  { id: 'expandEditor', label: 'Expand editor', keys: ['Mod+Shift+D'] },
  { id: 'toggleTheme', label: 'Toggle dark / light theme' },
  { id: 'verticalTabs', label: 'Tabs on the side (vertical tabs)', keys: ['Mod+Shift+,', 'Alt+Shift+T'] },
  // Data
  { id: 'saveChanges', label: 'Save changes to database' },
  { id: 'insertRow', label: 'Insert row' },
  { id: 'copyRow', label: 'Copy row' },
  { id: 'deleteRow', label: 'Delete row' },
  { id: 'filter', label: 'Filter data' },
  { id: 'findInData', label: 'Find in data...', keys: ['Mod+Shift+F'] },
  { id: 'copyData', label: 'Copy data to clipboard', keys: ['Mod+Y'] },
  { id: 'copyAsInsert', label: 'Copy as SQL INSERT' },
  { id: 'saveDataAs', label: 'Save data as...' },
  { id: 'optimizeWidths', label: 'Optimize column widths', keys: ['Mod+W', 'Alt+W'] },
  { id: 'closeResult', label: 'Close result', keys: ['Mod+Shift+K'] },
  // SQL
  { id: 'execCurrent', label: 'Execute Current', keys: ['Mod+Enter'] },
  { id: 'execSelected', label: 'Execute Selected', keys: ['Mod+E'] },
  { id: 'execAll', label: 'Execute All', keys: ['Mod+Shift+E'] },
  { id: 'cancel', label: 'Cancel' },
  { id: 'reformat', label: 'Reformat SQL', keys: ['Mod+R'] },
  // Ctrl+Space on all platforms: Ctrl becomes Mod on Windows / Linux, Cmd+Space is Spotlight on macOS.
  { id: 'completion', label: 'Code completion', keys: ['Ctrl+Space'], native: true },
  { id: 'autoCompletion', label: 'Auto completion while typing (on / off)' },
  { id: 'jumpToStatement', label: 'Jump to statement #...', keys: ['Mod+J'] },
  { id: 'commit', label: 'Commit', keys: ['Alt+M'] },
  { id: 'rollback', label: 'Rollback', keys: ['Alt+R'] },
  { id: 'histFirst', label: 'First statement in history' },
  // Option+Left / Right moves by word on macOS.
  { id: 'histBack', label: 'Previous statement in history', keys: ['Alt+Left'], mac: ['Ctrl+Alt+Up'] },
  { id: 'histNext', label: 'Next statement in history', keys: ['Alt+Right'], mac: ['Ctrl+Alt+Down'] },
  { id: 'histLast', label: 'Last statement in history' },
  // Macros / Tools / Help
  { id: 'manageMacros', label: 'Manage macros...', keys: ['Mod+M'], mac: ['Mod+Shift+M'] },
  { id: 'runMacro', label: 'Run macro...' },
  { id: 'dbExplorer', label: 'DB Explorer', keys: ['Mod+D'] },
  { id: 'compareData', label: 'Compare data...' },
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

// ---- Platform ----
let platformCache: Platform | undefined;

/** The OS of this browser: 'mac', 'win' or 'linux'. */
export function platform(): Platform {
  if (platformCache) return platformCache;
  const nav = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { userAgentData?: { platform?: string } };
  const p = `${nav?.userAgentData?.platform || nav?.platform || nav?.userAgent || ''}`.toLowerCase();
  platformCache = /mac|iphone|ipad|ipod/.test(p) ? 'mac' : /win/.test(p) ? 'win' : 'linux';
  return platformCache;
}

export const PLATFORM_NAME: Record<Platform, string> = { mac: 'macOS', win: 'Windows', linux: 'Linux' };

// ---- Key text ----
const MODS = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta'] as const;

const CODE_NAMES: Record<string, string> = {
  ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', NumpadEnter: 'Enter', Escape: 'Esc',
  Comma: ',', Period: '.', Slash: '/', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
  Backquote: '`', Minus: '-', Equal: '=', Backslash: '\\',
};

/** Key name for a KeyboardEvent.code, e.g. KeyA -> A, Digit1 -> 1, ArrowLeft -> Left. */
function codeName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return CODE_NAMES[code] ?? code;
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'Esc', escape: 'Esc', enter: 'Enter', return: 'Enter', tab: 'Tab', space: 'Space',
  left: 'Left', right: 'Right', up: 'Up', down: 'Down',
  arrowleft: 'Left', arrowright: 'Right', arrowup: 'Up', arrowdown: 'Down',
  pageup: 'PageUp', pagedown: 'PageDown', home: 'Home', end: 'End', insert: 'Insert', delete: 'Delete',
  del: 'Delete', backspace: 'Backspace', comma: ',', period: '.', slash: '/', minus: '-', equal: '=',
};

// Other KeyboardEvent.code names that a key text can contain.
const OTHER_CODES = [
  'Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9',
  'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'NumpadDecimal', 'NumpadEqual', 'NumpadComma',
  'IntlBackslash', 'IntlRo', 'IntlYen', 'ContextMenu', 'PrintScreen', 'ScrollLock', 'Pause', 'NumLock',
];

/** Lower-case name -> key name, for aliases and code names. The lookup is not case-sensitive. */
const NAME_BY_LOWER: Record<string, string> = Object.fromEntries([
  ...Object.entries(CODE_NAMES).map(([c, n]) => [c.toLowerCase(), n]),
  ...OTHER_CODES.map((c) => [c.toLowerCase(), c]),
  ...Object.entries(KEY_ALIASES),
]);

function keyName(k: string): string {
  if (k.length === 1) return k.toUpperCase();
  const l = k.toLowerCase();
  if (NAME_BY_LOWER[l]) return NAME_BY_LOWER[l];
  if (/^f\d{1,2}$/.test(l)) return l.toUpperCase();
  if (/^key[a-z]$/.test(l)) return l.slice(3).toUpperCase();
  if (/^digit\d$/.test(l)) return l.slice(5);
  // Unknown name: upper-case the first letter, as the old macro matcher did.
  return codeName(k[0].toUpperCase() + k.slice(1));
}

function build(mods: Set<string>, key: string): string {
  return [...MODS.filter((m) => mods.has(m)), key].join('+');
}

/**
 * Canonical key text, e.g. "ctrl+shift+e" -> "Mod+Shift+E" on Windows.
 * `ctrlIsMod`: treat Ctrl as Mod on macOS too (old macro keys).
 * Returns '' when the text has no key.
 */
export function normalizeKey(text: string, ctrlIsMod = false, p: Platform = platform()): string {
  let t = text.trim();
  if (!t) return '';
  // A key of '+' itself ("Ctrl++").
  let plusKey = false;
  if (t.endsWith('++')) { plusKey = true; t = t.slice(0, -2); } else if (t === '+') return '+';
  const parts = t.split('+').map((s) => s.trim()).filter(Boolean);
  const mods = new Set<string>();
  let key = plusKey ? '+' : '';
  parts.forEach((part, i) => {
    const l = part.toLowerCase();
    const last = i === parts.length - 1 && !plusKey;
    if (l === 'mod' || l === 'cmd' || l === 'command' || part === '⌘') mods.add('Mod');
    else if (l === 'ctrl' || l === 'control' || part === '⌃') mods.add(p === 'mac' && !ctrlIsMod ? 'Ctrl' : 'Mod');
    else if (l === 'alt' || l === 'option' || l === 'opt' || part === '⌥') mods.add('Alt');
    else if (l === 'shift' || part === '⇧') mods.add('Shift');
    else if (l === 'meta' || l === 'win' || l === 'super') mods.add(p === 'mac' ? 'Mod' : 'Meta');
    else if (last) key = keyName(part);
  });
  return key ? build(mods, key) : '';
}

const MODIFIER_CODES = /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$|^(CapsLock|Fn|FnLock|AltGraph)$/;

/** Canonical key text of a key event, or '' for a modifier-only press. */
export function eventToKey(e: KeyboardEvent, p: Platform = platform()): string {
  if (!e.code || MODIFIER_CODES.test(e.code)) return '';
  const mods = new Set<string>();
  if (p === 'mac') {
    if (e.metaKey) mods.add('Mod');
    if (e.ctrlKey) mods.add('Ctrl');
  } else {
    if (e.ctrlKey) mods.add('Mod');
    if (e.metaKey) mods.add('Meta');
  }
  if (e.altKey) mods.add('Alt');
  if (e.shiftKey) mods.add('Shift');
  return build(mods, codeName(e.code));
}

const MAC_ARROWS: Record<string, string> = { Left: '←', Right: '→', Up: '↑', Down: '↓', Enter: '↩', Esc: '⎋', Tab: '⇥' };

/** Display text: "Ctrl+Shift+E" on Windows / Linux, "⇧⌘E" on macOS. */
export function formatKey(k: string, p: Platform = platform()): string {
  const parts = k.split('+');
  const key = k.endsWith('++') ? '+' : parts[parts.length - 1];
  const mods = new Set(k.endsWith('++') ? parts.slice(0, -2) : parts.slice(0, -1));
  if (p === 'mac') {
    const sym = (mods.has('Ctrl') ? '⌃' : '') + (mods.has('Alt') ? '⌥' : '') + (mods.has('Shift') ? '⇧' : '') + (mods.has('Mod') ? '⌘' : '');
    return sym + (MAC_ARROWS[key] ?? key);
  }
  const names: Record<string, string> = { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: p === 'win' ? 'Win' : 'Super' };
  return [...MODS.filter((m) => mods.has(m)).map((m) => names[m]), key].join('+');
}

// ---- Reserved keys ----
// The browser or the OS keeps these keys. A web page never gets them.
const BROWSER_KEYS = ['Mod+T', 'Mod+W', 'Mod+N', 'Mod+Shift+T', 'Mod+Shift+N', 'Mod+Shift+W'];
const RESERVED: Record<Platform, Record<string, string>> = {
  win: {
    ...Object.fromEntries([...BROWSER_KEYS, 'Mod+Tab', 'Mod+Shift+Tab'].map((k) => [k, 'The browser keeps this key'])),
    'Alt+Tab': 'Windows keeps this key', 'Alt+Shift+Tab': 'Windows keeps this key', 'Alt+F4': 'Windows keeps this key',
  },
  linux: {
    ...Object.fromEntries([...BROWSER_KEYS, 'Mod+Tab', 'Mod+Shift+Tab'].map((k) => [k, 'The browser keeps this key'])),
    'Alt+Tab': 'The desktop keeps this key', 'Alt+Shift+Tab': 'The desktop keeps this key', 'Alt+F4': 'The desktop keeps this key',
    'Mod+Alt+T': 'The desktop keeps this key', 'Mod+Alt+Left': 'The desktop keeps this key', 'Mod+Alt+Right': 'The desktop keeps this key',
    'Mod+Alt+Up': 'The desktop keeps this key', 'Mod+Alt+Down': 'The desktop keeps this key',
  },
  mac: {
    ...Object.fromEntries([...BROWSER_KEYS, 'Ctrl+Tab', 'Ctrl+Shift+Tab'].map((k) => [k, 'The browser keeps this key'])),
    ...Object.fromEntries(['Mod+Q', 'Mod+H', 'Mod+M', 'Mod+Tab', 'Mod+Shift+Tab', 'Mod+`', 'Mod+Space', 'Mod+Alt+Esc']
      .map((k) => [k, 'macOS keeps this key'])),
  },
};

/** Why the browser or the OS keeps this key, or undefined when the page gets it. */
export function reservedKey(k: string, p: Platform = platform()): string | undefined {
  return RESERVED[p][k];
}

// ---- Keys that the user cannot record ----
const CLIPBOARD_KEYS = ['Mod+C', 'Mod+V', 'Mod+X', 'Mod+A'];

/**
 * Why the user cannot record this key, or undefined when the key is usable.
 * Reserved keys and the keys of other actions are checked elsewhere.
 */
export function keyProblem(k: string, p: Platform = platform()): string | undefined {
  const parts = k.endsWith('++') ? [...k.slice(0, -2).split('+'), '+'] : k.split('+');
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  // One character: a letter, a digit or a punctuation key.
  const printable = key.length === 1;
  if (CLIPBOARD_KEYS.includes(k)) return 'Copy, paste, cut and select all need this key.';
  // Windows / Linux: AltGr sends Ctrl+Alt. It types @ { } ą and more on many keyboards.
  if (p !== 'mac' && printable && mods.has('Mod') && mods.has('Alt')) {
    return 'AltGr types characters with this key on many keyboards.';
  }
  // macOS: Option (with or without Shift) types characters, e.g. ⌥E, ⌥⇧K.
  if (p === 'mac' && printable && mods.has('Alt') && !mods.has('Mod') && !mods.has('Ctrl')) {
    return 'Option types characters with this key.';
  }
  // Plain keys (also with Shift only) are for typing. Function keys are allowed.
  if (![...mods].some((m) => m !== 'Shift') && !/^F\d{1,2}$/.test(key)) {
    return p === 'mac' ? 'Add ⌘, ⌃ or ⌥, or use a function key.' : 'Add Ctrl or Alt, or use a function key.';
  }
  return undefined;
}

// ---- Effective keys (defaults + user overrides) ----
export type KeyOverrides = Partial<Record<ActionId, string[]>>;

/** Default keys on this platform, without reserved keys. */
export function defaultKeys(id: ActionId, p: Platform = platform()): string[] {
  const a = ACTION_BY_ID[id];
  const list = (p === 'mac' && a.mac) ? a.mac : (a.keys ?? []);
  const out: string[] = [];
  for (const k of list) {
    const n = normalizeKey(k, false, p);
    if (n && !reservedKey(n, p) && !out.includes(n)) out.push(n);
  }
  return out;
}

/** The user overrides of this platform (from the workspace). */
export function overrides(p: Platform = platform()): KeyOverrides {
  return (useStore.getState().keys?.[p] ?? {}) as KeyOverrides;
}

export function isOverridden(id: ActionId, p: Platform = platform()): boolean {
  return Array.isArray(overrides(p)[id]);
}

/**
 * Built-in keys: the default keys of a native action on this platform. Monaco keeps them.
 * The user cannot remove them or give them to another action.
 */
export function builtinKeys(id: ActionId, p: Platform = platform()): string[] {
  return ACTION_BY_ID[id].native ? defaultKeys(id, p) : [];
}

/** The native action that has this key as a built-in key, or undefined. */
export function builtinOwner(k: string, p: Platform = platform()): ActionId | undefined {
  return ACTIONS.find((a) => a.native && defaultKeys(a.id, p).includes(k))?.id;
}

/** Keys that run this action now: the built-in keys, then the user override (else the defaults). */
export function keysFor(id: ActionId, p: Platform = platform()): string[] {
  const o = overrides(p)[id];
  if (!Array.isArray(o)) return defaultKeys(id, p);
  const builtin = builtinKeys(id, p);
  // A built-in key of another action stays with that action (old saved workspaces).
  const extra = o.filter((k) => !builtin.includes(k) && !builtinOwner(k, p));
  return [...builtin, ...extra];
}

/** Text for menus and tooltips, e.g. "Ctrl+T / Alt+T". */
export function shortcutText(id: ActionId): string {
  return keysFor(id).map((k) => formatKey(k)).join(' / ');
}

/** Sets the user keys of one action on this platform. `null` removes the override (back to defaults). */
export function setActionKeys(changes: Partial<Record<ActionId, string[] | null>>, p: Platform = platform()) {
  const all = useStore.getState().keys ?? {};
  const mine: Record<string, string[]> = { ...(all[p] ?? {}) };
  for (const [id, list] of Object.entries(changes)) {
    if (list === null) {
      delete mine[id];
      continue;
    }
    // Same as the defaults: no override needed.
    const def = defaultKeys(id as ActionId, p);
    if (list && list.length === def.length && list.every((k, i) => k === def[i])) delete mine[id];
    else if (list) mine[id] = list;
  }
  const next = { ...all };
  if (Object.keys(mine).length) next[p] = mine;
  else delete next[p];
  useStore.setState({ keys: next });
}

/** Removes all user keys of this platform. */
export function resetAllKeys(p: Platform = platform()) {
  const next = { ...(useStore.getState().keys ?? {}) };
  delete next[p];
  useStore.setState({ keys: next });
}

/** The action that has this key now (other than `except`), or undefined. */
export function actionForKey(k: string, except?: ActionId): ActionId | undefined {
  return ACTIONS.find((a) => a.id !== except && keysFor(a.id).includes(k))?.id;
}

// ---- Key matching ----
interface Bound { id: ActionId; native: boolean }
let mapFor: unknown;
let map = new Map<string, Bound>();

function lookup(): Map<string, Bound> {
  const s = useStore.getState().keys;
  if (s === mapFor && map.size) return map;
  mapFor = s;
  map = new Map();
  for (const a of ACTIONS) {
    // Native per key: a built-in key stays with Monaco and the inputs.
    // A key that the user added runs from the app.
    const builtin = builtinKeys(a.id);
    for (const k of keysFor(a.id)) {
      const native = builtin.includes(k);
      const old = map.get(k);
      if (!old || (native && !old.native)) map.set(k, { id: a.id, native });
    }
  }
  return map;
}

/** The action for a key event, or undefined. Native Monaco keys are skipped. */
export function matchEvent(e: KeyboardEvent): ActionId | undefined {
  const k = eventToKey(e);
  if (!k) return undefined;
  const b = lookup().get(k);
  return b && !b.native ? b.id : undefined;
}

/** Canonical form of a macro key. Macros treat Ctrl as Mod (Cmd on macOS), as before. */
export function macroKey(text: string): string {
  return normalizeKey(text, true);
}

/** True when the event matches a key text like "Ctrl+Alt+1" (macro shortcuts). */
export function matchKey(e: KeyboardEvent, key: string): boolean {
  const k = macroKey(key);
  return !!k && k === eventToKey(e);
}
