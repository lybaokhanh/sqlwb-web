// App state (zustand). Session, tabs, connection profiles, results, dialogs.
// Server messages are queued and applied once per animation frame, so a
// script with thousands of statements does not re-render thousands of times.
import { create } from 'zustand';
import type {
  ColumnInfo, CompletionMsg, ConnectionInfo, ExecMode, LoadStats, Macro, ProfileOptions, ServerMsg, SessionResponse, UpdateInfo,
} from '../api/protocol';
import { PROFILE_OPTION_KEYS } from '../api/protocol';
import { singleTable } from '../sql/table';
import { splitStatements, statementAt } from '../sql/split';
import { client, type LinkStatus } from '../api/client';
import { dropRows, putRows } from './rows';
import { editorBridge } from '../editor/bridge';

export interface Profile extends ProfileOptions {
  id: string;
  name: string;
  url: string;
  user: string;
  autocommit: boolean;
  fetchSize?: number;
  color: string;
  group?: string;
  /** Oracle: connect as SYSDBA (server adds internal_logon=sysdba). */
  sysdba?: boolean;
  /** Client blocks DML/DDL. */
  readOnly?: boolean;
  /** Ask before running DML. */
  confirmUpdates?: boolean;
  /** Ask before UPDATE or DELETE without WHERE. */
  confirmNoWhere?: boolean;
  rememberSchema?: boolean;
  /** Last DB Explorer schema (when rememberSchema is set). */
  explorerSchema?: string;
  /** Saved on the server (Connection Manager). Not set = only in this workspace. */
  saved?: boolean;
  tags?: string;
  savePassword?: boolean;
  /** Statement timeout in seconds (used when the status bar says 0). */
  timeout?: number;
}

export type ConnState = 'none' | 'connecting' | 'connected' | 'error';

export interface ResultSet {
  id: string;
  title: string;
  sql: string;
  columns: ColumnInfo[];
  rowCount: number;
  /** Final row count, -1 while unknown. */
  total: number;
  done: boolean;
  /** Server closed the cursor: no more rows come. */
  closed?: boolean;
  /** "Fetch all" or export: fetch the next pages without scrolling. */
  fetchAll?: boolean;
  /** Bumps on each rows message or edit, so the grid redraws. */
  version: number;
  widths?: number[];
  /** Table name when the SQL is a single-table SELECT (grid can be edited). */
  table?: string;
  /** Selected row index. */
  sel?: number;
  /** Client-side sort of the loaded rows (header click). dir 1 = ascending, -1 = descending. */
  sort?: { col: number; dir: 1 | -1 };
}

export interface LoadRun {
  reqId: string;
  running: boolean;
  sessions: number;
  seconds: number;
  ratePerSec: number;
  samples: LoadStats[];
  end?: LoadStats & { sessions: number };
}

export interface LogLine { level: 'info' | 'warn' | 'error'; text: string }

export interface StmtStat {
  index: number;
  sql: string;
  execMs: number;
  fetchMs: number;
  rows: number;
  error: boolean;
}

export interface Tab {
  id: string;
  /** 'explorer' = DB Explorer tab (own connection, same profile). */
  kind?: 'sql' | 'explorer';
  /** Explorer: the SQL tab it was opened from. */
  sourceTabId?: string;
  load?: LoadRun;
  loadOpen?: boolean;
  title: string;
  sql: string;
  cursor: { line: number; col: number };
  profileId: string;
  conn: ConnState;
  info?: ConnectionInfo;
  results: ResultSet[];
  /** Counter for result titles ("Result 7" stays "Result 7" when older ones drop). */
  resultSeq: number;
  messages: LogLine[];
  /** Lines dropped from the log (cap MAX_LOG). */
  hiddenLines: number;
  stats: StmtStat[];
  /** 'messages', 'stats' or a result id. */
  activeResult: string;
  /** Editor height as a fraction of the work area (0.1 .. 1). */
  split: number;
  prevSplit?: number;
  running: boolean;
  /** Server: a DML ran since the last commit or rollback. */
  txOpen?: boolean;
  reqId?: string;
  lastMs?: number;
  history: string[];
  histPos: number;
  filterOpen: boolean;
  filterText: string;
}

