// Data export: CSV / TSV files, TSV to clipboard, SQL INSERT statements.
import { cellValue, sqlLiteral } from './edits';
import { fetchAll, fetchMore, useStore, type ResultSet } from './store';

export type ExportFormat = 'csv' | 'tsv' | 'sql';

function current(tabId: string, resultId: string): ResultSet | undefined {
  return useStore.getState().tabs.find((t) => t.id === tabId)?.results.find((r) => r.id === resultId);
}

/** Fetch all remaining rows first. Calls onProgress(loaded, total|-1). */
export async function loadAllRows(tabId: string, resultId: string, onProgress: (n: number, total: number) => void): Promise<ResultSet | undefined> {
  fetchAll(tabId, resultId);
  for (;;) {
    const r = current(tabId, resultId);
    if (!r) return undefined;
    onProgress(r.rowCount, r.total);
    if (r.done || r.closed) return r;
    fetchMore(tabId, resultId); // no-op while a fetch is open; restarts a lost one after 30 s
    await new Promise((res) => setTimeout(res, 250));
  }
}

const csvCell = (v: unknown) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const tsvCell = (v: unknown) => (v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' '));

export function buildText(r: ResultSet, fmt: ExportFormat): string {
  const names = r.columns.map((c) => c.name);
  const lines: string[] = [];
  if (fmt === 'sql') {
    const table = r.table ?? 'TABLE_NAME';
    for (let i = 0; i < r.rowCount; i++) {
      const vals = names.map((_, c) => sqlLiteral(cellValue(r.id, i, c)));
      lines.push(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${vals.join(', ')});`);
    }
    return lines.join('\n');
  }
  const cell = fmt === 'csv' ? csvCell : tsvCell;
  const sep = fmt === 'csv' ? ',' : '\t';
  lines.push(names.map(cell).join(sep));
  for (let i = 0; i < r.rowCount; i++) lines.push(names.map((_, c) => cell(cellValue(r.id, i, c))).join(sep));
  return lines.join(fmt === 'csv' ? '\r\n' : '\n');
}

export function download(text: string, fileName: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function fileBase(r: ResultSet): string {
  return (r.table ?? r.title).replace(/[^\w.-]+/g, '_');
}
