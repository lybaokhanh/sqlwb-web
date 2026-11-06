// "Statistics" tab: one row per statement, plus a summary per distinct SQL.
import { useMemo } from 'react';
import type { StmtStat } from '../state/store';

const SHOW_MAX = 2000;

interface Summary { sql: string; count: number; min: number; avg: number; p95: number; max: number; errors: number }

function summarize(stats: StmtStat[]): Summary[] {
  const by = new Map<string, StmtStat[]>();
  for (const s of stats) {
    const k = s.sql.trim();
    let l = by.get(k);
    if (!l) by.set(k, (l = []));
    l.push(s);
  }
  return [...by.entries()].map(([sql, l]) => {
    const t = l.map((s) => s.execMs + s.fetchMs).sort((a, b) => a - b);
    const sum = t.reduce((a, b) => a + b, 0);
    return {
      sql, count: l.length, min: t[0], max: t[t.length - 1], avg: Math.round((sum / t.length) * 10) / 10,
      p95: t[Math.min(t.length - 1, Math.ceil(t.length * 0.95) - 1)], errors: l.filter((s) => s.error).length,
    };
  }).sort((a, b) => b.count - a.count || b.max - a.max);
}

const short = (sql: string) => sql.replace(/\s+/g, ' ').slice(0, 80);
const q = (v: string | number | boolean) => `"${String(v).replace(/"/g, '""')}"`;

function exportCsv(stats: StmtStat[], summary: Summary[]) {
  const lines = ['#,sql,execMs,fetchMs,rows,error'];
  for (const s of stats) lines.push([s.index + 1, q(s.sql), s.execMs, s.fetchMs, s.rows, s.error].join(','));
  lines.push('', 'sql,count,minMs,avgMs,p95Ms,maxMs,errors');
  for (const s of summary) lines.push([q(s.sql), s.count, s.min, s.avg, s.p95, s.max, s.errors].join(','));
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sqlwb-statistics-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function StatsView({ stats }: { stats: StmtStat[] }) {
  const summary = useMemo(() => summarize(stats), [stats]);
  const shown = stats.length > SHOW_MAX ? stats.slice(0, SHOW_MAX) : stats;
  return (
    <div className="stats" data-testid="stats">
      <div className="stats-bar">
        <span>{stats.length} statements, {summary.length} distinct</span>
        <button className="btn small" onClick={() => exportCsv(stats, summary)}>Export CSV</button>
      </div>
      <div className="stats-title">Summary per SQL (time = exec + fetch, ms)</div>
      <table className="stats-table">
        <thead><tr><th>SQL</th><th>Count</th><th>Min</th><th>Avg</th><th>p95</th><th>Max</th><th>Errors</th></tr></thead>
        <tbody>
          {summary.slice(0, 200).map((s, i) => (
            <tr key={i}><td className="sql" title={s.sql}>{short(s.sql)}</td><td>{s.count}</td><td>{s.min}</td><td>{s.avg}</td><td>{s.p95}</td><td>{s.max}</td><td>{s.errors || ''}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="stats-title">Statements{stats.length > SHOW_MAX ? ` (first ${SHOW_MAX} shown, CSV has all)` : ''}</div>
      <table className="stats-table">
        <thead><tr><th>#</th><th>SQL</th><th>Exec ms</th><th>Fetch ms</th><th>Rows</th><th>Error</th></tr></thead>
        <tbody>
          {shown.map((s) => (
            <tr key={s.index} className={s.error ? 'err' : ''}>
              <td>{s.index + 1}</td><td className="sql" title={s.sql}>{short(s.sql)}</td><td>{s.execMs}</td><td>{s.fetchMs}</td><td>{s.rows}</td><td>{s.error ? 'yes' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
