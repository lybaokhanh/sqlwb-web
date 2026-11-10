// Dialogs for v3 features: confirm, key columns, macros, bookmarks, export.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileInfo, Macro } from '../api/protocol';
import { client } from '../api/client';
import { answerVars, useStore, type Dialog } from '../state/store';
import { findBookmarks, jumpTo, runMacro, saveMacros } from '../state/features';
import { buildText, download, fileBase, loadAllRows, type ExportFormat } from '../state/exporter';

const close = () => useStore.setState({ dialog: null });

// ---- Escape ----
// Open dialogs (and the command palette), last opened at the end.
// One window listener closes only the top entry, also when the focus is outside the dialog.
// An entry with `above` (the command palette) is drawn above all dialogs, so it closes first.
const escStack: { close: () => void; above: boolean }[] = [];

function onEscape(e: KeyboardEvent) {
  // An inner widget (Monaco, a key recorder) that uses Escape calls preventDefault.
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  // Escape that cancels IME input (e.g. Vietnamese Telex) does not close the dialog.
  if (e.isComposing || e.keyCode === 229) return;
  const top = [...escStack].reverse().find((x) => x.above) ?? escStack[escStack.length - 1];
  if (!top) return;
  e.preventDefault();
  top.close();
}

/**
 * Escape anywhere on the page calls onClose while this component is the top dialog.
 * above: the component is drawn above all dialogs (the command palette).
 */
export function useEscapeClose(onClose: () => void, above = false) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    const entry = { close: () => ref.current(), above };
    escStack.push(entry);
    if (escStack.length === 1) window.addEventListener('keydown', onEscape);
    return () => {
      const i = escStack.indexOf(entry);
      if (i >= 0) escStack.splice(i, 1);
      if (!escStack.length) window.removeEventListener('keydown', onEscape);
    };
  }, [above]);
}

// ---- Dialog size ----
// The user can resize each dialog with the corner grip. The size is kept per dialog kind
// in localStorage (per browser, because it depends on the screen). Double-click the grip: default size.
type Size = { w: number; h: number };
const SIZE_PREFIX = 'sqlwb.dialogSize.';
const MIN_W = 280;
const MIN_H = 140;
const MARGIN = 24; // matches max-height: calc(100vh - 48px) in styles.css

function clampSize(s: Size): Size {
  const maxW = Math.max(MIN_W, window.innerWidth - 2 * MARGIN);
  const maxH = Math.max(MIN_H, window.innerHeight - 2 * MARGIN);
  return {
    w: Math.round(Math.min(maxW, Math.max(MIN_W, s.w))),
    h: Math.round(Math.min(maxH, Math.max(MIN_H, s.h))),
  };
}

function loadSize(key: string): Size | null {
  try {
    const v = JSON.parse(localStorage.getItem(SIZE_PREFIX + key) ?? 'null') as Partial<Size> | null;
    if (v && Number.isFinite(v.w) && Number.isFinite(v.h)) return clampSize(v as Size);
  } catch { /* storage blocked or bad value */ }
  return null;
}

const MAX_PREFIX = 'sqlwb.dialogMax.';
function loadMax(key: string): boolean {
  try { return localStorage.getItem(MAX_PREFIX + key) === '1'; } catch { return false; }
}
function saveMax(key: string, on: boolean) {
  try {
    if (on) localStorage.setItem(MAX_PREFIX + key, '1');
    else localStorage.removeItem(MAX_PREFIX + key);
  } catch { /* storage blocked */ }
}

function saveSize(key: string, s: Size | null) {
  try {
    if (s) localStorage.setItem(SIZE_PREFIX + key, JSON.stringify(s));
    else localStorage.removeItem(SIZE_PREFIX + key);
  } catch { /* storage blocked */ }
}

/**
 * Dialog frame. Escape closes it from anywhere on the page. The user can resize it.
 * sizeKey: stable name for the saved size. Set it when the title changes (e.g. contains a name).
 */
