// Compare tab: runs the result's query in a second schema or connection (B) and shows the rows side by side.
// Options on the left; chips, bulk bar and grid on the right. "Compare SQL" shows the FULL OUTER JOIN form.
import { memo, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { updateTab, useStore, type Tab } from '../state/store';
import { api } from '../api/rpc';
import { editorBridge } from '../editor/bridge';
import { fmt } from './gridUtil';
import type { PairRow, Status } from '../compare/engine';
import {
  bulkAction, canAct, compareSql, discardAll, hasPw, hiddenA, loginProfile, pairsOf, pending, readOnlySide, rowAction,
  runFromEditor, sessionOf, setOption, setSourceA, setSourceB, tableCache, toggleCol, toggleFilter, bump,
  type Act, type CompareSession, type Side, type Stmt,
} from '../compare/session';
import { EditDialog, ReviewDialog } from './CompareDialogs';

const SYM: Record<Status, string> = { same: '=', chg: '≠', add: '+', del: '−' };
const LBL: Record<Status, string> = { same: 'Same', chg: 'Changed', add: 'Only in B', del: 'Only in A' };
const MAX_SHOWN = 2000;

// ---- Column widths, kept per table in this browser ----
const W_KEY = 'sqlwb.cmp.w:';
const MIN_W = 36;
const MAX_W = 1600;
const defW = (id: string) => (id === '_sel' ? 30 : id === '_st' ? 44 : id === '_act' ? 260 : 160);
function loadW(name: string): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(W_KEY + name) ?? '{}'); } catch { return {}; }
}
function saveW(name: string, w: Record<string, number>) {
  try { localStorage.setItem(W_KEY + name, JSON.stringify(w)); } catch { /* storage off */ }
}

// ---- Header sort: one column (A value, else B) or the status. NULL is last. Equal values keep the compare order. ----
/** col -1 = status. */
interface Sort { col: number; dir: 1 | -1 }
const ST_ORDER: Record<Status, number> = { chg: 0, del: 1, add: 2, same: 3 };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function sortPairs(list: PairRow[], sort: Sort | null): PairRow[] {
  if (!sort) return list;
  const { col, dir } = sort;
  const key = (p: PairRow) => (col < 0 ? ST_ORDER[p.st] : p.a ? p.a.v[col] : p.b?.v[col]);
  const keys = list.map(key);
  const order = list.map((_, i) => i);
  order.sort((i, j) => {
    const x = keys[i];
    const y = keys[j];
    if (x == null || y == null) return x == null ? (y == null ? i - j : 1) : -1;
    const nx = Number(x);
    const ny = Number(y);
    const c = typeof x !== 'object' && typeof y !== 'object' && String(x).trim() !== '' && String(y).trim() !== '' && !isNaN(nx) && !isNaN(ny)
      ? nx - ny : collator.compare(fmt(x), fmt(y));
    return c !== 0 ? c * dir : i - j;
  });
  return order.map((i) => list[i]);
}

/** Test "row has pending statements" in O(1): same rule as rowStmts (its A or B row, or a delete with its match key). */
function dirtyIndex(stmts: Stmt[]): (p: PairRow) => boolean {
  const a = new Set<number>();
  const b = new Set<number>();
  const del = new Set<string>();
  for (const x of stmts) {
    (x.side === 'A' ? a : b).add(x.id);
    if (x.op === 'DELETE') del.add(x.mk);
  }
  return (p) => (!!p.a && a.has(p.a.id)) || (!!p.b && b.has(p.b.id)) || del.has(p.mk);
}

interface RowCtx {
  s: CompareSession;
  tabId: string;
  vis: number[];
  cell: (p: PairRow, i: number) => ReactNode;
  buttons: (p: PairRow, isDirty: boolean) => ReactNode;
}
interface RowProps {
  p: PairRow; checked: boolean; isDirty: boolean;
  /** Only for the memo: a new value draws the row again. */
  rev: number; visKey: string; ro: string;
  ctx: MutableRefObject<RowCtx>;
}

