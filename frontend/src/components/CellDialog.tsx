// Cell dialog: a long value (JSON, XML, SQL, text) in a Monaco editor with format and syntax colors.
// Editable results: Save writes the value to the grid as a pending change (Save changes sends it to the DB).
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatSql, useStore, type Dialog } from '../state/store';
import { cellValue, editsOf, setCell } from '../state/edits';
import { Modal } from './FeatureDialogs';
import { cellText, compactJson, detectLang, formatJson, formatXml, isTruncated, type CellLang } from './cellText';

const close = () => useStore.setState({ dialog: null });

type CellEditor = {
  getText(): string; setText(t: string): void; setLanguage(l: string): void;
  onChange(f: () => void): { dispose(): void }; dispose(): void;
};

const LANGS: { id: CellLang; label: string }[] = [
  { id: 'json', label: 'JSON' }, { id: 'xml', label: 'XML' }, { id: 'sql', label: 'SQL' }, { id: 'plaintext', label: 'Text' },
];

function pretty(text: string, lang: CellLang): string {
  try {
    if (lang === 'json') return formatJson(text);
    if (lang === 'xml') return formatXml(text);
  } catch {
    /* invalid: show as it is */
  }
  return text;
}

export function CellDialog({ d }: { d: Extract<Dialog, { kind: 'cell' }> }) {
  const r = useStore((s) => s.tabs.find((t) => t.id === d.tabId)?.results.find((x) => x.id === d.resultId));
  const orig = useMemo(() => cellValue(d.resultId, d.row, d.col), [d.resultId, d.row, d.col]);
  const text0 = useMemo(() => cellText(orig), [orig]);
  const truncated = isTruncated(orig);
  const editable = !!r?.table && !truncated && !editsOf(d.resultId).deleted.has(d.row);
  const [lang, setLang] = useState<CellLang>(() => detectLang(text0));
  // Keep the storage style: one-line JSON stays one line when saved.
  const [compact, setCompact] = useState(() => !text0.includes('\n'));
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<{ err?: boolean; text: string } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<CellEditor | null>(null);

  useEffect(() => {
    let gone = false;
    let sub: { dispose(): void } | undefined;
    import('../editor/monacoEditor').then((m) => {
      if (gone || !host.current) return;
      api.current = m.mountCellEditor(host.current, pretty(text0, lang), lang, !editable);
      sub = api.current.onChange(() => setDirty(true));
    }).catch(() => setNote({ err: true, text: 'Editor could not load.' }));
    return () => {
      gone = true;
      sub?.dispose();
      api.current?.dispose();
      api.current = null;
    };
    // Mount once per dialog. Language changes go through setLanguage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!r) return null;
  const col = r.columns[d.col];

  const changeLang = (l: CellLang) => {
    setLang(l);
    api.current?.setLanguage(l);
  };

  const format = async () => {
    const ed = api.current;
    if (!ed) return;
    setNote(null);
    try {
      if (lang === 'json') ed.setText(formatJson(ed.getText()));
      else if (lang === 'xml') ed.setText(formatXml(ed.getText()));
      else if (lang === 'sql') ed.setText(await formatSql(d.tabId, ed.getText()));
    } catch (e) {
      setNote({ err: true, text: `Not valid ${lang.toUpperCase()}: ${(e as Error).message}` });
    }
  };

  const copy = () => {
    const t = api.current?.getText() ?? text0;
    if (!navigator.clipboard?.writeText) { setNote({ err: true, text: 'Clipboard not available (needs https or localhost).' }); return; }
    navigator.clipboard.writeText(t).then(
      () => setNote({ text: 'Copied.' }),
      () => setNote({ err: true, text: 'Clipboard not available (needs https or localhost).' }),
    );
  };

  const save = () => {
    const ed = api.current;
    if (!ed) return;
    let t = ed.getText();
    if (lang === 'json' && compact) {
      try {
        t = compactJson(t);
      } catch (e) {
        setNote({ err: true, text: `Not valid JSON: ${(e as Error).message}. Fix it, or switch to Text to save as it is.` });
        return;
      }
    }
    setCell(d.tabId, d.resultId, d.row, d.col, t);
    close();
  };

  return (
    <Modal title={`${col?.name ?? 'Value'} — row ${d.row + 1}`} onClose={close} xl>
      <div className="cell-dlg" data-testid="cell-dialog">
        <div className="cell-dlg-bar">
          <select aria-label="Language" value={lang} onChange={(e) => changeLang(e.target.value as CellLang)}>
            {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <button className="btn small" onClick={() => void format()} disabled={lang === 'plaintext'}>Format</button>
          {lang === 'json' && editable && (
            <label className="check" title="Save the JSON on one line (as most apps store it)">
              <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} /> Save compact
            </label>
          )}
          <button className="btn small" onClick={copy}>Copy</button>
          <span className="grow" />
          <span className="cell-dlg-note">{col?.typeName} · {text0.length.toLocaleString()} chars{editable ? '' : ' · read only'}</span>
        </div>
        {truncated && (
          <div className="cell-dlg-note err">The server sent only the first 32,768 characters of this value. Editing is off.</div>
        )}
        <div className="cell-dlg-host" ref={host} data-testid="cell-editor" />
        {note && <div className={`cell-dlg-note${note.err ? ' err' : ''}`}>{note.text}</div>}
        <div className="form-buttons">
          <button className="btn" onClick={close}>{editable ? 'Cancel' : 'Close'}</button>
          {editable && <button className="btn primary" onClick={save} disabled={!dirty}>Apply to grid</button>}
        </div>
      </div>
    </Modal>
  );
}
