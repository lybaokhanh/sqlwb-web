// Pending grid edits per result set (editable single-table results).
// Original values stay in the row buffer; changes live here until saved.
import type { RowChange } from '../api/protocol';
import { rowsOf } from './rows';
import type { ResultSet } from './store';
import { updateTab, useStore } from './store';

export interface ResultEdits {
  /** row index -> column index -> new value */
  changed: Map<number, Map<number, unknown>>;
  deleted: Set<number>;
  inserted: Set<number>;
  /** Key columns for UPDATE/DELETE (from pk or the user). */
  keys?: string[];
}

const all = new Map<string, ResultEdits>();

export function editsOf(resultId: string): ResultEdits {
  let e = all.get(resultId);
  if (!e) all.set(resultId, (e = { changed: new Map(), deleted: new Set(), inserted: new Set() }));
  return e;
}

export function hasEdits(resultId: string): boolean {
  const e = all.get(resultId);
  return !!e && (e.changed.size > 0 || e.deleted.size > 0 || e.inserted.size > 0);
}

export function clearEdits(resultId: string) {
  const e = all.get(resultId);
  if (e) all.set(resultId, { changed: new Map(), deleted: new Set(), inserted: new Set(), keys: e.keys });
}

/** Re-render the grid after an edit. */
export function bump(tabId: string, resultId: string, patch: Partial<ResultSet> = {}) {
  updateTab(tabId, (t) => ({
    results: t.results.map((r) => (r.id === resultId ? { ...r, ...patch, version: r.version + 1 } : r)),
  }));
}

function findResult(tabId: string, resultId: string): ResultSet | undefined {
  return useStore.getState().tabs.find((t) => t.id === tabId)?.results.find((r) => r.id === resultId);
}

export function setCell(tabId: string, resultId: string, row: number, col: number, value: unknown) {
  const e = editsOf(resultId);
  const orig = rowsOf(resultId)[row]?.[col];
  let m = e.changed.get(row);
  if (!m) e.changed.set(row, (m = new Map()));
  if (!e.inserted.has(row) && sameValue(orig, value)) m.delete(col);
  else m.set(col, value);
  if (m.size === 0) e.changed.delete(row);
  bump(tabId, resultId);
}

function sameValue(a: unknown, b: unknown) {
  return (a == null && b == null) || String(a) === String(b);
}

export function insertRow(tabId: string, resultId: string, copyFrom?: number) {
  const r = findResult(tabId, resultId);
  if (!r) return;
  const rows = rowsOf(resultId);
  const idx = r.rowCount;
  const src = copyFrom != null ? rows[copyFrom] : undefined;
  const e = editsOf(resultId);
  rows[idx] = r.columns.map(() => null);
  const m = new Map<number, unknown>();
  r.columns.forEach((_, c) => {
    const v = src ? (e.changed.get(copyFrom!)?.get(c) ?? src[c]) : null;
    if (v != null) m.set(c, v);
  });
  e.inserted.add(idx);
  if (m.size) e.changed.set(idx, m);
  bump(tabId, resultId, { rowCount: idx + 1, sel: idx });
}

export function deleteRow(tabId: string, resultId: string, row: number) {
  const e = editsOf(resultId);
  if (e.inserted.has(row)) {
    // New row: just drop the edit (row stays empty and hidden as deleted).
    e.changed.delete(row);
  }
  if (e.deleted.has(row)) e.deleted.delete(row);
  else e.deleted.add(row);
  bump(tabId, resultId);
}

/** The value shown in the grid (changed value wins). */
export function cellValue(resultId: string, row: number, col: number): unknown {
  const ch = all.get(resultId)?.changed.get(row);
  if (ch && ch.has(col)) return ch.get(col);
  return rowsOf(resultId)[row]?.[col];
}

/** Builds the change list. Needs key columns for update/delete. */
export function buildChanges(r: ResultSet, keys: string[]): RowChange[] {
  const e = editsOf(r.id);
  const rows = rowsOf(r.id);
  const names = r.columns.map((c) => c.name);
  const keyOf = (row: number) => Object.fromEntries(keys.map((k) => [k, rows[row]?.[names.indexOf(k)] ?? null]));
  const out: RowChange[] = [];
  for (const row of [...e.deleted].sort((a, b) => a - b)) {
    if (!e.inserted.has(row)) out.push({ op: 'delete', key: keyOf(row) });
  }
  for (const [row, m] of [...e.changed.entries()].sort((a, b) => a[0] - b[0])) {
    if (e.deleted.has(row)) continue;
    const values = Object.fromEntries([...m.entries()].map(([c, v]) => [names[c], v]));
    if (e.inserted.has(row)) out.push({ op: 'insert', values });
    else out.push({ op: 'update', key: keyOf(row), values });
  }
  for (const row of e.inserted) {
    if (!e.changed.has(row) && !e.deleted.has(row)) out.push({ op: 'insert', values: {} });
  }
  return out;
}

export function sqlLiteral(v: unknown): string {
  if (v == null || v === '') return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Statements for the "Confirm updates" dialog (preview only; the server builds its own). */
export function previewSql(table: string, changes: RowChange[]): string {
  const where = (k: Record<string, unknown>) =>
    Object.entries(k).map(([c, v]) => (v == null ? `${c} IS NULL` : `${c} = ${sqlLiteral(v)}`)).join(' AND ');
  return changes.map((ch) => {
    if (ch.op === 'delete') return `DELETE FROM ${table} WHERE ${where(ch.key)};`;
    if (ch.op === 'insert') {
      const cols = Object.keys(ch.values);
      return cols.length
        ? `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => sqlLiteral(ch.values[c])).join(', ')});`
        : `INSERT INTO ${table} DEFAULT VALUES;`;
    }
    const set = Object.entries(ch.values).map(([c, v]) => `${c} = ${sqlLiteral(v)}`).join(', ');
    return `UPDATE ${table} SET ${set} WHERE ${where(ch.key)};`;
  }).join('\n');
}
