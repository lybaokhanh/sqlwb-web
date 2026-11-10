// Compare tab state, one session per statement tab. Row data lives here (not in the store);
// the store keeps only tab.compare.v, which bumps on each change so the panel redraws.
//
// Pending changes = working rows (A, B) against the last saved state (snapA, snapB).
// Save sends one saveChanges per side: the server runs it in one transaction and commits.
import type { ColumnInfo, RowChange } from '../api/protocol';
import { api } from '../api/rpc';
import { previewSql } from '../state/edits';
import { compareHooks, forgetPassword, getPassword, log, makeTab, setPassword, updateTab, useStore } from '../state/store';
import { editorBridge } from '../editor/bridge';
import { singleTable } from '../sql/table';
import { statementAt } from '../sql/split';
import {
  compareRows, DEFAULT_OPTIONS, matchKey, type CompareOptions, type EnvNames, type PairRow, type Status, type WRow,
} from './engine';
import { connectHidden, disconnectHidden, queryAll } from './hidden';

export type Side = 'A' | 'B';

export interface Stmt {
  side: Side;
  /** Working row id. */
  id: number;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  change: RowChange;
  sql: string;
  /** Match key of the row (for the row it belongs to). */
  mk: string;
  /** Short row label (first key value). */
  label: string;
}

export interface CompareSession {
  tabId: string;
  /** SQL of the last run (from the editor of the Compare tab). */
  sql: string;
  /** Table as written in the SQL (with schema or not); undefined when it is not a single-table SELECT. */
  table?: string;
  /** Table picked in the table list (it stays shown). */
  picked?: string;
  /** Table name without schema; undefined when the result is not a single-table SELECT. */
  name?: string;
  columns: ColumnInfo[];
  profileA: string;
  schemaA: string;
  profileB: string;
  schemaB: string;
  /** Sides whose connection changed: the schema list fills their schema from the profile name. */
  guess?: Set<Side>;
  /** Schemas per profile id (B picker). */
  schemas: Record<string, string[]>;
  keys: Set<number>;
  ignore: Set<number>;
  opts: CompareOptions;
  filter: Set<Status>;
  /** Primary key column indexes. Empty: editing is off. */
  pk: number[];
  state: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  /** Why editing is off (undefined: editing is on). */
  noEdit?: string;
  A: WRow[];
  B: WRow[];
  snapA: Map<number, unknown[]>;
  snapB: Map<number, unknown[]>;
  /** Labels of the sides at the last run. */
  ranA: string;
  ranB: string;
  ranSqlA: string;
  ranSqlB: string;
  ms: number;
  sel: Set<string>;
  msg?: { text: string; err?: boolean };
  saving: boolean;
  /** Last pairs (for the dialogs). */
  pairs: PairRow[];
  nextId: number;
  /** Data revision: each bump that can change rows, keys, ignore or options adds 1. */
  rev: number;
  /** Revisions of the cached pairs and pending statements. */
  pairsRev: number;
  stmtsRev: number;
  stmts: Stmt[];
}

const sessions = new Map<string, CompareSession>();

export const hiddenA = (tabId: string) => `${tabId}~cmpA`;
export const hiddenB = (tabId: string) => `${tabId}~cmpB`;

export function sessionOf(tabId: string): CompareSession | undefined {
  return sessions.get(tabId);
}

/**
 * Redraws the panel. view = true: only the view changed (selection, filter, picked table),
 * so the cached pairs and pending statements stay.
 */
export function bump(tabId: string, view = false) {
  const s = sessions.get(tabId);
  if (s && !view) s.rev++;
  updateTab(tabId, (t) => (t.compare ? { compare: { ...t.compare, v: t.compare.v + 1 } } : {}));
}

const clone = (v: unknown[]) => v.slice();
const same = (a: unknown, b: unknown) => (a == null && b == null) || (a != null && b != null && String(a) === String(b));

// ---- Remembered column choices per table (this browser) ----
const COLS_KEY = 'sqlwb.cmp.cols:';
function loadCols(name: string | undefined): { keys: string[]; ignore: string[] } | null {
  if (!name) return null;
  try {
    return JSON.parse(localStorage.getItem(COLS_KEY + name.toUpperCase()) ?? 'null');
  } catch {
    return null;
  }
}
function saveCols(s: CompareSession) {
  if (!s.name) return;
  const names = (set: Set<number>) => [...set].map((i) => s.columns[i].name);
  try {
    localStorage.setItem(COLS_KEY + s.name.toUpperCase(), JSON.stringify({ keys: names(s.keys), ignore: names(s.ignore) }));
  } catch {
    /* storage off */
  }
}