/** One grid row. Memo: a click on one row, a filter chip or a column drag does not draw all rows again. */
const Row = memo(function Row({ p, checked, isDirty, ctx }: RowProps) {
  const { s, tabId, vis, cell, buttons } = ctx.current;
  return (
    <tr className={`${p.st}${isDirty ? ' dirty' : ''}`} data-aid={p.a?.id} data-bid={p.b?.id}>
      <td className="sel"><input type="checkbox" aria-label="Select row" checked={checked}
        onChange={(e) => { if (e.target.checked) s.sel.add(p.k); else s.sel.delete(p.k); bump(tabId, true); }} /></td>
      <td className="st" title={`${LBL[p.st]}${isDirty ? ', pending change' : ''}`}>{SYM[p.st]}{isDirty && <span className="pen">✎</span>}</td>
      {vis.map((i) => cell(p, i))}
      <td className="ra">{buttons(p, isDirty)}</td>
    </tr>
  );
});

/** Password for a connection profile with none in memory yet. */
function LoginBox({ s, side }: { s: CompareSession; side: Side }) {
  const profileId = side === 'A' ? s.profileA : s.profileB;
  const name = useStore((x) => x.profiles[profileId]?.name ?? profileId);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  if (hasPw(profileId)) return null;
  return (
    <form className="cmp-login" onSubmit={(e) => {
      e.preventDefault();
      if (!pw) return;
      setBusy(true);
      void loginProfile(s.tabId, profileId, pw).finally(() => setBusy(false));
    }}>
      <input type="password" aria-label={`Password of ${side}`} placeholder={`Password for ${name}`} value={pw}
        autoComplete="current-password" onChange={(e) => setPw(e.target.value)} />
      <button className="sb" type="submit" disabled={!pw || busy}>{busy ? '...' : 'Log in'}</button>
    </form>
  );
}

