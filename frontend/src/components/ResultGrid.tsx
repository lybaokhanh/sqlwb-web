// Virtual-scroll result grid. Renders only the visible rows (+ overscan),
// so 100k x 20 stays smooth. Fixed row height, sticky header and row numbers.
// Results of a single-table SELECT can be edited (double-click a cell).
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ResultSet } from '../state/store';
import { fetchMore, updateTab, useStore } from '../state/store';
import { rowsOf } from '../state/rows';
import { cellValue, editsOf, setCell } from '../state/edits';
import { ROW_H, ROWNUM_W, defaultWidths, fmt, isNumeric } from './gridUtil';

const OVERSCAN = 8;
/** Rows before the end of the loaded rows at which the next page is fetched. */
const NEAR_END = 200;

interface Props { tabId: string; result: ResultSet; filterText: string }

export const ResultGrid = memo(function ResultGrid({ tabId, result, filterText }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [editing, setEditing] = useState<{ row: number; col: number } | null>(null);
  const [liveWidths, setLiveWidths] = useState<number[] | null>(null);
  const defW = useMemo(() => defaultWidths(result), [result.columns]);
  const numeric = useMemo(() => result.columns.map((c) => isNumeric(c.jdbcType)), [result.columns]);
  const widths = liveWidths ?? result.widths ?? defW;
  const totalW = ROWNUM_W + widths.reduce((a, b) => a + b, 0);
  const editable = !!result.table;
  const selRow = result.sel ?? null;
  const edits = editsOf(result.id);

  const select = (i: number) => {
    if (result.sel === i) return;
    updateTab(tabId, (t) => ({ results: t.results.map((r) => (r.id === result.id ? { ...r, sel: i } : r)) }));
  };

  // Row index list when a filter is on. Recomputed when rows arrive.
  const index = useMemo(() => {
    const f = filterText.trim().toLowerCase();
    if (!f) return null;
    const out: number[] = [];
    for (let i = 0; i < result.rowCount; i++) {
      for (let c = 0; c < result.columns.length; c++) {
        const v = cellValue(result.id, i, c);
        if (v != null && String(v).toLowerCase().includes(f)) { out.push(i); break; }
      }
    }
    return out;
  }, [filterText, result.id, result.rowCount, result.version, result.columns.length]);

  const count = index ? index.length : result.rowCount;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setLiveWidths(null);
    setEditing(null);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [result.id]);

  // Keep a new (inserted) row in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || result.sel == null) return;
    const top = result.sel * ROW_H;
    if (top < el.scrollTop || top + ROW_H * 2 > el.scrollTop + el.clientHeight) {
      if (edits.inserted.has(result.sel)) el.scrollTop = Math.max(0, top - el.clientHeight / 2);
    }
  }, [result.sel, edits]);

  const raf = useRef(0);
  const onScroll = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
    });
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(count, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN);
  // Fetch on scroll: the next page when the view is near the end of the loaded rows.
  const nearEnd = !result.done && last + NEAR_END >= count;
  useEffect(() => { if (nearEnd) fetchMore(tabId, result.id); }, [nearEnd, result.rowCount, tabId, result.id]);
  const rows = rowsOf(result.id);
  const visible: JSX.Element[] = [];
  for (let v = first; v < last; v++) {
    const i = index ? index[v] : v;
    const ch = edits.changed.get(i);
    const state = `${edits.deleted.has(i) ? 'd' : ''}${edits.inserted.has(i) ? 'i' : ''}${ch ? [...ch.entries()].map(([c, x]) => `${c}=${String(x)}`).join('|') : ''}`;
    visible.push(
      <GridRow key={i} top={v * ROW_H} rowIndex={i} resultId={result.id} data={rows[i]} widths={widths} totalW={totalW}
        cols={result.columns.length} numeric={numeric} selected={selRow === i} odd={v % 2 === 1}
        state={state} changed={ch} deleted={edits.deleted.has(i)} inserted={edits.inserted.has(i)}
        editCol={editing?.row === i ? editing.col : -1}
        onSelect={() => select(i)}
        onEdit={editable ? (c) => setEditing({ row: i, col: c }) : undefined}
        onCommit={(c, val) => {
          setEditing(null);
          if (val !== undefined) {
            const n = numeric[c] && val !== '' && !isNaN(Number(val)) ? Number(val) : val === '' && numeric[c] ? null : val;
            setCell(tabId, result.id, i, c, n);
          }
          scrollRef.current?.focus();
        }} />,
    );
  }

  // Column resize by dragging the header edge.
  const startResize = (ci: number, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const base = [...widths];
    const move = (ev: PointerEvent) => {
      const w = [...base];
      w[ci] = Math.max(40, base[ci] + ev.clientX - x0);
      setLiveWidths(w);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const w = [...base];
      w[ci] = Math.max(40, base[ci] + ev.clientX - x0);
      const t = useStore.getState().tabs.find((x) => x.id === tabId);
      if (t) updateTab(tabId, { results: t.results.map((r) => (r.id === result.id ? { ...r, widths: w } : r)) });
      setLiveWidths(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing || selRow == null) return;
    if (e.key === 'ArrowDown' && selRow < result.rowCount - 1) { e.preventDefault(); select(selRow + 1); }
    if (e.key === 'ArrowUp' && selRow > 0) { e.preventDefault(); select(selRow - 1); }
  };

  return (
    <div className={`grid-scroll${editable ? ' editable' : ''}`} ref={scrollRef} onScroll={onScroll} onKeyDown={onKeyDown}
      data-testid="grid" tabIndex={0}>
      <div className="grid-head" style={{ width: totalW }}>
        <div className="cell rownum head" style={{ width: ROWNUM_W }} title={editable ? `Editable: ${result.table}` : 'Read only'}>
          {editable ? '✎' : ''}
        </div>
        {result.columns.map((c, ci) => (
          <div key={ci} className={`cell head${isNumeric(c.jdbcType) ? ' num' : ''}`} style={{ width: widths[ci] }}
            title={`${c.name}\n${c.typeName}${c.nullable ? '' : ' NOT NULL'}`}>
            <span className="head-name">{c.name}</span>
            <span className="col-resize" onPointerDown={(e) => startResize(ci, e)} />
          </div>
        ))}
      </div>
      <div className="grid-body" style={{ height: count * ROW_H, width: totalW }}>
        {visible}
      </div>
    </div>
  );
});

