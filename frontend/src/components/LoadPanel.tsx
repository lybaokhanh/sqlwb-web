// Load run panel (per tab): N sessions run the tab's SQL for S seconds.
// Uses the tab's profile and the password typed this session (memory only).
import { useState } from 'react';
import type { LoadStats } from '../api/protocol';
import { client } from '../api/client';
import { editorBridge } from '../editor/bridge';
import {
  ensureConnected, getPassword, hasPassword, newId, updateTab, useStore, type Tab,
} from '../state/store';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v) || lo));

export function LoadPanel({ tab }: { tab: Tab }) {
  const profile = useStore((s) => s.profiles[tab.profileId]);
  const defaultUrl = useStore((s) => s.defaultUrl);
  const [sessions, setSessions] = useState(tab.load?.sessions ?? 4);
  const [seconds, setSeconds] = useState(tab.load?.seconds ?? 30);
  const [rate, setRate] = useState(tab.load?.ratePerSec ?? 0);
  const danger = !!profile && !!defaultUrl && profile.url.trim() === defaultUrl.trim();
  const run = tab.load;
  const last = run?.end ?? run?.samples[run.samples.length - 1];

  const start = async () => {
    if (!profile) return;
    if (!hasPassword(profile.id) && !(await ensureConnected(tab.id))) return;
    const password = getPassword(profile.id) ?? '';
    const sql = editorBridge.current.snapshot(tab.id)?.sql ?? tab.sql;
    if (!sql.trim()) return;
    const cfg = { sessions: clamp(sessions, 1, 20), seconds: clamp(seconds, 1, 600), ratePerSec: Math.max(0, Math.round(rate) || 0) };
    const go = () => {
      const reqId = newId('l');
      updateTab(tab.id, { load: { reqId, running: true, samples: [], ...cfg } });
      client.send({
        type: 'loadStart', tabId: tab.id, reqId, ...cfg, sql,
        profile: { url: profile.url, user: profile.user, password, autocommit: profile.autocommit },
      });
    };
    if (danger) {
      useStore.setState({
        dialog: {
          kind: 'confirm', danger: true, title: 'Load run against the default database',
          text: `This runs ${cfg.sessions} sessions for ${cfg.seconds} s against ${profile.url}. Other users of this database will feel it. Are you sure?`,
          okLabel: 'Start load run', onOk: go,
        },
      });
    } else go();
  };

  const stop = () => client.send({ type: 'loadStop', tabId: tab.id });

  return (
    <div className="load" data-testid="load-panel">
      {danger && (
        <div className="load-warning" role="alert">
          WARNING: this tab is connected to the default database ({profile?.url}). A load run hits a shared system.
        </div>
      )}
      <div className="load-form">
        <label>Sessions (1-20)<input name="sessions" type="number" min={1} max={20} value={sessions} onChange={(e) => setSessions(Number(e.target.value))} /></label>
        <label>Seconds (1-600)<input name="seconds" type="number" min={1} max={600} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} /></label>
        <label>Rate / s (0 = max)<input name="rate" type="number" min={0} value={rate} onChange={(e) => setRate(Number(e.target.value))} /></label>
        {run?.running
          ? <button className="btn danger" onClick={stop}>Stop</button>
          : <button className="btn primary" onClick={() => void start()}>Start</button>}
        <span className="load-note">Runs all statements of this tab. User: {profile?.user || '?'}</span>
      </div>
      {run && (
        <>
          <div className="load-stats" data-testid="load-stats">
            <Stat label="State" value={run.running ? 'running' : 'finished'} />
            <Stat label="Elapsed" value={last ? `${(last.elapsedMs / 1000).toFixed(0)} s` : '-'} />
            <Stat label="Executions" value={last?.count ?? 0} />
            <Stat label="Errors" value={last?.errors ?? 0} bad={!!last?.errors} />
            <Stat label="Rate / s" value={last?.rps ?? 0} />
            <Stat label="p50 ms" value={last?.p50 ?? 0} />
            <Stat label="p95 ms" value={last?.p95 ?? 0} />
            <Stat label="p99 ms" value={last?.p99 ?? 0} />
            <Stat label="Max ms" value={last?.max ?? 0} />
            {run.end && <Stat label="Sessions" value={run.end.sessions} />}
          </div>
          {last?.lastError && <div className="load-error">Last error: {last.lastError}</div>}
          <Chart samples={run.samples} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, bad }: { label: string; value: string | number; bad?: boolean }) {
  return <div className={`stat${bad ? ' bad' : ''}`}><span>{label}</span><b>{value}</b></div>;
}

/** p95 (blue) and rps (green) over time. Each line has its own scale. */
function Chart({ samples }: { samples: LoadStats[] }) {
  const W = 560, H = 140, P = 28;
  if (samples.length < 2) return <div className="msg muted pad">The chart starts after 2 samples.</div>;
  const maxT = Math.max(...samples.map((s) => s.elapsedMs)) || 1;
  const maxP = Math.max(1, ...samples.map((s) => s.p95));
  const maxR = Math.max(1, ...samples.map((s) => s.rps));
  const x = (t: number) => P + (t / maxT) * (W - 2 * P);
  const line = (v: (s: LoadStats) => number, max: number) =>
    samples.map((s) => `${x(s.elapsedMs).toFixed(1)},${(H - P - (v(s) / max) * (H - 2 * P)).toFixed(1)}`).join(' ');
  return (
    <svg className="load-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="p95 and rate over time">
      <line x1={P} y1={H - P} x2={W - P} y2={H - P} className="axis" />
      <line x1={P} y1={P} x2={P} y2={H - P} className="axis" />
      <line x1={W - P} y1={P} x2={W - P} y2={H - P} className="axis" />
      <polyline points={line((s) => s.p95, maxP)} className="l-p95" />
      <polyline points={line((s) => s.rps, maxR)} className="l-rps" />
      <text x={P - 4} y={P + 4} textAnchor="end" className="t-p95">{maxP}</text>
      <text x={W - P + 4} y={P + 4} className="t-rps">{maxR}</text>
      <text x={P} y={H - 8} className="t">0 s</text>
      <text x={W - P} y={H - 8} textAnchor="end" className="t">{(maxT / 1000).toFixed(0)} s</text>
      <text x={W / 2 - 60} y={14} className="t-p95">p95 ms</text>
      <text x={W / 2 + 10} y={14} className="t-rps">rate / s</text>
    </svg>
  );
}