export type Dialog =
  | { kind: 'login'; tabId: string }
  | { kind: "connect"; select?: string }
  | { kind: 'about'; text: string }
  | { kind: 'shortcuts' }
  | { kind: 'prompt'; title: string; value: string; onOk: (v: string) => void }
  | { kind: 'update'; build: string }
  | { kind: 'restarting'; text: string }
  | { kind: 'confirm'; title: string; text: string; danger?: boolean; okLabel?: string; pre?: string; onOk: () => void; onCancel?: () => void }
  | { kind: 'keys'; tabId: string; resultId: string; onOk: (cols: string[]) => void }
  | { kind: 'macros' }
  | { kind: 'bookmarks' }
  | { kind: 'files' }
  | { kind: 'export'; tabId: string; resultId: string }
  | { kind: 'cell'; tabId: string; resultId: string; row: number; col: number };

export type AuthState = 'checking' | 'login' | 'ready';

interface State {
  auth: AuthState;
  session: SessionResponse | null;
  update: UpdateInfo | null;
  tabs: Tab[];
  activeTabId: string;
  profiles: Record<string, Profile>;
  link: LinkStatus;
  maxRows: number;
  maxResults: number;
  timeout: number;
  dialog: Dialog | null;
  palette: boolean;
  ready: boolean;
  /** JDBC URL of the default profile (from /api/config). */
  defaultUrl: string;
  macros: Macro[];
}

export const DEFAULT_PROFILE_ID = 'default';
export const DEFAULT_COLOR = '#d97706';
export const MAX_LOG = 5000;
const FETCH_CHUNK = 5000;

/** resultId -> send time of the open fetch. One fetch per result at a time; a lost answer frees it after 30 s. */
const fetching = new Map<string, number>();

function findResult(tabId: string, resultId: string) {
  return get().tabs.find((t) => t.id === tabId)?.results.find((r) => r.id === resultId);
}

/** Asks the server for the next rows of a result. The grid calls it near the end of the loaded rows. */
export function fetchMore(tabId: string, resultId: string) {
  const r = findResult(tabId, resultId);
  const since = fetching.get(resultId);
  if (!r || r.done || r.closed || (since && Date.now() - since < 30_000)) return;
  fetching.set(resultId, Date.now());
  client.send({ type: 'fetch', tabId, resultId, offset: r.rowCount, count: FETCH_CHUNK });
}

/** Fetches all remaining rows ("Fetch all", export, copy). */
export function fetchAll(tabId: string, resultId: string) {
  updateTab(tabId, (t) => ({ results: t.results.map((r) => (r.id === resultId ? { ...r, fetchAll: true } : r)) }));
  fetchMore(tabId, resultId);
}

// Passwords stay in memory only. Never persisted.
const passwords = new Map<string, string>();
export function setPassword(profileId: string, pw: string) { passwords.set(profileId, pw); }
export function hasPassword(profileId: string) { return passwords.has(profileId); }
/** For the load run only: it needs the password the user typed this session. */
export function getPassword(profileId: string) { return passwords.get(profileId); }

let seq = 0;
export function newId(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;
}

export function makeTab(title: string, profileId: string, sql = ''): Tab {
  return {
    id: newId('t'), title, sql, cursor: { line: 1, col: 1 }, profileId, conn: 'none',
    results: [], resultSeq: 0, messages: [], hiddenLines: 0, stats: [], activeResult: 'messages',
    split: 0.45, running: false, history: [], histPos: -1, filterOpen: false, filterText: '',
  };
}

export const useStore = create<State>(() => ({
  auth: 'checking',
  session: null,
  update: null,
  tabs: [],
  activeTabId: '',
  profiles: {},
  link: client.status,
  maxRows: 0,
  maxResults: 20,
  timeout: 0,
  dialog: null,
  palette: false,
  ready: false,
  defaultUrl: '',
  macros: [],
}));

