// DB Explorer tab, like the desktop DbExplorer. Left: schema, view tabs (Objects,
// Procedures, Triggers, Search table data) and the list. Right: details of the
// selected item (Columns, Indexes, Source, Data, Parameters) or the search.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DbColumn, DbIndexCol, DbObject, DbParam, DbSearchHit } from '../api/protocol';
import { api } from '../api/rpc';
import { editorBridge } from '../editor/bridge';
import { executeText, selectTab, updateTab, useStore, type Tab } from '../state/store';
import { ResultGrid } from './ResultGrid';
import { rememberExplorerSchema } from '../state/profiles';

type View = 'objects' | 'procedures' | 'triggers' | 'search';
type Detail = 'columns' | 'indexes' | 'source' | 'data' | 'parameters';
const VIEWS: Record<View, string> = { objects: 'Objects', procedures: 'Procedures', triggers: 'Triggers', search: 'Search table data' };
const DETAILS: Record<Exclude<View, 'search'>, Detail[]> = {
  objects: ['columns', 'indexes', 'source', 'data'],
  procedures: ['source', 'parameters'],
  triggers: ['source'],
};
const DATA_TYPES = ['TABLE', 'VIEW', 'SYNONYM', 'MATERIALIZED VIEW'];
const LIST_MAX = 3000;

interface Hit extends DbSearchHit { table: string; error?: string }