/** Tables of the A schema. A pick puts "select * from <schema>.<table>" into the editor. */
function TablePicker({ s }: { s: CompareSession }) {
  const ok = !!s.schemaA && !!s.schemas[s.profileA];
  const cacheKey = `${s.profileA}|${s.schemaA}`;
  const [list, setList] = useState<string[]>(() => tableCache.get(cacheKey) ?? []);
  useEffect(() => {
    const known = tableCache.get(cacheKey);
    setList(known ?? []);
    if (!ok || known) return;
    let live = true;
    api.objects(hiddenA(s.tabId), s.schemaA, ['TABLE']).then(
      (rows) => {
        const names = rows.map((r) => r.name).sort();
        tableCache.set(cacheKey, names);
        if (live) setList(names);
      },
      () => { if (live) setList([]); },
    );
    return () => { live = false; };
  }, [ok, s.tabId, cacheKey]);
  return (
    <select aria-label="Table" value={s.picked && list.includes(s.picked) ? s.picked : ''} disabled={!list.length}
      onChange={(e) => {
        if (!e.target.value) return;
        s.picked = e.target.value;
        const sql = `select * from ${s.schemaA}.${e.target.value}`;
        editorBridge.current.setText(s.tabId, sql);
        updateTab(s.tabId, { sql });
        bump(s.tabId, true);
      }}>
      <option value="">{!ok ? 'Table: pick a schema of A first' : list.length ? `Pick a table (${list.length})` : 'Loading tables...'}</option>
      {list.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}

/** Result area of a Compare tab: "Compare" and "Compare SQL". */
export function CompareView({ tab }: { tab: Tab }) {
  const sqlView = tab.activeResult === 'compare-sql';
  return (
    <div className="result-panel">
      <div className="rtabs" role="tablist">
        <button role="tab" className={`rtab${!sqlView ? ' active' : ''}`} aria-selected={!sqlView}
          data-testid="tab-compare" onClick={() => updateTab(tab.id, { activeResult: 'compare' })}>Compare</button>
        <button role="tab" className={`rtab${sqlView ? ' active' : ''}`} aria-selected={sqlView}
          data-testid="tab-compare-sql" onClick={() => updateTab(tab.id, { activeResult: 'compare-sql' })}>Compare SQL</button>
        <div className="rtabs-spacer" />
      </div>
      <div className="result-body"><ComparePanel tab={tab} sqlView={sqlView} /></div>
    </div>
  );
}

export function ComparePanel({ tab, sqlView }: { tab: Tab; sqlView: boolean }) {
  useStore((s) => s.tabs.find((t) => t.id === tab.id)?.compare?.v);
  const profiles = useStore((s) => s.profiles);
  const s = sessionOf(tab.id);
  const [edit, setEdit] = useState<{ k: string; col: number } | null>(null);
  const [review, setReview] = useState(false);
  const [sort, setSort] = useState<Sort | null>(null);
  const wName = (s?.name ?? s?.sql ?? '').toUpperCase().slice(0, 80);
  const [widths, setWidths] = useState<Record<string, number>>(() => loadW(wName));
  const focusAfter = useRef<{ a?: number; b?: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const rowCtx = useRef<RowCtx>(null!);
  const viewCache = useRef<{ pairs?: PairRow[]; stmts?: Stmt[]; f?: string; sort?: Sort | null; out: PairRow[] }>({ out: [] });

  useLayoutEffect(() => {
    // Keep the focus on the same row after an action re-renders the grid.
    const f = focusAfter.current;
    const g = gridRef.current;
    if (!f || !g) return;
    focusAfter.current = null;
    const tr = (f.a != null ? g.querySelector(`tr[data-aid="${f.a}"]`) : null) ?? (f.b != null ? g.querySelector(`tr[data-bid="${f.b}"]`) : null);
    const target = tr?.querySelector<HTMLElement>('td.ra button:not([disabled])') ?? tr?.querySelector<HTMLElement>('td.sel input');
    target?.focus({ preventScroll: true });
  });

  if (!s) return <div className="cmp-empty">Compare is closed.</div>;

  const pairs = pairsOf(s);
  const stmts = pending(s);
  const n: Record<Status, number> = { same: 0, chg: 0, add: 0, del: 0 };
  pairs.forEach((p) => n[p.st]++);
  const vc = viewCache.current;
  const fKey = [...s.filter].sort().join();
  if (vc.pairs !== pairs || vc.stmts !== stmts || vc.f !== fKey || vc.sort !== sort) {
    const isDirty = dirtyIndex(stmts);
    // Rows with pending changes stay visible when their chip is off, so their Revert stays reachable.
    const dirtyK = new Set(pairs.filter(isDirty).map((p) => p.k));
    Object.assign(vc, { pairs, stmts, f: fKey, sort, dirtyK, out: sortPairs(pairs.filter((p) => s.filter.has(p.st) || dirtyK.has(p.k)), sort) });
  }
  const dirtyK = (vc as { dirtyK?: Set<string> }).dirtyK ?? new Set<string>();
  const dirty = (p: PairRow) => dirtyK.has(p.k);
  const shownAll = vc.out;
  const toggleSort = (col: number) => setSort((o) => (o?.col !== col ? { col, dir: 1 } : o.dir === 1 ? { col, dir: -1 } : null));
  const ariaSort = (col: number) => (sort?.col !== col ? undefined : sort.dir === 1 ? 'ascending' as const : 'descending' as const);
  const sortMark = (col: number) => (sort?.col === col ? <span className="sm">{sort.dir === 1 ? '▲' : '▼'}</span> : null);
  const shown = shownAll.slice(0, MAX_SHOWN);
  const shownK = new Set(shownAll.map((p) => p.k));
  [...s.sel].forEach((k) => { if (!shownK.has(k)) s.sel.delete(k); });
  const chosen = pairs.filter((p) => s.sel.has(p.k));
  const cols = s.columns;
  const vis = new Set(cols.map((_, i) => i).filter((i) => !(s.opts.hide && s.ignore.has(i))));
  const ids = ['_sel', '_st', ...[...vis].map((i) => `c${i}`), '_act'];
  const w = (id: string) => widths[id] ?? defW(id);
  const total = ids.reduce((sum, id) => sum + w(id), 0);
  const tabId = tab.id;
  const editPair = edit ? pairs.find((p) => p.k === edit.k) : undefined;
  const ready = s.state === 'ready';

  const setW = (id: string, v: number, keep = false) => {
    setWidths((old) => {
      const next = { ...old, [id]: Math.round(Math.max(MIN_W, Math.min(MAX_W, v))) };
      if (keep) saveW(wName, next);
      return next;
    });
  };
  const fit = (id: string) => {
    const t = gridRef.current?.querySelector('table');
    const i = ids.indexOf(id);
    if (!t || i < 0) return;
    // Measure the natural content width of each cell in a hidden box. The cell itself is as wide as the
    // column, so its scrollWidth grows with each fit.
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none';
    // Inside the grid, so the grid styles (.va / .vb on their own lines) apply to the copies.
    gridRef.current!.appendChild(probe);
    const boxes: [HTMLElement, number][] = [];
    t.querySelectorAll('tr').forEach((tr) => {
      const cell = tr.children[i] as HTMLTableCellElement | undefined;
      if (!cell || cell.colSpan > 1) return;
      const cs = getComputedStyle(cell);
      const box = document.createElement('span');
      box.style.cssText = `display:inline-block;white-space:nowrap;font:${cs.font};letter-spacing:${cs.letterSpacing}`;
      cell.childNodes.forEach((n) => {
        if (n instanceof HTMLElement && n.classList.contains('rz')) return;
        box.appendChild(n.cloneNode(true));
      });
      probe.appendChild(box);
      probe.appendChild(document.createElement('br'));
      // Padding and border of the cell; a key header also shows the key mark after the name.
      const extra = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 2
        + (cell.tagName === 'TH' && cell.classList.contains('key') ? 16 : 0);
      boxes.push([box, extra]);
    });
    let need = 40;
    boxes.forEach(([box, extra]) => { need = Math.max(need, Math.ceil(box.getBoundingClientRect().width + extra)); });
    probe.remove();
    setW(id, Math.min(need, 900), true);
  };
  const resizer = (id: string, label: string) => (
    <span className="rz" role="separator" aria-orientation="vertical" tabIndex={0} aria-label={`Resize column ${label}`}
      title="Drag to resize. Double-click to fit the content. Arrow keys: ±10 px."
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const x0 = e.clientX;
        const w0 = w(id);
        const total0 = total;
        const el = e.currentTarget;
        const table = el.closest('table');
        const colEl = table?.querySelector<HTMLElement>(`col[data-id="${id}"]`);
        el.setPointerCapture(e.pointerId);
        el.classList.add('on');
        document.body.classList.add('col-resizing');
        let last = w0;
        // During the drag only the <col> and the table width change in the DOM (no React draw of all rows).
        const move = (ev: PointerEvent) => {
          last = Math.round(Math.max(MIN_W, Math.min(MAX_W, w0 + ev.clientX - x0)));
          if (colEl && table) { colEl.style.width = `${last}px`; table.style.width = `${total0 - w0 + last}px`; } else setW(id, last);
        };
        const end = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', end);
          el.removeEventListener('pointercancel', end);
          el.classList.remove('on');
          document.body.classList.remove('col-resizing');
          setW(id, last, true);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => { e.stopPropagation(); fit(id); }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setW(id, w(id) + (e.key === 'ArrowRight' ? 10 : -10), true); }
        if (e.key === 'Enter') { e.preventDefault(); fit(id); }
      }} />
  );

  const act = (p: PairRow, a: Act) => {
    focusAfter.current = { a: p.a?.id, b: p.b?.id };
    rowAction(tabId, p, a);
  };

  const profileList = Object.values(profiles);
  const schemasA = s.schemas[s.profileA] ?? [];
  const schemasB = s.schemas[s.profileB] ?? [];
  const product = tab.info?.product ?? '';

  const cell = (p: PairRow, i: number) => {
    const open = () => setEdit({ k: p.k, col: i });
    const td = (cls: string, inner: React.ReactNode) => (
      <td key={i} className={`cell ${cls}`} title="Double-click to edit" onDoubleClick={open}>{inner}</td>
    );
    const show = (v: unknown) => (v == null ? <span className="null">NULL</span> : fmt(v).replace(/ $/, '·'));
    if (p.st === 'add') return td('', <span className="trunc">{show(p.b!.v[i])}</span>);
    if (p.st === 'del') return td('', <span className="trunc">{show(p.a!.v[i])}</span>);
    const a = p.a!.v[i];
    const b = p.b!.v[i];
    const sd = p.s?.[i];
    if (sd && !s.keys.has(i) && !s.ignore.has(i)) {
      const c = sd.ch.length;
      // The button comes first, so a narrow column cuts the long value, not the button.
      return td(c ? 'diff' : '', <>
        <button className={`sd ${c ? 'c-chg' : 'c-same'}`} onClick={open} title="Show the differences by path">
          {sd.kind === 'JSON' ? '{ }' : '</>'} {c ? `${c} change${c > 1 ? 's' : ''}` : fmt(a) === fmt(b) ? 'same' : 'same, format differs'}
        </button>{' '}
        <span className="trunc">{show(a)}</span>
      </>);
    }
    if (p.d?.[i]) return td('diff', <><span className="va">{show(a)}</span><span className="vb">{show(b)}</span></>);
    if (s.ignore.has(i) && fmt(a) !== fmt(b)) return td('ignc', <span className="trunc">{show(a)} | {show(b)}</span>);
    return td('', <span className="trunc">{show(a)}</span>);
  };

  const rowButtons = (p: PairRow, isDirty: boolean) => {
    const b = (a: Act, text: string, cls = '') => (
      <button key={a} className={`sb ${cls}`} disabled={!canAct(s, p, a)} onClick={(e) => { if (e.detail > 1) return; act(p, a); }}>{text}</button>
    );
    // Fixed slots: a button never moves into the place of the button just clicked.
    // Revert has its own slot on the right, so a second click cannot undo the change by accident.
    const gap = <span className="ph" />;
    const [one, two] =
      p.st === 'chg' ? [b('toB', 'A → B'), b('toA', 'A ← B')]
      : p.st === 'del' ? [b('toB', 'Insert in B'), b('delA', 'Delete in A', 'dng')]
      : p.st === 'add' ? [b('toA', 'Insert in A'), b('delB', 'Delete in B', 'dng')]
      : [gap, gap];
    return <div className="ra-slots">{one}{two}{isDirty ? b('rev', '↶ Revert', 'rv') : gap}</div>;
  };

  rowCtx.current = { s, tabId, vis: [...vis], cell, buttons: rowButtons };
  const visKey = [...vis].join();
  const ro = `${readOnlySide(s, 'A')}${readOnlySide(s, 'B')}`;

  const bulkOk = (a: Act) => !s.noEdit && chosen.some((p) => canAct(s, p, a));

  return (
    <div className="cmp" data-testid="compare">
      <aside className="cmp-side">
        <fieldset>
          <legend>Sources</legend>
          <div className="cmp-src"><span className="tag">A</span>
            <select aria-label="Connection of A" value={s.profileA}
              onChange={(e) => setSourceA(tabId, e.target.value, '')}>
              {profileList.map((p) => <option key={p.id} value={p.id}>{p.name}{!hasPw(p.id) ? ' (log in)' : ''}</option>)}
            </select>
          </div>
          <div className="cmp-src"><span /><LoginBox s={s} side="A" /></div>
          <div className="cmp-src"><span />
            <select aria-label="Schema of A" value={s.schemaA} onChange={(e) => setSourceA(tabId, s.profileA, e.target.value)}>
              <option value="">(current schema)</option>
              {schemasA.map((x) => <option key={x} value={x}>{x}</option>)}
              {s.schemaA && !schemasA.includes(s.schemaA) && <option value={s.schemaA}>{s.schemaA}</option>}
            </select>
          </div>
          <div className="cmp-src"><span className="tag">B</span>
            <select aria-label="Connection of B" value={s.profileB}
              onChange={(e) => setSourceB(tabId, e.target.value, '')}>
              {profileList.map((p) => <option key={p.id} value={p.id}>{p.name}{!hasPw(p.id) ? ' (log in)' : ''}</option>)}
            </select>
          </div>
          <div className="cmp-src"><span /><LoginBox s={s} side="B" /></div>
          <div className="cmp-src"><span />
            <select aria-label="Schema of B" value={s.schemaB} onChange={(e) => setSourceB(tabId, s.profileB, e.target.value)}>
              {!s.schemaB && <option value="">{schemasB.length ? 'Pick a schema' : hasPw(s.profileB) ? 'Loading schemas...' : 'Log in first'}</option>}
              {schemasB.map((x) => <option key={x} value={x}>{x}</option>)}
              {s.schemaB && !schemasB.includes(s.schemaB) && <option value={s.schemaB}>{s.schemaB}</option>}
            </select>
          </div>
          <div className="cmp-src"><span /><TablePicker s={s} /></div>
          {!!s.sql && !s.name && <span className="hint">Not a single-table SELECT: B runs the same SQL. Editing is off.</span>}
        </fieldset>
        <fieldset>
          <legend>Match rows by</legend>
          {cols.map((c, i) => (
            <label key={c.name} className="ck"><input type="checkbox" checked={s.keys.has(i)} onChange={() => toggleCol(tabId, 'keys', i)} /> {c.name}</label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Ignore columns</legend>
          {cols.map((c, i) => (
            <label key={c.name} className="ck"><input type="checkbox" checked={s.ignore.has(i)} onChange={() => toggleCol(tabId, 'ignore', i)} /> {c.name}</label>
          ))}
          <label className="opt"><input type="checkbox" checked={s.opts.hide} onChange={(e) => setOption(tabId, 'hide', e.target.checked)} /> Hide ignored columns in the grid</label>
        </fieldset>
        <fieldset>
          <legend>Values count as equal when</legend>
          <label className="opt"><input type="checkbox" checked={s.opts.trim} onChange={(e) => setOption(tabId, 'trim', e.target.checked)} /> Whitespace differs</label>
          <label className="opt"><input type="checkbox" checked={s.opts.kase} onChange={(e) => setOption(tabId, 'kase', e.target.checked)} /> Case differs</label>
          <label className="opt"><input type="checkbox" checked={s.opts.nul} onChange={(e) => setOption(tabId, 'nul', e.target.checked)} /> NULL vs empty string</label>
        </fieldset>
        <fieldset>
          <legend>JSON and XML values</legend>
          <label className="opt"><input type="checkbox" checked={s.opts.struct} onChange={(e) => setOption(tabId, 'struct', e.target.checked)} /> Compare by structure</label>
          <span className="hint">Key order, attribute order, spaces and line breaks do not count.</span>
          <label className="opt"><input type="checkbox" checked={s.opts.arr} onChange={(e) => setOption(tabId, 'arr', e.target.checked)} /> Array order does not count</label>
          <span className="hint">JSON lists: [&quot;a&quot;, &quot;b&quot;] = [&quot;b&quot;, &quot;a&quot;]. Use it when the items are a set (aliases, roles). Off: item 1 is compared with item 1, item 2 with item 2.</span>
        </fieldset>
        <button className="btn primary" data-testid="compare-run" disabled={s.state === 'loading' || !s.schemaB} onClick={() => void runFromEditor(tabId)}>
          {s.state === 'loading' ? 'Comparing...' : ready ? 'Compare again' : 'Compare'}
        </button>
      </aside>

      <div className="cmp-main">
        {sqlView ? (
          <pre className="cmp-sql" data-testid="compare-sql">{compareSql(s, product)}</pre>
        ) : (
          <>
            {ready && (
              <div className="cmp-sum">
                {(['chg', 'del', 'add', 'same'] as Status[]).map((k) => (
                  <button key={k} className={`chip c-${k}`} aria-pressed={s.filter.has(k)} onClick={() => toggleFilter(tabId, k)}>
                    {SYM[k]} {LBL[k]} <b>{n[k]}</b>
                  </button>
                ))}
                <span className="sp">A: {s.ranA} · {s.A.length} rows &nbsp; B: {s.ranB} · {s.B.length} rows</span>
                <button className="sb" title="Column widths: drag a header border, double-click it to fit"
                  onClick={() => { setWidths({}); saveW(wName, {}); }}>Reset column widths</button>
              </div>
            )}
            {ready && (
              <div className="cmp-acts">
                {s.noEdit ? <span className="lbl">{s.noEdit}</span> : <>
                  <span className="lbl">{chosen.length} selected</span>
                  <button className="sb" disabled={!bulkOk('toB')} onClick={() => bulkAction(tabId, 'toB')}>Copy A → B</button>
                  <button className="sb" disabled={!bulkOk('toA')} onClick={() => bulkAction(tabId, 'toA')}>Copy A ← B</button>
                  <button className="sb dng" disabled={!bulkOk('delA')} onClick={() => bulkAction(tabId, 'delA')}>Delete in A</button>
                  <button className="sb dng" disabled={!bulkOk('delB')} onClick={() => bulkAction(tabId, 'delB')}>Delete in B</button>
                  {(readOnlySide(s, 'A') || readOnlySide(s, 'B')) && (
                    <span className="lbl">{readOnlySide(s, 'A') ? 'A' : 'B'}{readOnlySide(s, 'A') && readOnlySide(s, 'B') ? ' and B are' : ' is'} read-only.</span>
                  )}
                  {stmts.length ? (
                    <span className="pend">
                      <button className="sb lnk" onClick={() => setReview(true)}>{stmts.length} pending change{stmts.length > 1 ? 's' : ''}</button>
                      <button className="sb" onClick={() => discardAll(tabId)}>Discard all</button>
                      <button className="sb pri" data-testid="compare-review" onClick={() => setReview(true)}>Review and save…</button>
                    </span>
                  ) : <span className="pend lbl">No pending changes</span>}
                </>}
              </div>
            )}
            <div className="cmp-grid" ref={gridRef}>
              {s.state === 'idle' && <p className="cmp-empty">Type a SELECT in the editor above, or pick a table. Pick A and B (connection and schema), then click <b>Compare</b> or press Ctrl+Enter. The app runs the query in A and in B and matches the rows by key.</p>}
              {s.state === 'loading' && <p className="cmp-empty">Running the query in A and B...</p>}
              {s.state === 'error' && <p className="cmp-empty err">{s.error}</p>}
              {ready && !s.keys.size && <p className="cmp-empty">Pick at least one column in <b>Match rows by</b>. The app needs it to pair the rows of A and B.</p>}
              {ready && s.keys.size > 0 && (
                <table className="cg" style={{ width: total }}>
                  <colgroup>{ids.map((id) => <col key={id} data-id={id} style={{ width: w(id) }} />)}</colgroup>
                  <thead>
                    <tr>
                      <th className="sel"><input type="checkbox" aria-label="Select all shown rows"
                        checked={shown.length > 0 && shown.every((p) => s.sel.has(p.k))}
                        onChange={(e) => { shown.forEach((p) => (e.target.checked ? s.sel.add(p.k) : s.sel.delete(p.k))); bump(tabId, true); }} /></th>
                      <th className="srt" aria-sort={ariaSort(-1)} title="Click to sort by status" onClick={() => toggleSort(-1)}>{sortMark(-1)}</th>
                      {cols.map((c, i) => !vis.has(i) ? null : (
                        <th key={c.name} className={`srt ${s.keys.has(i) ? 'key' : ''} ${s.ignore.has(i) ? 'ign' : ''} ${s.pk.includes(i) ? 'pk' : ''}`}
                          aria-sort={ariaSort(i)} onClick={() => toggleSort(i)}
                          title={`${c.name} · ${c.typeName}${s.pk.includes(i) ? ' · primary key' : ''}\nClick to sort (A value, else B). Again: descending, then off.`}>
                          {c.name}{sortMark(i)}{resizer(`c${i}`, c.name)}
                        </th>
                      ))}
                      <th className="ra">Actions{resizer('_act', 'Actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((p) => (
                      <Row key={p.k} p={p} checked={s.sel.has(p.k)} isDirty={dirty(p)} rev={s.rev} visKey={visKey} ro={ro} ctx={rowCtx} />
                    ))}
                    {!shown.length && <tr><td colSpan={vis.size + 3} className="muted">No rows for the selected filters.</td></tr>}
                  </tbody>
                </table>
              )}
              {shownAll.length > MAX_SHOWN && <p className="cmp-empty">Showing the first {MAX_SHOWN} of {shownAll.length} rows. Turn off a chip to see fewer.</p>}
            </div>
          </>
        )}
        <div className="cmp-status" data-testid="compare-status">
          {s.msg && <span className={s.msg.err ? 'err' : 'ok'}>{s.msg.text}</span>}
          {ready && <span>Compared {s.A.length} + {s.B.length} rows in {s.ms} ms · {n.chg + n.add + n.del} differences</span>}
        </div>
      </div>
      {edit && editPair && <EditDialog key={`${edit.k}:${edit.col}`} s={s} pair={editPair} col={edit.col} onClose={() => setEdit(null)} />}
      {review && <ReviewDialog s={s} onClose={() => setReview(false)} />}
    </div>
  );
}