const get = useStore.getState;
const set = useStore.setState;

export function activeTab(): Tab | undefined {
  const s = get();
  return s.tabs.find((t) => t.id === s.activeTabId);
}

export function updateTab(id: string, patch: Partial<Tab> | ((t: Tab) => Partial<Tab>)) {
  set((s) => ({
    tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)),
  }));
}

function trimLog(lines: LogLine[], hidden: number): { messages: LogLine[]; hiddenLines: number } {
  if (lines.length <= MAX_LOG) return { messages: lines, hiddenLines: hidden };
  const cut = lines.length - MAX_LOG;
  return { messages: lines.slice(cut), hiddenLines: hidden + cut };
}

export function log(tabId: string, level: LogLine['level'], text: string) {
  updateTab(tabId, (t) => trimLog([...t.messages, { level, text }], t.hiddenLines));
}

export function nextTabTitle(): string {
  const used = new Set(get().tabs.map((t) => t.title));
  let n = 1;
  while (used.has(`Statement ${n}`)) n++;
  return `Statement ${n}`;
}

// ---- Connections ----
const waiting = new Map<string, (ok: boolean) => void>();

function sendConnect(tab: Tab) {
  const p = get().profiles[tab.profileId];
  if (!p) return;
  updateTab(tab.id, { conn: 'connecting' });
  log(tab.id, 'info', `Connecting to ${p.name} as ${p.user}...`);
  const opts: ProfileOptions = {};
  for (const k of PROFILE_OPTION_KEYS) if (p[k] !== undefined && p[k] !== '') (opts as Record<string, unknown>)[k] = p[k];
  client.send({
    type: 'connect', tabId: tab.id,
    profile: {
      ...opts,
      name: p.name, url: p.url, user: p.user, password: passwords.get(p.id) ?? '',
      autocommit: p.autocommit, fetchSize: p.fetchSize, color: p.color,
      sysdba: p.sysdba || undefined, readOnly: p.readOnly || undefined,
    },
  });
}

// ---- Completion (Ctrl+Space) ----
const completionWaiters = new Map<string, (m: CompletionMsg | null) => void>();
client.subscribeAll((m) => {
  if (m.type !== 'completion') return;
  completionWaiters.get(m.reqId)?.(m);
  completionWaiters.delete(m.reqId);
});

/** The engine's completion list for the cursor position. Null when the tab is not connected or the server is slow (3 s). */
export function requestCompletion(tabId: string, sql: string, cursor: number): Promise<CompletionMsg | null> {
  if (get().tabs.find((t) => t.id === tabId)?.conn !== 'connected') return Promise.resolve(null);
  const reqId = newId('c');
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => { completionWaiters.delete(reqId); resolve(null); }, 3000);
    completionWaiters.set(reqId, (m) => { window.clearTimeout(timer); resolve(m); });
    client.send({ type: 'complete', tabId, reqId, sql, cursor });
  });
}

/** Connects the tab if needed. Asks for a password when none is in memory. */
export function ensureConnected(tabId: string): Promise<boolean> {
  const tab = get().tabs.find((t) => t.id === tabId);
  if (!tab) return Promise.resolve(false);
  if (tab.conn === 'connected') return Promise.resolve(true);
  return new Promise((resolve) => {
    const prev = waiting.get(tabId);
    waiting.set(tabId, (ok) => { prev?.(ok); resolve(ok); });
    if (tab.conn === 'connecting') return;
    if (hasPassword(tab.profileId)) sendConnect(tab);
    else set({ dialog: { kind: 'login', tabId } });
  });
}

/** Called by the connection login dialog. */
export function loginTab(tabId: string, user: string, password: string) {
  const tab = get().tabs.find((t) => t.id === tabId);
  if (!tab) return;
  set((s) => ({
    dialog: null,
    profiles: { ...s.profiles, [tab.profileId]: { ...s.profiles[tab.profileId], user } },
  }));
  setPassword(tab.profileId, password);
  sendConnect(get().tabs.find((t) => t.id === tabId)!);
}

