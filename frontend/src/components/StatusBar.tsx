// Status bar: connection, cursor position, time, timeout, max rows.
import { useStore } from '../state/store';
import { useActiveTab } from './ResultPanel';

export function StatusBar() {
  const tab = useActiveTab();
  const profile = useStore((s) => (tab ? s.profiles[tab.profileId] : undefined));
  const maxRows = useStore((s) => s.maxRows);
  const timeout = useStore((s) => s.timeout);
  const maxResults = useStore((s) => s.maxResults);

  const conn = tab?.conn === 'connected' && tab.info
    ? `${tab.info.user}@${profile?.name ?? tab.info.url}`
    : tab?.conn === 'connecting' ? 'Connecting...' : 'Not connected';
  const time = tab?.running ? 'Running...' : tab?.lastMs != null ? fmtMs(tab.lastMs) : '';

  const num = (v: string) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  return (
    <div className="statusbar" data-testid="statusbar">
      <span className="sb-item sb-conn" title={profile?.url}>{conn}</span>
      <span className="sb-spacer" />
      <span className="sb-item sb-time">{time}</span>
      <span className="sb-item sb-pos">L:{tab?.cursor.line ?? 1} C:{tab?.cursor.col ?? 1}</span>
      <label className="sb-item">
        Timeout:
        <input className="sb-input" type="number" min={0} value={timeout}
          onChange={(e) => useStore.setState({ timeout: num(e.target.value) })} />s
      </label>
      <label className="sb-item" title="Result sets kept open per run (older cursors get closed)">
        Max. results:
        <input id="max-results" className="sb-input" type="number" min={1} value={maxResults}
          onChange={(e) => useStore.setState({ maxResults: Math.max(1, num(e.target.value)) })} />
      </label>
      <label className="sb-item">
        Max. Rows:
        <input id="max-rows" className="sb-input wide" type="number" min={0} value={maxRows} title="0 = no limit (F7)"
          onChange={(e) => useStore.setState({ maxRows: num(e.target.value) })} />
      </label>
    </div>
  );
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${((ms % 60_000) / 1000).toFixed(0)}s`;
}