// ---- Remembered "equal when" options (this browser, all tables) ----
const OPTS_KEY = 'sqlwb.cmp.opts';
function loadOpts(): CompareOptions {
  try {
    const v = JSON.parse(localStorage.getItem(OPTS_KEY) ?? 'null');
    if (v && typeof v === 'object') {
      const out = { ...DEFAULT_OPTIONS };
      for (const k of Object.keys(DEFAULT_OPTIONS) as (keyof CompareOptions)[]) {
        if (typeof v[k] === typeof DEFAULT_OPTIONS[k]) (out as Record<string, unknown>)[k] = v[k];
      }
      return out;
    }
  } catch {
    /* storage off or bad value */
  }
  return { ...DEFAULT_OPTIONS };
}
function saveOpts(o: CompareOptions) {
  try { localStorage.setItem(OPTS_KEY, JSON.stringify(o)); } catch { /* storage off */ }
}

// ---- Remembered sources (this browser): the next Compare tab starts with the last A and B ----
const SRC_KEY = 'sqlwb.cmp.src';
interface Sources { profileA: string; schemaA: string; profileB: string; schemaB: string }
function loadSources(): Sources | null {
  try {
    const v = JSON.parse(localStorage.getItem(SRC_KEY) ?? 'null');
    return v && typeof v.profileA === 'string' && typeof v.profileB === 'string' ? v : null;
  } catch {
    return null;
  }
}
function saveSources(s: CompareSession) {
  const v: Sources = { profileA: s.profileA, schemaA: s.schemaA, profileB: s.profileB, schemaB: s.schemaB };
  try { localStorage.setItem(SRC_KEY, JSON.stringify(v)); } catch { /* storage off */ }
}

/** Schema lists per profile id, shared by all Compare tabs (a new tab does not load them again). */
const schemaCache = new Map<string, string[]>();
/** Table lists per "profile|schema", shared by all Compare tabs. */
export const tableCache = new Map<string, string[]>();