export function cancelLogin(tabId: string) {
  set({ dialog: null });
  waiting.get(tabId)?.(false);
  waiting.delete(tabId);
}

/** New profile from the connect dialog: opens a NEW tab bound to it. */
export function connectNewProfile(p: Omit<Profile, 'id'> & { id?: string }, password: string) {
  // Saved profiles keep their id, so tabs of one profile share it.
  const id = p.id ?? newId('p');
  const profile: Profile = { ...p, id };
  setPassword(id, password);
  const tab = makeTab(nextTabTitle(), id);
  set((s) => ({ profiles: { ...s.profiles, [id]: profile }, tabs: [...s.tabs, tab], activeTabId: tab.id, dialog: null }));
  sendConnect(tab);
}

/** Opens a NEW tab bound to an existing profile and connects it (asks for a password when none is known). */
export function openTabFor(profileId: string) {
  const tab = makeTab(nextTabTitle(), profileId);
  set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id, dialog: null }));
  void ensureConnected(tab.id);
}

/**
 * Connect (no new tab): ALL statement tabs and DB Explorers switch to the profile.
 * The server closes each old connection first (open transaction: rollback). SQL text stays.
 * A running tab keeps its connection and logs a note. All tabs running: a new tab opens.
 * Only one DB Explorer stays open (a running one also stays).
 */
export function switchTabProfile(profileId: string) {
  const all = get().tabs;
  let targets = all.filter((t) => !t.running && !(t.profileId === profileId && t.conn === 'connected'));
  const busy = all.filter((t) => t.running && t.profileId !== profileId);
  if (!targets.length && !all.some((t) => !t.running)) { openTabFor(profileId); return; }
  const go = () => {
    set({ dialog: null });
    const name = get().profiles[profileId]?.name ?? profileId;
    busy.forEach((t) => log(t.id, 'warn', `Still running: this tab stays on its connection. Use Connect again for ${name}.`));
    const cur = activeTab();
    // One schema for all tabs = one DB Explorer. Keep the active one, else the one of the active tab, else the first.
    const explorers = get().tabs.filter((t) => t.kind === 'explorer' && !t.running);
    const keep = explorers.find((t) => t.id === cur?.id)
      ?? explorers.find((t) => t.sourceTabId === cur?.id) ?? explorers[0];
    explorers.forEach((t) => { if (t !== keep) closeTabNow(t.id); });
    targets = targets.filter((t) => t.kind !== 'explorer' || t === keep);
    if (!targets.length) return;
    // Main tab first (active tab when possible): it asks for the password once. The others connect after it.
    const main = targets.find((t) => t.id === cur?.id)
      ?? targets.find((t) => t.id === cur?.sourceTabId) ?? targets[0];
    void reconnectTab(main.id, profileId).then((ok) => {
      if (ok) targets.forEach((t) => { if (t.id !== main.id) void reconnectTab(t.id, profileId); });
    });
  };
  const open = targets.filter(uncommitted);
  if (!open.length) { go(); return; }
  set({
    dialog: {
      kind: 'confirm', title: 'Uncommitted changes', danger: true, okLabel: 'Roll back and switch',
      text: `${open.map((t) => `"${t.title}"`).join(', ')} ${open.length > 1 ? 'have' : 'has'} changes that are not committed. All tabs switch schema, so they are rolled back. Use Commit (Alt+M) first to keep them.`,
      onOk: go,
    },
  });
}

/** Connects one tab with another profile. A DB Explorer also drops its old data. */
export function reconnectTab(tabId: string, profileId: string): Promise<boolean> {
  const tab = get().tabs.find((t) => t.id === tabId);
  if (!tab) return Promise.resolve(false);
  if (tab.profileId === profileId && (tab.conn === 'connected' || tab.conn === 'connecting')) return ensureConnected(tabId);
  // No "disconnect" message: connect on the same server tab closes the old connection in order.
  const patch: Partial<Tab> = { profileId, conn: 'none', info: undefined };
  if (tab.kind === 'explorer') {
    tab.results.forEach((r) => dropRows(r.id));
    Object.assign(patch, { results: [], activeResult: 'messages' });
  }
  updateTab(tabId, patch);
  return ensureConnected(tabId);
}