interface RowProps {
  top: number; rowIndex: number; resultId: string; data: unknown[] | undefined; widths: number[]; totalW: number;
  cols: number; numeric: boolean[]; selected: boolean; odd: boolean;
  state: string; changed?: Map<number, unknown>; deleted: boolean; inserted: boolean; editCol: number;
  onSelect: () => void; onEdit?: (col: number) => void; onCommit: (col: number, value: string | undefined) => void;
}

const GridRow = memo(function GridRow(p: RowProps) {
  const cells: JSX.Element[] = [];
  for (let c = 0; c < p.cols; c++) {
    const isChanged = !!p.changed?.has(c);
    const v = isChanged ? p.changed!.get(c) : p.data?.[c];
    if (p.editCol === c) {
      cells.push(
        <div key={c} className="cell editing" style={{ width: p.widths[c] }}>
          <input className="cell-input" autoFocus defaultValue={v == null ? '' : fmt(v)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') p.onCommit(c, e.currentTarget.value);
              if (e.key === 'Escape') p.onCommit(c, undefined);
            }}
            onBlur={(e) => p.onCommit(c, e.currentTarget.value)} />
        </div>,
      );
      continue;
    }
    cells.push(
      <div key={c} className={`cell${p.numeric[c] ? ' num' : ''}${v == null ? ' null' : ''}${isChanged ? ' changed' : ''}`}
        style={{ width: p.widths[c] }} onDoubleClick={p.onEdit && !p.deleted ? () => p.onEdit!(c) : undefined}>
        {v == null ? (p.data ? 'NULL' : '') : fmt(v)}
      </div>,
    );
  }
  return (
    <div className={`grid-row${p.odd ? ' odd' : ''}${p.selected ? ' sel' : ''}${p.deleted ? ' deleted' : ''}${p.inserted ? ' inserted' : ''}`}
      style={{ top: p.top, width: p.totalW }} onMouseDown={p.onSelect}>
      <div className="cell rownum" style={{ width: ROWNUM_W }}>{p.inserted ? '*' : p.rowIndex + 1}</div>
      {cells}
    </div>
  );
}, (a, b) => a.top === b.top && a.rowIndex === b.rowIndex && a.data === b.data && a.widths === b.widths
  && a.selected === b.selected && a.odd === b.odd && a.state === b.state && a.editCol === b.editCol
  && (a.onEdit === undefined) === (b.onEdit === undefined));
