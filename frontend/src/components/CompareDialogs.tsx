// Compare tab dialogs.
// Edit: A and B values in text boxes with a line + word diff behind them, the JSON/XML path table, cell revert, copy arrows.
// Review: pending statements per schema, revert per statement, save (one transaction per schema).
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './FeatureDialogs';
import { fmt } from './gridUtil';
import { compactJson, formatJson, formatXml } from './cellText';
import { parseStruct, plainLines, structDiff, structKind, textDiff, type PairRow, type StructKind } from '../compare/engine';
import {
  applyCell, envNames, pending, readOnlySide, revertCell, revertStmt, saveAll, sideLabel, snapValue, type CompareSession, type Side,
} from '../compare/session';

function pretty(v: unknown, kind: StructKind | undefined): string {
  if (v == null) return '';
  const t = fmt(v);
  try {
    if (kind === 'JSON') return formatJson(t);
    if (kind === 'XML') return formatXml(t);
  } catch {
    /* invalid: as it is */
  }
  return t;
}

const PATHS_H_KEY = 'sqlwb.cmp.pathsH';

function short(v: unknown): string {
  const t = v == null ? 'NULL' : fmt(v);
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
}

function TextBox({ id, value, html, readOnly, onChange, label }: {
  id: string; value: string; html: string; readOnly: boolean; onChange: (v: string) => void; label: string;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const hl = useRef<HTMLPreElement>(null);
  const sync = () => {
    if (ta.current && hl.current) { hl.current.scrollTop = ta.current.scrollTop; hl.current.scrollLeft = ta.current.scrollLeft; }
  };
  useLayoutEffect(sync);
  const digits = String(value.split('\n').length).length;
  return (
    <div className="tb" style={{ ['--gw' as string]: `calc(${Math.max(2, digits)}ch + 12px)` }}>
      <pre className="hl" ref={hl} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
      <textarea id={id} ref={ta} spellCheck={false} value={value} readOnly={readOnly} aria-label={label}
        onScroll={sync} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function EditDialog({ s, pair, col, onClose }: { s: CompareSession; pair: PairRow; col: number; onClose: () => void }) {
  const c = s.columns[col];
  const any = (pair.a ?? pair.b)!;
  const kind = pair.s?.[col]?.kind ?? structKind(any.v[col]);
  const isPk = s.pk.includes(col);
  const ro = (side: Side) => !!s.noEdit || isPk || readOnlySide(s, side);
  const [init, setInit] = useState(() => ({ A: pair.a ? pretty(pair.a.v[col], kind) : '', B: pair.b ? pretty(pair.b.v[col], kind) : '' }));
  const [va, setVa] = useState(init.A);
  const [vb, setVb] = useState(init.B);
  const [, setTick] = useState(0);
  const both = !!(pair.a && pair.b);

  const diff = useMemo(() => (both ? textDiff(va, vb) : null), [both, va, vb]);
  const paths = useMemo(() => {
    if (!both || !kind) return null;
    const pa = parseStruct(va);
    const pb = parseStruct(vb);
    if (!pa || !pb || pa.kind !== pb.kind) return { bad: !pa || pa.kind !== kind ? 'A' : 'B' };
    return { d: structDiff(va, vb, s.opts, envNames(s))! };
  }, [both, kind, va, vb, s]);

  const keyText = [...s.keys].sort((x, y) => x - y).map((i) => fmt(any.v[i])).join(', ');

  const was = (side: Side) => {
    const row = side === 'A' ? pair.a : pair.b;
    if (!row) return null;
    const snap = snapValue(s, side, row.id, col);
    if (!snap.known) return <div className="was"><span className="muted">New row, not saved yet.</span></div>;
    const cur = row.v[col];
    const same = (cur == null && snap.v == null) || (cur != null && snap.v != null && String(cur) === String(snap.v));
    if (same) return null;
    return (
      <div className="was">
        <span>Changed. Saved value: <code>{short(snap.v)}</code></span>
        <button type="button" className="sb rv" onClick={() => {
          revertCell(s.tabId, side, row.id, col);
          const t = pretty(snap.v, kind);
          setInit((x) => ({ ...x, [side]: t }));
          if (side === 'A') setVa(t); else setVb(t);
          setTick((x) => x + 1);
        }}>↶ Revert cell</button>
      </div>
    );
  };

  const toStore = (text: string, orig: unknown): string => {
    // One-line JSON stays one line, as the app stored it.
    if (kind === 'JSON' && !fmt(orig).includes('\n')) {
      try { return compactJson(text); } catch { /* invalid: as typed */ }
    }
    return text;
  };

  const apply = () => {
    const a = pair.a && !ro('A') && va !== init.A ? toStore(va, pair.a.v[col]) : undefined;
    const b = pair.b && !ro('B') && vb !== init.B ? toStore(vb, pair.b.v[col]) : undefined;
    if (a !== undefined || b !== undefined) applyCell(s.tabId, pair, col, a, b);
    onClose();
  };

  const counts = diff ? (
    <>
      <span className="dc">{diff.del ? <span className="m">−{diff.del}</span> : null}</span>
    </>
  ) : null;
  const countsB = diff ? (
    <span className="dc">{diff.add ? <span className="p">+{diff.add}</span>
      : !diff.del ? <span className="muted">{va === vb ? 'identical' : 'same lines, only order or spaces differ'}</span> : null}
      {diff.mv && va !== vb ? <span className="mv" title="Dotted lines: the line moved, or differs only by spaces or a trailing comma">
        {' '}· {diff.mv} moved</span> : null}</span>
  ) : null;

  // Drag bar between the path table and the edit boxes. The height is kept in this browser.
  const [pathsH, setPathsH] = useState<number | null>(() => {
    try { const v = Number(localStorage.getItem(PATHS_H_KEY)); return v > 0 ? v : null; } catch { return null; }
  });
  const pathsRef = useRef<HTMLDivElement>(null);
  const keepH = (v: number | null) => {
    setPathsH(v);
    try { if (v == null) localStorage.removeItem(PATHS_H_KEY); else localStorage.setItem(PATHS_H_KEY, String(v)); } catch { /* storage off */ }
  };
  const clampH = (v: number) => {
    const dlg = pathsRef.current?.closest('.cmp-dlg') as HTMLElement | null;
    const max = dlg ? Math.max(60, dlg.clientHeight - 260) : 600;
    return Math.round(Math.max(60, Math.min(max, v)));
  };
  const splitter = (
    <div className="cmp-split" role="separator" aria-orientation="horizontal" tabIndex={0}
      aria-label="Resize the path table and the edit boxes"
      title="Drag to give more room to the path table or the edit boxes. Double-click to reset. Arrow keys: ±20 px."
      onPointerDown={(e) => {
        e.preventDefault();
        const y0 = e.clientY;
        const h0 = pathsRef.current?.offsetHeight ?? 150;
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        el.classList.add('on');
        let last = h0;
        const move = (ev: PointerEvent) => { last = clampH(h0 + ev.clientY - y0); setPathsH(last); };
        const end = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', end);
          el.removeEventListener('pointercancel', end);
          el.classList.remove('on');
          keepH(last);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);
      }}
      onDoubleClick={() => keepH(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          keepH(clampH((pathsRef.current?.offsetHeight ?? 150) + (e.key === 'ArrowDown' ? 20 : -20)));
        }
      }} />
  );

  return (
    <Modal title={`Edit ${c?.name ?? 'value'}`} onClose={onClose} xl sizeKey="compare-edit" maximizable
      titleNode={<>{c?.name} · <b>{keyText}</b>{kind ? ` · ${kind}` : ''}{isPk && <span className="muted"> · primary key, read-only</span>}</>}>
      <div className="cmp-dlg" data-testid="compare-edit">
        {both && kind && (
          <div className={`cmp-paths${pathsH != null ? ' fixed' : ''}`} ref={pathsRef} style={pathsH != null ? { height: pathsH } : undefined}>
            <div className="dsec">Differences by path · {paths && 'd' in paths && paths.d
              ? (paths.d.ch.length ? <span className="c-chg">{paths.d.ch.length} difference{paths.d.ch.length > 1 ? 's' : ''}</span> : <span className="c-add">no differences</span>)
              : null} <span className="hint0">Updates as you edit. Apply keeps it.</span></div>
            <div className="tw">
              <table className="paths">
                <thead><tr><th>Path</th><th>A · {sideLabel(s, 'A')}</th><th>B · {sideLabel(s, 'B')}</th></tr></thead>
                <tbody>
                  {paths && 'bad' in paths && <tr><td colSpan={3} className="none">{paths.bad} is not valid {kind}. Fix it to see the differences.</td></tr>}
                  {paths && 'd' in paths && paths.d && (paths.d.ch.length ? paths.d.ch.map((x) => (
                    <tr key={x.p}><td>{x.p}</td>
                      <td className={x.a == null ? 'none' : 'va'}>{x.a ?? 'missing'}</td>
                      <td className={x.b == null ? 'none' : 'vb'}>{x.b ?? 'missing'}</td></tr>
                  )) : (
                    <tr><td colSpan={3} className="none">{va.trim() === vb.trim() ? 'The values are the same.'
                      : `Same content. Only the format differs (${kind === 'JSON' ? 'key order, spaces' : 'attribute order, spaces, line breaks'}).`}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {both && kind && splitter}
        <div className="dsec">Edit values</div>
        <div className={`ed${both ? '' : ' one'}`}>
          {pair.a && (
            <div className="ed-side">
              <label className="lab" htmlFor="cmp-eA">A · {sideLabel(s, 'A')}{counts}{ro('A') && !isPk ? <span className="muted"> · read-only</span> : null}</label>
              <TextBox id="cmp-eA" label="Value in A" value={va} readOnly={ro('A')} onChange={setVa} html={diff ? diff.ha : plainLines(va)} />
              {was('A')}
            </div>
          )}
          {both && (
            <div className="mid">
              <button type="button" className="sb cp" disabled={ro('B')} title="Copy the A value into B" aria-label="Copy A value into B" onClick={() => setVb(va)}>
                <span className="ah">→</span><span className="av">↓</span></button>
              <button type="button" className="sb cp" disabled={ro('A')} title="Copy the B value into A" aria-label="Copy B value into A" onClick={() => setVa(vb)}>
                <span className="ah">←</span><span className="av">↑</span></button>
            </div>
          )}
          {pair.b && (
            <div className="ed-side">
              <label className="lab" htmlFor="cmp-eB">B · {sideLabel(s, 'B')}{countsB}{ro('B') && !isPk ? <span className="muted"> · read-only</span> : null}</label>
              <TextBox id="cmp-eB" label="Value in B" value={vb} readOnly={ro('B')} onChange={setVb} html={diff ? diff.hb : plainLines(vb)} />
              {was('B')}
            </div>
          )}
        </div>
        <span className="hint0">Apply keeps the change as pending. Nothing goes to the database until you save.</span>
        <div className="form-buttons">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" data-testid="compare-apply" onClick={apply} disabled={ro('A') && ro('B')}>Apply</button>
        </div>
      </div>
    </Modal>
  );
}

export function ReviewDialog({ s, onClose }: { s: CompareSession; onClose: () => void }) {
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const st = pending(s);
  const sides = (['A', 'B'] as Side[]).filter((x) => st.some((y) => y.side === x));
  const save = async () => {
    setBusy(true);
    const ok = await saveAll(s.tabId);
    setBusy(false);
    if (ok) onClose(); else setTick((x) => x + 1);
  };
  return (
    <Modal title="Pending changes" onClose={onClose} xl sizeKey="compare-review" maximizable>
      <div className="cmp-dlg" data-testid="compare-review-dialog">
        {st.length ? (
          <p className="dialog-text">{st.length} statement{st.length > 1 ? 's' : ''} in {sides.length} schema{sides.length > 1 ? 's' : ''}.
            Each schema runs in one transaction and commits. If a statement fails, that transaction rolls back.
            Revert a statement to leave it out.</p>
        ) : <p className="dialog-text">No pending changes.</p>}
        {s.msg?.err && <div className="cell-dlg-note err">{s.msg.text}</div>}
        <div className="slist">
          {sides.map((side) => (
            <div key={side} className="sgroup">
              <div className="dsec">{side} · {sideLabel(s, side)}{readOnlySide(s, side) ? ' · read-only' : ''}</div>
              {st.filter((x) => x.side === side).map((x) => (
                <div key={`${x.side}${x.id}${x.op}`} className="item">
                  <div className="ih">
                    <span className={`tt t-${x.op}`}>{x.op}</span><span>{x.label}</span>
                    <button className="sb rv" onClick={() => { revertStmt(s.tabId, x.side, x.id); setTick((t) => t + 1); }}>↶ Revert</button>
                  </div>
                  <pre>{x.sql}</pre>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="form-buttons">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" data-testid="compare-save" disabled={!st.length || busy} onClick={() => void save()}>
            {busy ? 'Saving...' : 'Save and commit'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