// ---- SQL text ----
const unquote = (s: string) => s.replace(/"/g, '');
function splitTable(table: string): [string | undefined, string] {
  const parts = table.split('.');
  return parts.length > 1 ? [unquote(parts[0]), unquote(parts[1])] : [undefined, unquote(table)];
}

/** The result SQL with its table in another schema. */
export function retarget(sql: string, table: string | undefined, schema: string, name: string | undefined): string {
  const body = sql.trim().replace(/;\s*$/, '');
  if (!table || !name || !schema) return body;
  const esc = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body.replace(new RegExp(`(\\bfrom\\s+)${esc}(?![\\w$#"])`, 'i'), `$1${schema}.${name}`);
}

function profileName(id: string) {
  return useStore.getState().profiles[id]?.name ?? id;
}

export function sideLabel(s: CompareSession, side: Side) {
  return side === 'A' ? `${profileName(s.profileA)} · ${s.schemaA}` : `${profileName(s.profileB)} · ${s.schemaB}`;
}

export function readOnlySide(s: CompareSession, side: Side): boolean {
  return !!useStore.getState().profiles[side === 'A' ? s.profileA : s.profileB]?.readOnly;
}

// ---- Open / close ----

function newSession(tabId: string, profileId: string, schema: string): CompareSession {
  return {
    tabId, sql: '', columns: [],
    profileA: profileId, schemaA: schema, profileB: profileId, schemaB: '', guess: new Set<Side>(['A', 'B']),
    schemas: {}, keys: new Set(), ignore: new Set(), opts: loadOpts(),
    filter: new Set<Status>(['chg', 'add', 'del']), pk: [], state: 'idle', A: [], B: [],
    snapA: new Map(), snapB: new Map(), ranA: '', ranB: '', ranSqlA: '', ranSqlB: '', ms: 0, sel: new Set(),
    saving: false, pairs: [], nextId: 1, rev: 1, pairsRev: 0, stmtsRev: 0, stmts: [],
  };
}

export function hasPw(profileId: string) {
  return getPassword(profileId) != null;
}

/**
 * Opens a new Compare tab (menu Tools > Compare data). A starts as the connection and schema of the active tab.
 * The user picks A and B from the connection profiles and types the SQL in the editor of the Compare tab.
 */
export function openCompareTab() {
  const st = useStore.getState();
  const cur = st.tabs.find((t) => t.id === st.activeTabId);
  const profileId = cur?.profileId ?? Object.keys(st.profiles)[0];
  if (!profileId) return;
  const n = st.tabs.filter((t) => t.kind === 'compare').length;
  const tab = {
    ...makeTab(n ? `Compare ${n + 1}` : 'Compare', profileId),
    kind: 'compare' as const, compare: { v: 0 }, activeResult: 'compare', split: 0.3,
  };
  const schema = cur && cur.kind !== 'compare' ? cur.info?.schema ?? '' : '';
  const s = newSession(tab.id, profileId, schema.toUpperCase());
  const last = loadSources();
  if (last && st.profiles[last.profileA] && st.profiles[last.profileB]) {
    s.profileA = last.profileA;
    s.schemaA = last.schemaA ?? '';
    s.profileB = last.profileB;
    s.schemaB = last.schemaB ?? '';
    s.guess = new Set<Side>([...(s.schemaA ? [] : ['A' as Side]), ...(s.schemaB ? [] : ['B' as Side])]);
  }
  sessions.set(tab.id, s);
  useStore.setState({ tabs: [...st.tabs, tab], activeTabId: tab.id });
  for (const id of new Set([s.profileA, s.profileB])) if (hasPw(id)) void loadSchemas(s, id);
}

/** The Compare tab closes: drop the session and the hidden connections. */
export function dropCompare(tabId: string) {
  sessions.delete(tabId);
  disconnectHidden(hiddenA(tabId));
  disconnectHidden(hiddenB(tabId));
}

/** Password for a profile with none in memory yet. The connect check is the schema list. */
export async function loginProfile(tabId: string, profileId: string, password: string): Promise<boolean> {
  const s = sessions.get(tabId);
  if (!s) return false;
  setPassword(profileId, password);
  const copy = { ...s.schemas };
  delete copy[profileId];
  s.schemas = copy;
  schemaCache.delete(profileId);
  disconnectHidden(hiddenA(tabId));
  disconnectHidden(hiddenB(tabId));
  s.msg = undefined;
  await loadSchemas(s, profileId);
  if (s.schemas[profileId]) return true;
  // Wrong password or no connection: ask again.
  forgetPassword(profileId);
  bump(tabId);
  return false;
}

compareHooks.run = (tabId) => void runFromEditor(tabId);
compareHooks.pending = (tabId) => { const x = sessions.get(tabId); return x ? pending(x).length : 0; };
compareHooks.drop = dropCompare;

/** The other schema with the longest shared prefix (SHOP_DEV -> SHOP_TEST), else ''. */
function nearest(list: string[], schema: string): string {
  let best = '';
  let bestLen = 0;
  for (const x of list) {
    const u = x.toUpperCase();
    if (u === schema) continue;
    let n = 0;
    while (n < u.length && u[n] === schema[n]) n++;
    if (n > bestLen) { best = x; bestLen = n; }
  }
  return best;
}

const norm = (x: string) => x.trim().toUpperCase().replace(/[\s.-]+/g, '_').replace(/[^A-Z0-9_$#]/g, '');

/**
 * The schema with the name of the connection profile (users name a profile after its schema), else the schema
 * of the login user, else ''. Case does not count; a space, dash or dot counts as "_" (shop-uat = SHOP_UAT).
 */
export function schemaFor(profileId: string, list: string[]): string {
  const p = useStore.getState().profiles[profileId];
  if (!p) return '';
  for (const want of [norm(p.name), norm(p.user ?? '')]) {
    const hit = want && list.find((x) => norm(x) === want);
    if (hit) return hit;
  }
  return '';
}

/** Fills an empty schema of A or B from the profile name, when the schema list of the profile is known. */
function guessSchemas(s: CompareSession) {
  const want = s.guess ?? new Set<Side>();
  const listA = s.schemas[s.profileA];
  if (listA && want.has('A')) {
    want.delete('A');
    if (!s.schemaA) s.schemaA = schemaFor(s.profileA, listA);
  }
  const listB = s.schemas[s.profileB];
  if (listB && want.has('B')) want.delete('B');
  if (listB && !s.schemaB) {
    const g = schemaFor(s.profileB, listB);
    // Same profile and the same schema as A is no compare: take the nearest other schema.
    if (g && !(s.profileB === s.profileA && g.toUpperCase() === s.schemaA.toUpperCase())) s.schemaB = g;
    else s.schemaB = s.profileB === s.profileA ? nearest(listB, s.schemaA) : (listB.find((x) => x.toUpperCase() === s.schemaA) ?? nearest(listB, s.schemaA));
  }
}

async function loadSchemas(s: CompareSession, profileId: string) {
  if (s.schemas[profileId]) { guessSchemas(s); return; }
  const known = schemaCache.get(profileId);
  if (known) {
    // Known from another Compare tab: no connect and no round trip.
    s.schemas = { ...s.schemas, [profileId]: known };
    guessSchemas(s);
    bump(s.tabId);
    return;
  }
  const conn = profileId === s.profileA ? hiddenA(s.tabId) : hiddenB(s.tabId);
  try {
    await connectHidden(conn, profileId);
    const list = await api.schemas(conn);
    schemaCache.set(profileId, list);
    s.schemas = { ...s.schemas, [profileId]: list };
    guessSchemas(s);
    saveSources(s);
  } catch (e) {
    s.msg = { err: true, text: (e as Error).message };
  }
  bump(s.tabId);
}

/** Changes A (connection and schema). By default A is the connection and schema of the result. */
export function setSourceA(tabId: string, profileId: string, schema: string) {
  const s = sessions.get(tabId);
  if (!s) return;
  if ((profileId !== s.profileA || schema !== s.schemaA) && pending(s).some((x) => x.side === 'A')) {
    s.msg = { err: true, text: 'Save or discard the pending changes in A first.' };
    bump(tabId);
    return;
  }
  if (s.profileA !== profileId) {
    // The hidden A connection opens again for the new profile on the next run.
    disconnectHidden(hiddenA(tabId));
    s.profileA = profileId;
    s.schemaA = schema;
    (s.guess ??= new Set()).add('A');
    if (hasPw(profileId)) void loadSchemas(s, profileId);
  } else {
    s.schemaA = schema;
  }
  saveSources(s);
  bump(tabId);
}

export function setSourceB(tabId: string, profileId: string, schema: string) {
  const s = sessions.get(tabId);
  if (!s) return;
  if (s.profileB !== profileId) {
    if (pending(s).some((x) => x.side === 'B')) {
      s.msg = { err: true, text: 'Save or discard the pending changes in B first.' };
      bump(tabId);
      return;
    }
    s.profileB = profileId;
    s.schemaB = schema;
    (s.guess ??= new Set()).add('B');
    disconnectHidden(hiddenB(tabId));
    if (hasPw(profileId)) void loadSchemas(s, profileId);
  } else {
    if (pending(s).some((x) => x.side === 'B') && schema !== s.schemaB) {
      s.msg = { err: true, text: 'Save or discard the pending changes in B first.' };
      bump(tabId);
      return;
    }
    s.schemaB = schema;
  }
  saveSources(s);
  bump(tabId);
}

// ---- Run ----
let runSeq = 0;

/** The SQL to run: the selection, else the statement at the cursor. */
function editorSql(tabId: string): string {
  const tab = useStore.getState().tabs.find((t) => t.id === tabId);
  const snap = editorBridge.current.snapshot(tabId) ?? { sql: tab?.sql ?? '', cursor: 0, selStart: 0, selEnd: 0 };
  if (snap.selEnd > snap.selStart) return snap.sql.slice(snap.selStart, snap.selEnd).trim();
  return (statementAt(snap.sql, snap.cursor)?.sql ?? snap.sql).trim();
}

/** Runs the SQL of the editor (Ctrl+Enter or the Compare button). */
export function runFromEditor(tabId: string) {
  if (!sessions.get(tabId)) return Promise.resolve();
  return runCompare(tabId, editorSql(tabId));
}

const LEAD = /^(\s+|--[^\n]*(\n|$)|\/\*[\s\S]*?\*\/)*/;

/** Runs the query on A and on B, then compares. Pending changes block a new run. */
export async function runCompare(tabId: string, sql?: string) {
  const s = sessions.get(tabId);
  if (!s || s.state === 'loading') return;
  const text = (sql ?? s.sql).trim().replace(/;\s*$/, '');
  if (!text) {
    s.msg = { err: true, text: 'Type a SELECT in the editor above, or pick a table. Then click Compare.' };
    bump(tabId);
    return;
  }
  if (!/^(select|with)\b/i.test(text.replace(LEAD, ''))) {
    s.msg = { err: true, text: 'Compare runs a SELECT only.' };
    bump(tabId);
    return;
  }
  if (!hasPw(s.profileA) || !hasPw(s.profileB)) {
    s.msg = { err: true, text: `Log in to ${!hasPw(s.profileA) ? 'A' : 'B'} first: type the password below the connection.` };
    bump(tabId);
    return;
  }
  if (pending(s).length) {
    s.msg = { err: true, text: 'Save or discard the pending changes first. A new run reads the rows again.' };
    bump(tabId);
    return;
  }
  if (!s.schemaB) {
    s.msg = { err: true, text: 'Pick the schema of B.' };
    bump(tabId);
    return;
  }
  const my = ++runSeq;
  if (text !== s.sql) {
    s.sql = text;
    s.table = singleTable(text);
    s.name = s.table ? splitTable(s.table)[1] : undefined;
  }
  const table = s.table;
  const sqlA = retarget(s.sql, table, s.schemaA, s.name);
  const sqlB = retarget(s.sql, table, s.schemaB, s.name);
  s.state = 'loading';
  s.msg = undefined;
  s.error = undefined;
  bump(tabId);
  const t0 = performance.now();
  try {
    await Promise.all([connectHidden(hiddenA(tabId), s.profileA), connectHidden(hiddenB(tabId), s.profileB)]);
    const [ra, rb, pk] = await Promise.all([
      queryAll(hiddenA(tabId), sqlA),
      queryAll(hiddenB(tabId), sqlB),
      s.name ? api.pk(hiddenA(tabId), s.schemaA || undefined, s.name).catch(() => [] as string[]) : Promise.resolve([] as string[]),
    ]);
    if (my !== runSeq || sessions.get(tabId) !== s) return;
    const upper = ra.columns.map((c) => c.name.toUpperCase());
    const sameCols = s.columns.length === upper.length && s.columns.every((c, i) => c.name.toUpperCase() === upper[i]);
    s.columns = ra.columns;
    if (!sameCols) {
      // Other columns: the key and ignore choices start again from the ones kept for this table.
      s.keys.clear();
      s.ignore.clear();
      const remembered = loadCols(s.name);
      if (remembered) {
        const idx = (n: string) => upper.indexOf(n.toUpperCase());
        remembered.keys.map(idx).filter((i) => i >= 0).forEach((i) => s.keys.add(i));
        remembered.ignore.map(idx).filter((i) => i >= 0).forEach((i) => s.ignore.add(i));
      }
    }
    const mapB = upper.map((n) => rb.columns.findIndex((c) => c.name.toUpperCase() === n));
    const missing = upper.filter((_, i) => mapB[i] < 0);
    s.nextId = 1;
    s.A = ra.rows.map((v) => ({ id: s.nextId++, v: v.slice() }));
    s.B = rb.rows.map((v) => ({ id: s.nextId++, v: mapB.map((j) => (j < 0 ? null : v[j])) }));
    s.snapA = new Map(s.A.map((r) => [r.id, clone(r.v)]));
    s.snapB = new Map(s.B.map((r) => [r.id, clone(r.v)]));
    s.pk = pk.map((k) => upper.indexOf(k.toUpperCase())).filter((i) => i >= 0);
    if (s.pk.length !== pk.length) s.pk = [];
    if (!s.keys.size) (s.pk.length ? s.pk : [0]).forEach((i) => s.keys.add(i));
    s.noEdit = !s.name ? 'Editing needs a single-table SELECT.'
      : !s.pk.length ? `Editing needs a primary key on ${s.name}. The statements find rows by it.`
        : missing.length ? `B has no column ${missing.join(', ')}. Editing is off.` : undefined;
    s.ranA = sideLabel(s, 'A');
    s.ranB = sideLabel(s, 'B');
    s.ranSqlA = sqlA;
    s.ranSqlB = sqlB;
    s.ms = Math.round(performance.now() - t0);
    s.sel.clear();
    s.state = 'ready';
    if (missing.length) s.msg = { err: true, text: `B has no column ${missing.join(', ')}.` };
  } catch (e) {
    if (my !== runSeq) return;
    s.state = 'error';
    s.error = (e as Error).message;
    // A lost connection opens again on the next run.
    disconnectHidden(hiddenA(tabId));
    disconnectHidden(hiddenB(tabId));
  }
  bump(tabId);
}

// ---- Compare ----
export function envNames(s: CompareSession): EnvNames {
  return { a: s.schemaA, b: s.schemaB };
}

/** Pairs of the current rows. Cached until the next data bump: a selection or filter click does not compare again. */
export function pairsOf(s: CompareSession): PairRow[] {
  if (s.pairsRev === s.rev) return s.pairs;
  s.pairsRev = s.rev;
  if (!s.keys.size || s.state !== 'ready') return (s.pairs = []);
  s.pairs = compareRows(s.A, s.B, [...s.keys].sort((x, y) => x - y), s.ignore, s.opts, envNames(s));
  return s.pairs;
}

export function toggleCol(tabId: string, what: 'keys' | 'ignore', col: number) {
  const s = sessions.get(tabId);
  if (!s) return;
  const set = s[what];
  if (set.has(col)) set.delete(col); else set.add(col);
  saveCols(s);
  bump(tabId);
}

export function setOption<K extends keyof CompareOptions>(tabId: string, k: K, v: CompareOptions[K]) {
  const s = sessions.get(tabId);
  if (!s) return;
  s.opts = { ...s.opts, [k]: v };
  saveOpts(s.opts);
  bump(tabId);
}

export function toggleFilter(tabId: string, st: Status) {
  const s = sessions.get(tabId);
  if (!s) return;
  if (s.filter.has(st)) s.filter.delete(st); else s.filter.add(st);
  bump(tabId, true);
}

// ---- Pending changes ----
function sideRows(s: CompareSession, side: Side): [WRow[], Map<number, unknown[]>] {
  return side === 'A' ? [s.A, s.snapA] : [s.B, s.snapB];
}

function keyLabel(s: CompareSession, v: unknown[]): string {
  const k = [...s.keys].sort((x, y) => x - y);
  return k.map((i) => String(v[i] ?? 'NULL')).join(', ');
}

export function tableOf(s: CompareSession, side: Side): string {
  const schema = side === 'A' ? s.schemaA : s.schemaB;
  return schema ? `${schema}.${s.name ?? ''}` : s.name ?? '';
}

/** Statements: deletes, updates, inserts per side (in that order). */
export function pending(s: CompareSession): Stmt[] {
  if (s.stmtsRev === s.rev) return s.stmts;
  s.stmtsRev = s.rev;
  return (s.stmts = buildPending(s));
}

function buildPending(s: CompareSession): Stmt[] {
  if (s.state !== 'ready' || s.noEdit) return [];
  const out: Stmt[] = [];
  const names = s.columns.map((c) => c.name);
  const keyIdx = [...s.keys].sort((x, y) => x - y);
  for (const side of ['A', 'B'] as Side[]) {
    const [cur, snap] = sideRows(s, side);
    const table = tableOf(s, side);
    const curIds = new Map(cur.map((r) => [r.id, r]));
    const pkOf = (v: unknown[]) => Object.fromEntries(s.pk.map((i) => [names[i], v[i] ?? null]));
    const add = (id: number, op: Stmt['op'], change: RowChange, v: unknown[]) =>
      out.push({ side, id, op, change, sql: previewSql(table, [change]), mk: matchKey(v, keyIdx), label: keyLabel(s, v) });
    for (const [id, old] of snap) if (!curIds.has(id)) add(id, 'DELETE', { op: 'delete', key: pkOf(old) }, old);
    for (const r of cur) {
      const old = snap.get(r.id);
      if (!old) continue;
      const values: Record<string, unknown> = {};
      r.v.forEach((x, i) => { if (!same(x, old[i])) values[names[i]] = x; });
      if (Object.keys(values).length) add(r.id, 'UPDATE', { op: 'update', key: pkOf(old), values }, r.v);
    }
    for (const r of cur) {
      if (snap.has(r.id)) continue;
      const values: Record<string, unknown> = {};
      r.v.forEach((x, i) => { if (x != null) values[names[i]] = x; });
      add(r.id, 'INSERT', { op: 'insert', values }, r.v);
    }
  }
  return out;
}

/** Statements of one grid row: its A and B rows, plus deletes with the same match key. */
export function rowStmts(p: PairRow, all: Stmt[]): Stmt[] {
  return all.filter((x) => (x.side === 'A' ? p.a?.id === x.id : p.b?.id === x.id) || (x.op === 'DELETE' && x.mk === p.mk));
}

function revertId(s: CompareSession, side: Side, id: number) {
  const [cur, snap] = sideRows(s, side);
  const old = snap.get(id);
  const i = cur.findIndex((r) => r.id === id);
  if (!old) { if (i >= 0) cur.splice(i, 1); return; }
  if (i >= 0) cur[i] = { id, v: clone(old) };
  else { cur.push({ id, v: clone(old) }); cur.sort((x, y) => x.id - y.id); }
}

export function revertStmt(tabId: string, side: Side, id: number) {
  const s = sessions.get(tabId);
  if (!s) return;
  revertId(s, side, id);
  s.msg = { text: 'Reverted 1 change.' };
  bump(tabId);
}

export function revertCell(tabId: string, side: Side, id: number, col: number) {
  const s = sessions.get(tabId);
  if (!s) return;
  const [cur, snap] = sideRows(s, side);
  const r = cur.find((x) => x.id === id);
  const old = snap.get(id);
  if (r && old) r.v[col] = old[col];
  bump(tabId);
}

export function discardAll(tabId: string) {
  const s = sessions.get(tabId);
  if (!s) return;
  s.A = [...s.snapA].map(([id, v]) => ({ id, v: clone(v) }));
  s.B = [...s.snapB].map(([id, v]) => ({ id, v: clone(v) }));
  s.msg = { text: 'Discarded all pending changes.' };
  bump(tabId);
}

export type Act = 'rev' | 'toB' | 'toA' | 'delA' | 'delB';

/** True when the action is allowed for the row (side not read-only, editing on). */
export function canAct(s: CompareSession, p: PairRow, act: Act): boolean {
  if (s.noEdit) return false;
  if (act === 'rev') return true;
  const target: Side = act === 'toB' || act === 'delB' ? 'B' : 'A';
  if (readOnlySide(s, target)) return false;
  if (act === 'toB') return !!p.a && p.st !== 'same';
  if (act === 'toA') return !!p.b && p.st !== 'same';
  if (act === 'delA') return !!p.a;
  return !!p.b;
}

function freePk(s: CompareSession, side: Side, v: unknown[]): unknown[] {
  const [cur, snap] = sideRows(s, side);
  const n = v.slice();
  const keyOf = (x: unknown[]) => s.pk.map((i) => String(x[i])).join('\u0001');
  const used = new Set([...cur.map((r) => keyOf(r.v)), ...[...snap.values()].map(keyOf)]);
  if (!used.has(keyOf(n))) return n;
  // Taken: a single numeric key gets max + 1. Else the copy keeps it and the database tells.
  if (s.pk.length === 1) {
    const i = s.pk[0];
    const nums = [...cur.map((r) => r.v[i]), ...[...snap.values()].map((x) => x[i])].map(Number).filter((x) => Number.isFinite(x));
    if (nums.length && Number.isFinite(Number(n[i]))) n[i] = Math.max(...nums) + 1;
  }
  return n;
}

export function doAct(s: CompareSession, p: PairRow, act: Act) {
  if (!canAct(s, p, act)) return;
  // Rows change below: the next pairsOf / pending computes again (also inside a bulk loop).
  s.rev++;
  if (act === 'rev') {
    rowStmts(p, pending(s)).forEach((x) => revertId(s, x.side, x.id));
    s.msg = { text: `Reverted ${keyLabel(s, (p.a ?? p.b)!.v)}.` };
    return;
  }
  s.msg = undefined;
  if (act === 'toB' || act === 'toA') {
    const toB = act === 'toB';
    const src = toB ? p.a : p.b;
    const dst = toB ? p.b : p.a;
    if (!src) return;
    if (dst) {
      // Changed row: copy the compared columns. Key, ignored and primary key columns stay.
      src.v.forEach((x, i) => { if (!s.keys.has(i) && !s.ignore.has(i) && !s.pk.includes(i)) dst.v[i] = x; });
    } else {
      (toB ? s.B : s.A).push({ id: s.nextId++, v: freePk(s, toB ? 'B' : 'A', src.v) });
    }
    return;
  }
  const side: Side = act === 'delA' ? 'A' : 'B';
  const row = side === 'A' ? p.a : p.b;
  const list = side === 'A' ? s.A : s.B;
  const i = row ? list.indexOf(row) : -1;
  if (i >= 0) list.splice(i, 1);
}

export function rowAction(tabId: string, p: PairRow, act: Act) {
  const s = sessions.get(tabId);
  if (!s) return;
  doAct(s, p, act);
  bump(tabId);
}

export function bulkAction(tabId: string, act: Act) {
  const s = sessions.get(tabId);
  if (!s) return;
  const chosen = s.pairs.filter((p) => s.sel.has(p.k));
  chosen.forEach((p) => doAct(s, p, act));
  s.sel.clear();
  bump(tabId);
}

/** Edit dialog Apply: new text for the cells of A and B (undefined = no change). */
export function applyCell(tabId: string, p: PairRow, col: number, a: string | undefined, b: string | undefined) {
  const s = sessions.get(tabId);
  if (!s || s.pk.includes(col)) return;
  if (a !== undefined && p.a && !readOnlySide(s, 'A')) p.a.v[col] = a;
  if (b !== undefined && p.b && !readOnlySide(s, 'B')) p.b.v[col] = b;
  s.msg = undefined;
  bump(tabId);
}

export function snapValue(s: CompareSession, side: Side, id: number, col: number): { known: boolean; v?: unknown } {
  const old = (side === 'A' ? s.snapA : s.snapB).get(id);
  return old ? { known: true, v: old[col] } : { known: false };
}

// ---- Save ----
export async function saveAll(tabId: string): Promise<boolean> {
  const s = sessions.get(tabId);
  if (!s || s.saving) return false;
  const all = pending(s);
  if (!all.length) return true;
  s.saving = true;
  bump(tabId);
  let ok = true;
  for (const side of ['A', 'B'] as Side[]) {
    const list = all.filter((x) => x.side === side);
    if (!list.length) continue;
    if (readOnlySide(s, side)) {
      s.msg = { err: true, text: `${sideLabel(s, side)} is read-only. Nothing saved there.` };
      ok = false;
      break;
    }
    const conn = side === 'A' ? hiddenA(tabId) : hiddenB(tabId);
    const table = tableOf(s, side);
    try {
      await connectHidden(conn, side === 'A' ? s.profileA : s.profileB);
      const n = await api.saveChanges(conn, table, list.map((x) => x.change));
      const [cur, snap] = sideRows(s, side);
      snap.clear();
      cur.forEach((r) => snap.set(r.id, clone(r.v)));
      log(tabId, 'info', `Compare: ${n} row(s) saved to ${table} and committed.`);
    } catch (e) {
      s.msg = { err: true, text: `${table}: ${(e as Error).message} That transaction rolled back.` };
      log(tabId, 'error', `Compare: save to ${table} failed: ${(e as Error).message}`);
      ok = false;
      break;
    }
  }
  if (ok) s.msg = { text: `Saved ${all.length} statement${all.length > 1 ? 's' : ''}. Committed.` };
  s.saving = false;
  bump(tabId);
  return ok;
}

// ---- Compare SQL (FULL OUTER JOIN form) ----
export function compareSql(s: CompareSession, product: string): string {
  const k = [...s.keys].sort((x, y) => x - y).map((i) => s.columns[i]?.name).filter(Boolean) as string[];
  const cmp = s.columns.map((c, i) => (s.keys.has(i) || s.ignore.has(i) ? null : c.name)).filter(Boolean) as string[];
  const sqlA = s.ranSqlA || retarget(s.sql, s.table, s.schemaA, s.name);
  const sqlB = s.ranSqlB || retarget(s.sql, s.table, s.schemaB, s.name);
  if (s.profileA !== s.profileB) {
    return `-- B is another connection (${profileName(s.profileB)}). One SQL statement cannot read both.\n`
      + `-- The Compare tab runs the two queries and compares the rows in memory.\n\n-- A: ${profileName(s.profileA)}\n${sqlA};\n\n-- B: ${profileName(s.profileB)}\n${sqlB};\n`;
  }
  if (!k.length) return '-- Pick at least one column in "Match rows by".';
  const oracle = /oracle/i.test(product);
  const wrap = (x: string) => {
    let e = x;
    if (s.opts.trim) e = `trim(${e})`;
    if (s.opts.kase) e = `lower(${e})`;
    return e;
  };
  const differs = (c: string) => {
    const a = wrap(`a.${c}`);
    const b = wrap(`b.${c}`);
    return oracle ? `decode(${a}, ${b}, 1, 0) = 0` : `not (${a} = ${b} or (${a} is null and ${b} is null))`;
  };
  const indent = (x: string) => x.split('\n').join('\n         ');
  return `with a as (${indent(sqlA)}),\n     b as (${indent(sqlB)})\n`
    + `select case when a.${k[0]} is null then '+'\n            when b.${k[0]} is null then '-'\n            else '~' end as st,\n`
    + `       ${k.map((c) => `coalesce(a.${c}, b.${c}) ${c}`).join(', ')}${cmp.length ? ',' : ''}\n`
    + cmp.map((c) => `       a.${c} a_${c}, b.${c} b_${c}`).join(',\n') + (cmp.length ? '\n' : '')
    + `  from a full outer join b on ${k.map((c) => `a.${c} = b.${c}`).join(' and ')}\n`
    + ` where a.${k[0]} is null or b.${k[0]} is null${cmp.map((c) => `\n    or ${differs(c)}`).join('')};\n`
    + (oracle ? `\n-- JSON in Oracle 18c+: use  not json_equal(a.col, b.col)\n--   (key order and spaces do not count; array order counts).\n-- XML: Oracle has no simple "equal" for XMLType. The Compare tab\n--   parses both values and compares them by path.\n` : '');
}
