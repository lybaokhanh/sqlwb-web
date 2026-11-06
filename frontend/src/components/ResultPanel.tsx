// Result area: "Messages", one tab per result set, and "Statistics" after a run.
import { useEffect, useRef } from 'react';
import { fetchAll, updateTab, useStore, type Tab } from '../state/store';
import { ResultGrid } from './ResultGrid';
import { StatsView } from './StatsView';
import { LoadPanel } from './LoadPanel';
import { Icon } from './icons';

export function ResultPanel({ tab }: { tab: Tab }) {
  const active = tab.results.find((r) => r.id === tab.activeResult);
  const showStats = tab.activeResult === 'stats' && tab.stats.length > 0;
  const showLoad = tab.activeResult === 'load' && !!tab.loadOpen;
  const msgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = msgRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tab.messages, active, showStats]);

  return (
    <div className="result-panel">
      <div className="rtabs" role="tablist">
        <button role="tab" className={`rtab${!active && !showStats && !showLoad ? ' active' : ''}`} aria-selected={!active && !showStats && !showLoad}
          onClick={() => updateTab(tab.id, { activeResult: 'messages' })}>
          Messages
          {tab.messages.some((m) => m.level === 'error') && <span className="dot err" />}
        </button>
        {tab.results.map((r) => (
          <button key={r.id} role="tab" className={`rtab${active?.id === r.id ? ' active' : ''}${r.closed ? ' closed' : ''}`}
            aria-selected={active?.id === r.id} title={r.closed ? `${r.sql}\n(cursor closed by the server)` : r.sql}
            onClick={() => updateTab(tab.id, { activeResult: r.id })}>
            {r.title}{r.closed ? ' (closed)' : ''}
            <span className="rcount">{r.done ? r.rowCount : `${r.rowCount}+`}</span>
          </button>
        ))}
        {tab.stats.length > 0 && !tab.running && (
          <button role="tab" className={`rtab${showStats ? ' active' : ''}`} aria-selected={showStats}
            onClick={() => updateTab(tab.id, { activeResult: 'stats' })}>
            Statistics
          </button>
        )}
        {tab.loadOpen && (
          <button role="tab" className={`rtab${showLoad ? ' active' : ''}`} aria-selected={showLoad}
            onClick={() => updateTab(tab.id, { activeResult: 'load' })}>
            Load run{tab.load?.running ? ' \u2022' : ''}
            <span className="rclose" role="button" aria-label="Close load run" onClick={(e) => { e.stopPropagation(); updateTab(tab.id, { loadOpen: false, activeResult: 'messages' }); }}>x</span>
          </button>
        )}
        <div className="rtabs-spacer" />
        {active && (
          <span className="rinfo" data-testid="row-info">
            {active.done || active.closed ? `${active.rowCount} rows`
              : active.fetchAll ? `${active.rowCount} rows (fetching...)` : `${active.rowCount} rows loaded, more on scroll`}
            {active.sort && !active.done && !active.closed ? ' · sort covers loaded rows' : ''}
          </span>
        )}
        {active && !active.done && !active.closed && !active.fetchAll && (
          <button className="btn small" data-testid="fetch-all" title="Fetch all rows of this result" onClick={() => fetchAll(tab.id, active.id)}>
            Fetch all
          </button>
        )}
      </div>
      {active && tab.filterOpen && (
        <div className="filter-bar">
          <Icon name="filter" size={14} />
          <input id="grid-filter" placeholder="Find in data (filters the rows)" value={tab.filterText}
            onChange={(e) => updateTab(tab.id, { filterText: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Escape') updateTab(tab.id, { filterOpen: false, filterText: '' }); }} />
          <button className="link-btn" onClick={() => updateTab(tab.id, { filterOpen: false, filterText: '' })}>Close</button>
        </div>
      )}
      <div className="result-body">
        {active ? (
          <ResultGrid key={active.id} tabId={tab.id} result={active} filterText={tab.filterOpen ? tab.filterText : ''} />
        ) : showLoad ? (
          <LoadPanel tab={tab} />
        ) : showStats ? (
          <StatsView stats={tab.stats} />
        ) : (
          <div className="messages" ref={msgRef} data-testid="messages">
            {tab.hiddenLines > 0 && <div className="msg muted">{tab.hiddenLines} older lines hidden</div>}
            {tab.messages.length === 0 && <div className="msg muted">No messages.</div>}
            {tab.messages.map((m, i) => (
              <div key={i} className={`msg ${m.level}`}>{m.text}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function useActiveTab(): Tab | undefined {
  return useStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
}