export function addTab() {
  const cur = activeTab();
  const profileId = cur?.profileId ?? DEFAULT_PROFILE_ID;
  const tab = makeTab(nextTabTitle(), profileId);
  set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  if (hasPassword(profileId)) sendConnect(tab);
}

/** True when the profile has "Check uncommitted" and the tab has an open transaction. */
function uncommitted(tab: Tab): boolean {
  return !!tab.txOpen && tab.conn === 'connected' && !!get().profiles[tab.profileId]?.checkUncommitted;
}

/** Asks first when the tab has uncommitted changes. The server rolls back when it closes the connection. */
function askUncommitted(tab: Tab, what: string, go: () => void) {
  if (!uncommitted(tab)) { go(); return; }
  set({
    dialog: {
      kind: 'confirm', title: 'Uncommitted changes', danger: true, okLabel: `Roll back and ${what}`,
      text: `"${tab.title}" has changes that are not committed. They are rolled back if you ${what} now. Use Commit (Alt+M) first to keep them.`,
      onOk: go,
    },
  });
}

export function disconnectTab(id: string) {
  const tab = get().tabs.find((t) => t.id === id);
  if (tab) askUncommitted(tab, 'disconnect', () => client.send({ type: 'disconnect', tabId: id }));
}

export function closeTab(id: string) {
  const tab = get().tabs.find((t) => t.id === id);
  if (tab && get().tabs.length > 1) askUncommitted(tab, 'close the tab', () => closeTabNow(id));
}

function closeTabNow(id: string) {
  const s = get();
  if (s.tabs.length <= 1) return;
  const idx = s.tabs.findIndex((t) => t.id === id);
  const tab = s.tabs[idx];
  if (!tab) return;
  if (tab.conn === 'connected' || tab.conn === 'connecting') client.send({ type: 'disconnect', tabId: id });
  tab.results.forEach((r) => dropRows(r.id));
  editorBridge.current.disposeTab(id);
  const tabs = s.tabs.filter((t) => t.id !== id);
  const activeTabId = s.activeTabId === id ? tabs[Math.min(idx, tabs.length - 1)].id : s.activeTabId;
  set({ tabs, activeTabId });
}

export function selectTab(id: string) { set({ activeTabId: id }); }

/** Tabs grouped by profile (schema), in the order each profile first appears. The tab bar shows this order. */
export function groupTabs(tabs: Tab[]): { profileId: string; tabs: Tab[] }[] {
  const groups = new Map<string, Tab[]>();
  for (const t of tabs) {
    const g = groups.get(t.profileId);
    if (g) g.push(t); else groups.set(t.profileId, [t]);
  }
  return [...groups].map(([profileId, members]) => ({ profileId, tabs: members }));
}

export function cycleTab(dir: 1 | -1) {
  const s = get();
  const order = groupTabs(s.tabs).flatMap((g) => g.tabs);
  const i = order.findIndex((t) => t.id === s.activeTabId);
  const n = order.length;
  set({ activeTabId: order[(i + dir + n) % n].id });
}

export function moveTab(from: number, to: number) {
  set((s) => {
    const tabs = [...s.tabs];
    const [t] = tabs.splice(from, 1);
    tabs.splice(to, 0, t);
    return { tabs };
  });
}

// ---- Execute ----
export function execute(mode: ExecMode) {
  const tab = activeTab();
  if (!tab || tab.running || tab.kind === 'explorer') return Promise.resolve();
  const snap = editorBridge.current.snapshot(tab.id) ?? {
    sql: tab.sql, cursor: tab.sql.length, selStart: 0, selEnd: 0,
  };
  return executeIn(tab.id, mode, snap);
}