export function Modal({ title, onClose, children, wide, xl, sizeKey, maximizable, titleNode }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; xl?: boolean; sizeKey?: string;
  /** Title bar gets a maximize button; a double-click on the title also maximizes. Kept per dialog. */
  maximizable?: boolean;
  /** Rich title (the plain title stays the accessible name). */
  titleNode?: React.ReactNode;
}) {
  const key = sizeKey ?? title;
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(() => loadSize(key));
  const [max, setMax] = useState<boolean>(() => !!maximizable && loadMax(key));
  const toggleMax = () => setMax((m) => { saveMax(key, !m); return !m; });
  useEscapeClose(onClose);

  // Move the focus into the dialog when no element inside took it (autoFocus).
  useEffect(() => {
    const el = box.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, []);

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = box.current;
    if (e.button !== 0 || !el) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    let last: Size | null = null;
    // The dialog stays centered, so each edge moves by half the size change: use 2x the mouse move.
    const move = (ev: PointerEvent) => {
      last = clampSize({ w: r.width + 2 * (ev.clientX - x0), h: r.height + 2 * (ev.clientY - y0) });
      setSize(last);
    };
    const end = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      if (last) saveSize(key, last);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  };
  const resetSize = () => { setSize(null); saveSize(key, null); };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} className={`modal${wide ? ' wide' : ''}${xl ? ' xl' : ''}${size || max ? ' sized' : ''}${max ? ' max' : ''}`}
        role="dialog" aria-label={title} style={size && !max ? { width: size.w, height: size.h } : undefined}>
        {maximizable ? (
          <div className="modal-title bar" onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button')) toggleMax(); }}>
            <span className="modal-title-text">{titleNode ?? title}</span>
            <button type="button" className="modal-x" onClick={toggleMax} aria-label={max ? 'Restore size' : 'Maximize'}
              title="Maximize or restore (or double-click the title bar)">{max ? '⤡' : '⤢'}</button>
            <button type="button" className="modal-x" onClick={onClose} aria-label="Close">✕</button>
          </div>
        ) : <div className="modal-title">{title}</div>}
        <div className="modal-body">{children}</div>
        <div className="modal-grip" data-testid="modal-grip" title="Drag to resize. Double-click: default size."
          onPointerDown={startResize} onDoubleClick={resetSize} />
      </div>
    </div>
  );
}

