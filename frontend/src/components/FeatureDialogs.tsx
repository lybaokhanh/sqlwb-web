// Dialogs for v3 features: confirm, key columns, macros, bookmarks, export.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileInfo, Macro } from '../api/protocol';
import { client } from '../api/client';
import { useStore, type Dialog } from '../state/store';
import { findBookmarks, jumpTo, runMacro, saveMacros } from '../state/features';
import { buildText, download, fileBase, loadAllRows, type ExportFormat } from '../state/exporter';

const close = () => useStore.setState({ dialog: null });

export function Modal({ title, onClose, children, wide, xl }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; xl?: boolean }) {
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}${xl ? ' xl' : ''}`} role="dialog" aria-label={title}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ d }: { d: Extract<Dialog, { kind: 'confirm' }> }) {
  const cancel = () => { close(); d.onCancel?.(); };
  return (
    <Modal title={d.title} onClose={cancel} wide={!!d.pre}>
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