/** Run given SQL text (all statements) in a tab: macros, DB Explorer data. */
export function executeText(tabId: string, sql: string, maxRows?: number, internal = false) {
  return executeIn(tabId, 'all', { sql, cursor: 0, selStart: 0, selEnd: 0 }, maxRows, internal);
}

const WRITE_VERBS = ['insert', 'update', 'delete', 'merge', 'create', 'drop', 'alter', 'truncate', 'grant', 'revoke', 'rename', 'comment'];
const DML_VERBS = ['insert', 'update', 'delete', 'merge'];
const firstWord = (sql: string) => (sql.replace(/^(\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/))*/, '').trim().match(/^\w+/)?.[0] ?? '').toLowerCase();

/** The statements a run would execute (client-side split, for checks only). */
function statementsFor(mode: ExecMode, snap: { sql: string; cursor: number; selStart: number; selEnd: number }): string[] {
  if (mode === 'all') return splitStatements(snap.sql).map((s) => s.sql);
  if (mode === 'selected' && snap.selEnd > snap.selStart) return splitStatements(snap.sql.slice(snap.selStart, snap.selEnd)).map((s) => s.sql);
  const s = statementAt(snap.sql, snap.cursor);
  return s ? [s.sql] : [];
}

function confirmRun(title: string, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    set({ dialog: { kind: 'confirm', title, text, okLabel: 'Execute', onOk: () => resolve(true), onCancel: () => resolve(false) } });
  });
}

async function executeIn(
  tabId: string, mode: ExecMode, snap: { sql: string; cursor: number; selStart: number; selEnd: number },
  maxRowsOverride?: number, internal = false,
) {
  const tab = get().tabs.find((t) => t.id === tabId);
  if (!tab || tab.running) return;
  if (!snap.sql.trim()) return;
  const prof = get().profiles[tab.profileId];
  if (!internal && (prof?.readOnly || prof?.confirmUpdates || prof?.confirmNoWhere)) {
    const stmts = statementsFor(mode, snap);
    const verbs = stmts.map(firstWord);
    const blocked = verbs.find((v) => WRITE_VERBS.includes(v));
    if (prof.readOnly && blocked) {
      log(tab.id, 'error', `Profile "${prof.name}" is read-only: ${blocked.toUpperCase()} is not allowed.`);
      updateTab(tab.id, { activeResult: 'messages' });
      return;
    }
    const dml = verbs.filter((v) => DML_VERBS.includes(v)).length;
    if (prof.confirmUpdates && dml > 0
      && !(await confirmRun('Confirm updates', `This run changes data (${dml} DML statement${dml > 1 ? 's' : ''}). Continue?`))) return;
    const noWhere = stmts.filter((s, i) => (verbs[i] === 'update' || verbs[i] === 'delete') && !/\bwhere\b/i.test(s)).length;
    if (prof.confirmNoWhere && noWhere > 0
      && !(await confirmRun('UPDATE / DELETE without WHERE', `${noWhere} statement${noWhere > 1 ? 's change' : ' changes'} all rows of a table (no WHERE). Continue?`))) return;
  }
  if (!(await ensureConnected(tab.id))) return;
  const reqId = newId('r');
  const { maxResults } = get();
  const timeout = get().timeout || prof?.timeout || 0;
  const maxRows = maxRowsOverride ?? get().maxRows;
  tab.results.forEach((r) => dropRows(r.id));
  const sqlForHistory = mode === 'selected' && snap.selEnd > snap.selStart ? snap.sql.slice(snap.selStart, snap.selEnd) : snap.sql;
  updateTab(tab.id, (t) => {
    if (internal) return { running: true, reqId, lastMs: undefined };
    const history = t.history[t.history.length - 1] === sqlForHistory ? t.history : [...t.history, sqlForHistory].slice(-50);
    return {
      running: true, reqId, results: [], resultSeq: 0, messages: [], hiddenLines: 0, stats: [],
      activeResult: 'messages', lastMs: undefined, history, histPos: history.length - 1,
    };
  });
  client.send({
    type: 'execute', tabId: tab.id, reqId, sql: snap.sql, mode,
    cursor: snap.cursor, selStart: snap.selStart, selEnd: snap.selEnd, maxRows, maxResults, timeout,
  });
}