export function ConfirmDialog({ d }: { d: Extract<Dialog, { kind: 'confirm' }> }) {
  const cancel = () => { close(); d.onCancel?.(); };
  return (
    <Modal title={d.title} onClose={cancel} wide={!!d.pre} sizeKey={d.pre ? 'confirm-sql' : 'confirm'}>
      {d.danger && <div className="load-warning">{d.text}</div>}
      {!d.danger && <p className="dialog-text">{d.text}</p>}
      {d.pre && <pre className="confirm-sql" data-testid="confirm-sql">{d.pre}</pre>}
      <div className="form-buttons">
        <button className="btn" onClick={cancel}>Cancel</button>
        <button className={`btn ${d.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => { close(); d.onOk(); }}>{d.okLabel ?? 'OK'}</button>
      </div>
    </Modal>
  );
}

/** Values for :name / $[?name] variables. Enter = OK, Escape = Cancel (the run stops). */
export function VarsDialog({ d }: { d: Extract<Dialog, { kind: 'vars' }> }) {
  const [values, setValues] = useState(d.values);
  const cancel = () => answerVars(d.tabId, d.reqId, null);
  const sql = d.sql.length > 600 ? `${d.sql.slice(0, 600)}...` : d.sql;
  return (
    <Modal title="Variable values" onClose={cancel} wide>
      <form className="form" data-testid="vars-dialog" onSubmit={(e) => { e.preventDefault(); answerVars(d.tabId, d.reqId, values); }}>
        {sql && <pre className="confirm-sql">{sql}</pre>}
        {d.names.map((n, i) => (
          <label key={n}>
            :{n}
            <input name={`var-${n}`} className="mono" autoFocus={i === 0} value={values[n] ?? ''}
              onChange={(e) => setValues({ ...values, [n]: e.target.value })} onFocus={(e) => e.currentTarget.select()} />
          </label>
        ))}
        <div className="form-note">Values are sent as text. Define fixed values with WbVarDef name=value.</div>
        <div className="form-buttons">
          <button type="button" className="btn" onClick={cancel}>Cancel</button>
          <button type="submit" className="btn primary">Execute</button>
        </div>
      </form>
    </Modal>
  );
}

export function KeysDialog({ d }: { d: Extract<Dialog, { kind: 'keys' }> }) {
  const r = useStore((s) => s.tabs.find((t) => t.id === d.tabId)?.results.find((x) => x.id === d.resultId));
  const [picked, setPicked] = useState<string[]>([]);
  const cancel = () => { close(); d.onOk([]); };
  if (!r) return null;
  return (
    <Modal title="Define Key Columns" onClose={cancel}>
      <p className="dialog-text">{r.table} has no primary key. Select the columns that identify a row.</p>
      <div className="keys-list">
        {r.columns.map((c) => (
          <label key={c.name} className="check">
            <input type="checkbox" checked={picked.includes(c.name)}
              onChange={(e) => setPicked(e.target.checked ? [...picked, c.name] : picked.filter((x) => x !== c.name))} />
            {c.name} <span className="muted">{c.typeName}</span>
          </label>
        ))}
      </div>
      <div className="form-buttons">
        <button className="btn" onClick={cancel}>Cancel</button>
        <button className="btn primary" disabled={!picked.length} onClick={() => { close(); d.onOk(picked); }}>OK</button>
      </div>
    </Modal>
  );
}

export function MacrosDialog() {
  const macros = useStore((s) => s.macros);
  const [sel, setSel] = useState(macros.length ? 0 : -1);
  const cur: Macro = sel >= 0 && macros[sel] ? macros[sel] : { name: '', sql: '', shortcut: '' };
  const [form, setForm] = useState<Macro>(cur);
  useEffect(() => { setForm(sel >= 0 && macros[sel] ? macros[sel] : { name: '', sql: '', shortcut: '' }); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    const m: Macro = { name: form.name.trim(), sql: form.sql, shortcut: form.shortcut?.trim() || undefined };
    if (!m.name) return;
    const list = [...macros];
    if (sel >= 0) list[sel] = m; else list.push(m);
    saveMacros(list);
    setSel(sel >= 0 ? sel : list.length - 1);
  };
  const remove = () => {
    if (sel < 0) return;
    saveMacros(macros.filter((_, i) => i !== sel));
    setSel(-1);
  };
  return (
    <Modal title="Manage macros" onClose={close} wide>
      <div className="macros">
        <div className="macro-list" role="listbox" aria-label="Macros">
          {macros.map((m, i) => (
            <div key={i} role="option" aria-selected={i === sel} className={`ex-item${i === sel ? ' sel' : ''}`} onClick={() => setSel(i)}>
              <span className="ex-name">{m.name}</span><span className="ex-type">{m.shortcut ?? ''}</span>
            </div>
          ))}
          {macros.length === 0 && <div className="msg muted pad">No macros yet.</div>}
          <button className="link-btn" onClick={() => setSel(-1)}>+ New macro</button>
        </div>
        <div className="form macro-form">
          <label>Name<input name="macroName" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>SQL<textarea name="macroSql" className="mono" rows={7} value={form.sql} spellCheck={false}
            onChange={(e) => setForm({ ...form, sql: e.target.value })} /></label>
          <label>Shortcut (e.g. Ctrl+Alt+1)<input name="macroShortcut" value={form.shortcut ?? ''} onChange={(e) => setForm({ ...form, shortcut: e.target.value })} /></label>
        </div>
      </div>
      <div className="form-buttons">
        <button className="btn" disabled={sel < 0} onClick={remove}>Delete</button>
        <span className="spacer" />
        <button className="btn" disabled={!form.sql.trim()} onClick={() => { close(); runMacro(form, 'insert'); }}>Insert</button>
        <button className="btn" disabled={!form.sql.trim()} onClick={() => { close(); runMacro(form, 'run'); }}>Run</button>
        <button className="btn primary" disabled={!form.name.trim()} onClick={save}>Save</button>
        <button className="btn" onClick={close}>Close</button>
      </div>
    </Modal>
  );
}

export function BookmarksDialog() {
  const all = useMemo(findBookmarks, []);
  const [q, setQ] = useState('');
  const list = all.filter((b) => `${b.name} ${b.tabTitle}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title="Bookmarks" onClose={close} wide>
      <input autoFocus className="wide-input" placeholder="Filter bookmarks" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) { close(); jumpTo(list[0]); } }} />
      <div className="bm-list" role="listbox" aria-label="Bookmarks">
        {list.map((b, i) => (
          <div key={i} role="option" aria-selected={false} className="ex-item" onClick={() => { close(); jumpTo(b); }}>
            <span className="ex-name">{b.name}</span><span className="ex-type">{b.tabTitle}, line {b.line}</span>
          </div>
        ))}
        {list.length === 0 && <div className="msg muted pad">No bookmarks. Add a line "-- @WbTag name" to the SQL.</div>}
      </div>
      <div className="form-buttons"><button className="btn" onClick={close}>Close</button></div>
    </Modal>
  );
}

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** The user's file area on the server: WbExport writes here, WbImport and WbInclude read here. */
export function FilesDialog() {
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const [error, setError] = useState('');
  const upRef = useRef<HTMLInputElement>(null);
  const run = useCallback(async (f: () => Promise<unknown>) => {
    try {
      await f();
      setFiles(await client.listFiles());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => { void run(async () => undefined); }, [run]);
  const upload = (list: FileList | null) => {
    const all = [...(list ?? [])];
    if (all.length) void run(() => Promise.all(all.map((f) => client.uploadFile(f.name, f))));
  };
  const open = (name: string) => {
    const a = document.createElement('a');
    a.href = client.fileUrl(name);
    a.download = name.split('/').pop() ?? name;
    a.click();
  };
  return (
    <Modal title="Files" onClose={close} wide>
      <p className="dialog-text muted">Your file area on the server. Use names relative to it, e.g. <code>WbExport -type=text -file=export/emp.csv;</code> or <code>WbImport -file=load.csv -table=emp;</code></p>
      <div className="files-list" data-testid="files-list">
        {files?.map((f) => (
          <div key={f.name} className="files-row">
            <button className="link-btn" title="Download" onClick={() => open(f.name)}>{f.name}</button>
            <span className="muted">{kb(f.size)}</span>
            <span className="muted">{new Date(f.modified).toLocaleString()}</span>
            <button className="btn" aria-label={`Delete ${f.name}`} onClick={() => void run(() => client.deleteFile(f.name))}>Delete</button>
          </div>
        ))}
        {files?.length === 0 && <div className="msg muted pad">No files yet.</div>}
        {!files && !error && <div className="msg muted pad">Loading...</div>}
      </div>
      {error && <div className="cm-test err">{error}</div>}
      <div className="form-buttons">
        <button className="btn" onClick={() => upRef.current?.click()}>Upload... (max. 20 MB)</button>
        <input ref={upRef} type="file" multiple hidden data-testid="files-upload" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
        <button className="btn" onClick={() => void run(async () => undefined)}>Refresh</button>
        <span className="spacer" />
        <button className="btn" onClick={close}>Close</button>
      </div>
    </Modal>
  );
}

const FORMATS: { id: ExportFormat; label: string; ext: string; mime: string }[] = [
  { id: 'csv', label: 'CSV (comma)', ext: 'csv', mime: 'text/csv' },
  { id: 'tsv', label: 'Text (tab)', ext: 'tsv', mime: 'text/tab-separated-values' },
  { id: 'sql', label: 'SQL INSERT', ext: 'sql', mime: 'application/sql' },
];

export function ExportDialog({ d }: { d: Extract<Dialog, { kind: 'export' }> }) {
  const [fmt, setFmt] = useState<ExportFormat>('csv');
  const [prog, setProg] = useState<{ n: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const r = await loadAllRows(d.tabId, d.resultId, (n, total) => setProg({ n, total }));
    setBusy(false);
    if (!r) return;
    const f = FORMATS.find((x) => x.id === fmt)!;
    download(buildText(r, fmt), `${fileBase(r)}.${f.ext}`, f.mime);
    close();
  };
  const pct = prog && prog.total > 0 ? Math.min(100, (prog.n / prog.total) * 100) : null;
  return (
    <Modal title="Save data as" onClose={close}>
      <div className="form">
        {FORMATS.map((f) => (
          <label key={f.id} className="check">
            <input type="radio" name="fmt" checked={fmt === f.id} onChange={() => setFmt(f.id)} />{f.label}
          </label>
        ))}
        {prog && (
          <div className="progress" data-testid="export-progress">
            <div className="progress-bar" style={{ width: pct != null ? `${pct}%` : '100%' }} data-indeterminate={pct == null} />
            <span>{prog.n} rows{prog.total > 0 ? ` of ${prog.total}` : ''}</span>
          </div>
        )}
      </div>
      <div className="form-buttons">
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={() => void go()}>{busy ? 'Loading rows...' : 'Save'}</button>
      </div>
    </Modal>
  );
}