export function ExplorerView({ tab }: { tab: Tab }) {
  const connected = tab.conn === 'connected';
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState('');
  const [view, setView] = useState<View>('objects');
  const [tableTypes, setTableTypes] = useState<string[]>([]);
  const [typeKey, setTypeKey] = useState('*');
  const [reload, setReload] = useState(0);
  const [objects, setObjects] = useState<DbObject[]>([]);
  const [filter, setFilter] = useState('');
  const [sel, setSel] = useState<DbObject | null>(null);
  const [detail, setDetail] = useState<Detail>('columns');
  const [cols, setCols] = useState<DbColumn[] | null>(null);
  const [idx, setIdx] = useState<DbIndexCol[] | null>(null);
  const [params, setParams] = useState<DbParam[] | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; obj: DbObject } | null>(null);
  const [search, setSearch] = useState({ value: '', maxRows: 10 });
  const [hits, setHits] = useState<Hit[]>([]);
  const [progress, setProgress] = useState('');
  const [searching, setSearching] = useState(false);
  const searchRun = useRef(0);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const stopSearch = () => { searchRun.current++; };

  // Schemas and object types once connected.
  useEffect(() => {
    if (!connected) return;
    api.schemas(tab.id).then((s) => {
      setSchemas(s);
      const own = tab.info?.schema?.toUpperCase();
      const p = useStore.getState().profiles[tab.profileId];
      const kept = p?.rememberSchema ? p.explorerSchema : undefined;
      setSchema((cur) => cur || (kept && s.includes(kept) ? kept : own && s.includes(own) ? own : s[0] ?? ''));
    }, fail);
    api.tableTypes(tab.id).then(setTableTypes, () => setTableTypes([]));
  }, [connected, tab.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // List of the current view.
  useEffect(() => {
    if (!connected || !schema) return;
    setBusy(true);
    setError('');
    const load = view === 'procedures' ? api.procedures(tab.id, schema)
      : view === 'triggers' ? api.triggers(tab.id, schema)
        : api.objects(tab.id, schema, view === 'search' ? ['TABLE'] : typeKey === '*' ? undefined : [typeKey]);
    load.then((o) => setObjects(o), fail).finally(() => setBusy(false));
  }, [connected, schema, view, typeKey, reload, tab.id]);

  useEffect(() => stopSearch, []);

  // Details of the selected object.
  useEffect(() => {
    setCols(null); setIdx(null); setParams(null); setSource(null);
  }, [sel]);
  useEffect(() => {
    if (!sel || !connected || view === 'search') return;
    setError('');
    if (detail === 'columns' && !cols) api.columns(tab.id, schema, sel.name).then(setCols, fail);
    if (detail === 'indexes' && !idx) api.indexes(tab.id, schema, sel.name).then(setIdx, fail);
    if (detail === 'parameters' && !params) api.params(tab.id, schema, sel.name).then(setParams, fail);
    if (detail === 'source' && source == null) api.source(tab.id, schema, sel.name, sel.type).then(setSource, fail);
    if (detail === 'data' && DATA_TYPES.includes(sel.type)) {
      const maxRows = useStore.getState().maxRows || 1000;
      // Oracle: FETCH FIRST tells the optimizer to plan for the first rows (setMaxRows only stops the driver).
      const first = /oracle/i.test(tab.info?.product ?? '') ? ` FETCH FIRST ${maxRows} ROWS ONLY` : '';
      void executeText(tab.id, `SELECT * FROM ${schema}.${sel.name}${first}`, maxRows);
    }
  }, [sel, detail, connected]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const shown = useMemo(() => {
    const f = filter.trim().toUpperCase();
    const l = f ? objects.filter((o) => o.name.toUpperCase().includes(f)) : objects;
    return l.slice(0, LIST_MAX);
  }, [objects, filter]);

  const switchView = (v: View) => {
    if (v === view) return;
    stopSearch();
    setView(v);
    setSel(null);
    setObjects([]);
    if (v !== 'search') setDetail(DETAILS[v][0]);
  };

  // Searches the listed tables one by one, so that the database gets one query at a time.
  const runSearch = async () => {
    const run = ++searchRun.current;
    const tables = shown;
    setHits([]);
    setError('');
    setSearching(true);
    for (let i = 0; i < tables.length && searchRun.current === run; i++) {
      const t = tables[i].name;
      setProgress(`Table ${i + 1} of ${tables.length}: ${t}`);
      try {
        const h = await api.search(tab.id, schema, t, search.value, search.maxRows);
        if (searchRun.current === run && h.rows.length) setHits((p) => [...p, { table: t, ...h }]);
      } catch (e) {
        if (searchRun.current === run) setHits((p) => [...p, { table: t, columns: [], rows: [], error: e instanceof Error ? e.message : String(e) }]);
      }
    }
    setSearching(false);
    setProgress(searchRun.current === run ? `Done: ${tables.length} tables searched.` : 'Search stopped.');
  };

  const putSelect = (o: DbObject) => {
    const s = useStore.getState();
    const target = s.tabs.find((t) => t.id === tab.sourceTabId && t.kind !== 'explorer')
      ?? s.tabs.find((t) => t.kind !== 'explorer');
    if (!target) return;
    const stmt = `SELECT *\nFROM ${schema}.${o.name};`;
    const cur = editorBridge.current.snapshot(target.id)?.sql ?? target.sql;
    const text = cur.trim() ? `${cur.replace(/\s+$/, '')}\n\n${stmt}` : stmt;
    selectTab(target.id);
    updateTab(target.id, { sql: text });
    editorBridge.current.setText(target.id, text);
    editorBridge.current.setCursorOffset(target.id, text.length);
    editorBridge.current.focus();
  };

  const result = tab.results[0];
  const hitCount = (name: string) => hits.find((h) => h.table === name);
  const sideText = (o: DbObject) => {
    if (view === 'triggers') return o.table ?? '';
    if (view === 'search') { const h = hitCount(o.name); return h ? (h.error ? 'error' : `${h.rows.length} rows`) : ''; }
    return o.type;
  };

  return (
    <div className="explorer" data-testid="explorer">
      <div className="ex-left">
        <div className="ex-controls">
          <select aria-label="Schema" value={schema} onChange={(e) => { stopSearch(); setSchema(e.target.value); setSel(null); rememberExplorerSchema(tab.profileId, e.target.value); }}>
            {schemas.map((s) => <option key={s}>{s}</option>)}
          </select>
          <button className="btn small" aria-label="Reload" title="Reload the list" onClick={() => setReload((n) => n + 1)}>&#x21bb;</button>
        </div>
        <div className="rtabs ex-views" role="tablist" aria-label="Explorer views">
          {(Object.keys(VIEWS) as View[]).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={`rtab${view === v ? ' active' : ''}`} onClick={() => switchView(v)}>
              {VIEWS[v]}
            </button>
          ))}
        </div>
        <div className="ex-controls">
          {view === 'objects' && (
            <select aria-label="Object types" value={typeKey} onChange={(e) => { setTypeKey(e.target.value); setSel(null); }}>
              <option value="*">*</option>
              {tableTypes.map((t) => <option key={t}>{t}</option>)}
            </select>
          )}
          <input className="ex-filter" placeholder={view === 'search' ? 'Filter tables' : 'Filter objects'} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter objects" />
        </div>
        <div className="ex-list" role="listbox" aria-label="Objects">
          {!connected && <div className="msg muted">Not connected.</div>}
          {busy && <div className="msg muted">Loading...</div>}
          {shown.map((o) => (
            <div key={`${o.type}:${o.name}`} role="option" aria-selected={sel?.name === o.name && sel.type === o.type}
              className={`ex-item${sel?.name === o.name && sel.type === o.type ? ' sel' : ''}${o.status === 'INVALID' || o.status === 'DISABLED' ? ' invalid' : ''}`}
              title={[o.remarks, o.status, o.event, o.timing].filter(Boolean).join(' | ')}
              onClick={() => setSel(o)}
              onContextMenu={(e) => { e.preventDefault(); setSel(o); setMenu({ x: e.clientX, y: e.clientY, obj: o }); }}>
              <span className="ex-name">{o.name}</span>
              <span className="ex-type">{sideText(o)}</span>
            </div>
          ))}
          {objects.length > shown.length && !filter && <div className="msg muted">{objects.length - shown.length} more. Use the filter.</div>}
        </div>
        <div className="ex-count">{objects.length} {view === 'search' ? 'tables' : 'objects'}{filter && ` (${shown.length} shown)`}</div>
      </div>
      <div className="ex-right">
        {view === 'search' ? (
          <>
            <form className="ex-search" onSubmit={(e) => { e.preventDefault(); if (!searching && search.value.trim()) void runSearch(); }}>
              <input className="ex-filter" aria-label="Search value" placeholder="Search value (LIKE, no % = anywhere, ignores case)"
                value={search.value} onChange={(e) => setSearch({ ...search, value: e.target.value })} />
              <label className="check">Max. rows per table
                <input type="number" min={1} max={1000} aria-label="Max. rows per table" value={search.maxRows}
                  onChange={(e) => setSearch({ ...search, maxRows: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) })} />
              </label>
              {searching
                ? <button type="button" className="btn" onClick={stopSearch}>Cancel</button>
                : <button type="submit" className="btn primary" disabled={!connected || !search.value.trim() || shown.length === 0}>Search {shown.length} tables</button>}
            </form>
            {progress && <div className="ex-progress" data-testid="search-progress">{progress} {hits.filter((h) => !h.error).length} tables with hits.</div>}
            {error && <div className="ex-error" role="alert">{error}</div>}
            <div className="ex-hits" data-testid="search-hits">
              {hits.map((h) => (
                <div key={h.table} className="ex-hit">
                  <div className={`ex-hit-title${h.error ? ' err' : ''}`}>{schema}.{h.table}: {h.error ?? `${h.rows.length} rows${h.rows.length >= search.maxRows ? ' (limit)' : ''}`}</div>
                  {h.rows.length > 0 && (
                    <table className="stats-table meta-table">
                      <thead><tr>{h.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                      <tbody>{h.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="sql">{v ?? ''}</td>)}</tr>)}</tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="rtabs" role="tablist">
              {DETAILS[view].map((d) => (
                <button key={d} role="tab" aria-selected={detail === d} className={`rtab${detail === d ? ' active' : ''}`} onClick={() => setDetail(d)}>
                  {d[0].toUpperCase() + d.slice(1)}
                </button>
              ))}
              <div className="rtabs-spacer" />
              {sel && <span className="rinfo">{schema}.{sel.name} ({sel.type}{sel.table ? ` on ${sel.table}, ${sel.timing} ${sel.event}` : ''})</span>}
            </div>
            {error && <div className="ex-error" role="alert">{error}</div>}
            <div className="ex-detail">
              {!sel && <div className="msg muted pad">Select an object.</div>}
              {sel && detail === 'columns' && cols && (
                <table className="stats-table meta-table">
                  <thead><tr><th>#</th><th>Column</th><th>Type</th><th>Size</th><th>Digits</th><th>Nullable</th><th>Default</th><th>Remarks</th></tr></thead>
                  <tbody>{cols.map((c) => (
                    <tr key={c.name}><td>{c.position}</td><td className="sql">{c.name}</td><td className="sql">{c.type}</td><td>{c.size ?? ''}</td><td>{c.digits ?? ''}</td><td>{c.nullable ? 'YES' : 'NO'}</td><td className="sql">{c.default ?? ''}</td><td className="sql">{c.remarks ?? ''}</td></tr>
                  ))}</tbody>
                </table>
              )}
              {sel && detail === 'indexes' && idx && (
                idx.length === 0 ? <div className="msg muted pad">No indexes.</div> : (
                  <table className="stats-table meta-table">
                    <thead><tr><th>Index</th><th>Unique</th><th>Column</th><th>Position</th></tr></thead>
                    <tbody>{idx.map((x, i) => (
                      <tr key={i}><td className="sql">{x.name}</td><td>{x.unique ? 'YES' : 'NO'}</td><td className="sql">{x.column}</td><td>{x.position}</td></tr>
                    ))}</tbody>
                  </table>
                )
              )}
              {sel && detail === 'parameters' && params && (
                params.length === 0 ? <div className="msg muted pad">No parameters.</div> : (
                  <table className="stats-table meta-table">
                    <thead><tr><th>Routine</th><th>#</th><th>Parameter</th><th>Mode</th><th>Type</th></tr></thead>
                    <tbody>{params.map((p, i) => (
                      <tr key={i}><td className="sql">{p.object}</td><td>{p.position}</td><td className="sql">{p.name ?? ''}</td><td>{p.mode}</td><td className="sql">{p.type ?? ''}</td></tr>
                    ))}</tbody>
                  </table>
                )
              )}
              {sel && detail === 'source' && source != null && <SourceView text={source} />}
              {sel && detail === 'data' && (
                !DATA_TYPES.includes(sel.type)
                  ? <div className="msg muted pad">No data for a {sel.type.toLowerCase()}.</div>
                  : result ? <ResultGrid key={result.id} tabId={tab.id} result={result} filterText="" />
                    : <div className="msg muted pad">{tab.running ? 'Loading data...' : tab.messages.filter((m) => m.level === 'error').map((m) => m.text).join('\n')}</div>
              )}
            </div>
          </>
        )}
      </div>
      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} role="menu" onMouseDown={(e) => e.stopPropagation()}>
          {(view === 'objects' || view === 'search') && (
            <button className="menu-item" role="menuitem" onClick={() => { putSelect(menu.obj); setMenu(null); }}>Put SELECT in editor</button>
          )}
          {view === 'objects' && <button className="menu-item" role="menuitem" onClick={() => { setDetail('data'); setMenu(null); }}>Show data</button>}
          {view !== 'search' && <button className="menu-item" role="menuitem" onClick={() => { setDetail('source'); setMenu(null); }}>Show source</button>}
        </div>
      )}
    </div>
  );
}

function SourceView({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const api = useRef<{ setText(t: string): void; dispose(): void } | null>(null);
  useEffect(() => {
    let gone = false;
    void import('../editor/monacoEditor').then((m) => {
      if (gone || !ref.current) return;
      api.current = m.mountReadOnly(ref.current, text);
    });
    return () => { gone = true; api.current?.dispose(); api.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.current?.setText(text); }, [text]);
  return <div className="ex-source" ref={ref} data-testid="source" />;
}