export function cancelExec() {
  const tab = activeTab();
  if (tab?.running) client.send({ type: 'cancel', tabId: tab.id });
}

const formatWaiters = new Map<string, (sql: string) => void>();
export function formatSql(tabId: string, sql: string): Promise<string> {
  const reqId = newId('f');
  return new Promise((resolve) => {
    formatWaiters.set(reqId, resolve);
    client.send({ type: 'format', tabId, reqId, sql });
  });
}

// ---- Server messages (batched per animation frame) ----
let pending: ServerMsg[] = [];
let flushScheduled = false;
const stmtSql = new Map<string, string>(); // `${tabId}:${index}` -> sql

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  // rAF stops in hidden tabs, so a timer is the fallback.
  const timer = window.setTimeout(flush, 250);
  requestAnimationFrame(() => { window.clearTimeout(timer); flush(); });
}

function flush() {
  if (!flushScheduled) return;
  flushScheduled = false;
  const msgs = pending;
  pending = [];
  if (msgs.length === 0) return;

  const s = get();
  const tabs = s.tabs.slice();
  const draft = new Map<string, Tab>();
  const cloned = new Set<string>(); // `${tabId}:messages|results|stats`
  const after: (() => void)[] = [];

  const T = (tabId: string): Tab | undefined => {
    let t = draft.get(tabId);
    if (t) return t;
    const i = tabs.findIndex((x) => x.id === tabId);
    if (i < 0) return undefined;
    t = { ...tabs[i] };
    tabs[i] = t;
    draft.set(tabId, t);
    return t;
  };
  const own = <K extends 'messages' | 'results' | 'stats'>(t: Tab, k: K): Tab[K] => {
    const key = `${t.id}:${k}`;
    if (!cloned.has(key)) {
      cloned.add(key);
      (t[k] as unknown[]) = (t[k] as unknown[]).slice();
    }
    return t[k];
  };
  const say = (t: Tab, level: LogLine['level'], text: string) => own(t, 'messages').push({ level, text });
  const res = (t: Tab, id: string): ResultSet | undefined => {
    const list = own(t, 'results');
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) return undefined;
    if (!cloned.has(`${t.id}:r:${id}`)) {
      cloned.add(`${t.id}:r:${id}`);
      list[i] = { ...list[i] };
    }
    return list[i];
  };

  for (const m of msgs) {
    if (m.type === 'pong' || m.type === 'metaResult' || m.type === 'saved' || m.type === 'completion') continue;
    let tabId = m.tabId;
    if (!tabId && (m.type === 'loadStats' || m.type === 'loadEnd')) {
      tabId = tabs.find((t) => t.load?.reqId === m.reqId)?.id;
    }
    if (!tabId) continue;
    const tab = T(tabId);
    if (!tab) continue;
    switch (m.type) {
      case 'loadStats':
      case 'loadEnd': {
        if (!tab.load || tab.load.reqId !== m.reqId) break;
        const st: LoadStats = {
          elapsedMs: m.elapsedMs, count: m.count, errors: m.errors, rps: m.rps,
          p50: m.p50, p95: m.p95, p99: m.p99, max: m.max, lastError: m.lastError,
        };
        const samples = [...tab.load.samples, st];
        tab.load = m.type === 'loadEnd'
          ? { ...tab.load, samples, running: false, end: { ...st, sessions: m.sessions } }
          : { ...tab.load, samples };
        break;
      }
      case 'txState':
        tab.txOpen = m.open;
        break;
      case 'connected':
        tab.conn = 'connected';
        tab.info = m.info;
        tab.txOpen = false;
        say(tab, 'info', `Connected to ${m.info.product} ${m.info.version} as ${m.info.user}${m.info.ms != null ? ` (${m.info.ms} ms)` : ''}`);
        after.push(() => { waiting.get(tab.id)?.(true); waiting.delete(tab.id); });
        break;
      case 'disconnected':
        tab.conn = 'none';
        tab.info = undefined;
        tab.running = false;
        tab.txOpen = false;
        say(tab, 'info', 'Disconnected');
        break;
      case 'error':
        say(tab, 'error', m.message);
        if (tab.conn === 'connecting') {
          tab.conn = 'error';
          passwords.delete(tab.profileId);
          after.push(() => { waiting.get(tab.id)?.(false); waiting.delete(tab.id); });
        }
        if (m.reqId) formatWaiters.delete(m.reqId);
        tab.activeResult = 'messages';
        break;
      case 'stmtStart':
        stmtSql.set(`${tab.id}:${m.index}`, m.sql);
        if (m.start != null) {
          const start = m.start;
          after.push(() => editorBridge.current.highlight(tab.id, start, m.sql.length));
        }
        break;
      case 'resultMeta': {
        const list = own(tab, 'results');
        tab.resultSeq += 1;
        list.push({
          id: m.resultId, title: `Result ${tab.resultSeq}`, sql: m.sql, columns: m.columns,
          rowCount: 0, total: -1, done: false, version: 0, table: singleTable(m.sql),
        });
        // Keep at most maxResults result tabs: drop the oldest.
        const cap = Math.max(1, s.maxResults || 20);
        while (list.length > cap) {
          const old = list.shift()!;
          dropRows(old.id);
          if (tab.activeResult === old.id) tab.activeResult = list[0].id;
        }
        if (tab.activeResult === 'messages' || !list.some((r) => r.id === tab.activeResult)) tab.activeResult = list[0].id;
        break;
      }
      case 'rows': {
        const r = res(tab, m.resultId);
        if (!r) break;
        const count = putRows(m.resultId, m.offset, m.rows);
        r.rowCount = count;
        r.done = m.done;
        r.version += 1;
        r.total = m.total != null && m.total >= 0 ? m.total : m.done ? count : r.total;
        fetching.delete(m.resultId);
        // More rows come only on scroll (fetchMore) or when the user asked for all rows.
        if (!m.done && !r.closed && r.fetchAll) after.push(() => fetchMore(tab.id, m.resultId));
        break;
      }
      case 'resultClosed': {
        const r = res(tab, m.resultId);
        if (r) { r.closed = true; r.done = true; }
        break;
      }
      case 'updateCount':
        break;
      case 'message':
        say(tab, m.level, m.text);
        break;
      case 'stmtEnd': {
        const key = `${tab.id}:${m.index}`;
        own(tab, 'stats').push({
          index: m.index, sql: stmtSql.get(key) ?? '', execMs: m.execMs ?? m.ms, fetchMs: m.fetchMs ?? 0,
          rows: m.rows ?? 0, error: !!m.error,
        });
        stmtSql.delete(key);
        if (m.error) tab.activeResult = 'messages';
        break;
      }
      case 'execEnd':
        after.push(() => editorBridge.current.clearHighlight(tab.id));
        tab.running = false;
        tab.lastMs = m.ms;
        if (!m.ok) tab.activeResult = 'messages';
        say(tab, m.ok ? 'info' : 'error', `Execution time: ${m.ms} ms${m.ok ? '' : ' (with errors)'}`);
        break;
      case 'formatted': {
        const w = formatWaiters.get(m.reqId);
        formatWaiters.delete(m.reqId);
        if (w) after.push(() => w(m.sql));
        break;
      }
    }
  }

  for (const t of draft.values()) {
    if (t.messages.length > MAX_LOG) Object.assign(t, trimLog(t.messages, t.hiddenLines));
  }
  set({ tabs });
  after.forEach((f) => f());
}

client.subscribeFrames((msgs) => {
  for (const m of msgs) pending.push(m);
  scheduleFlush();
});
client.onStatus((link) => set(link === 'auth' ? { link, auth: 'login' } : { link }));
