// Key editor (Help > Keyboard shortcuts). Lists all actions. The user adds,
// removes and resets keys. Keys are saved per OS in the workspace.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import {
  ACTIONS, ACTION_BY_ID, PLATFORM_NAME, actionForKey, defaultKeys, eventToKey, formatKey, isOverridden, keysFor,
  macroKey, platform, reservedKey, resetAllKeys, setActionKeys, type ActionId,
} from '../shortcuts';
import { Modal } from './FeatureDialogs';

const close = () => useStore.setState({ dialog: null });

interface Msg { id: ActionId; text: string; err: boolean }

/** True when the key has Ctrl, Alt, Cmd or Win, or is a function key. Plain keys are for typing. */
function usable(k: string): boolean {
  const parts = k.split('+');
  const key = parts[parts.length - 1];
  return parts.slice(0, -1).some((m) => m !== 'Shift') || /^F\d{1,2}$/.test(key);
}

export function KeyEditor() {
  // Re-render when keys or macros change.
  useStore((s) => s.keys);
  const macros = useStore((s) => s.macros);
  const [filter, setFilter] = useState('');
  const [recording, setRecording] = useState<ActionId | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const p = platform();

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return ACTIONS.filter((a) => !f || a.label.toLowerCase().includes(f)
      || keysFor(a.id).some((k) => formatKey(k).toLowerCase().includes(f)));
  }, [filter, recording, msg]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!recording) return;
    const id = recording;
    // Capture phase: this runs before the dialog, Monaco and the app handler.
    // preventDefault also tells the Modal not to close on Escape.
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const k = eventToKey(e);
      if (!k) return; // modifier only
      if (k === 'Esc') { setRecording(null); setMsg(null); return; }
      const shown = formatKey(k);
      if (reservedKey(k)) {
        setMsg({ id, err: true, text: `${shown}: The browser or OS keeps this key.` });
        return;
      }
      if (!usable(k)) {
        setMsg({ id, err: true, text: `${shown}: Add ${p === 'mac' ? '⌘, ⌃ or ⌥' : 'Ctrl or Alt'}, or use a function key.` });
        return;
      }
      const macro = useStore.getState().macros.find((m) => m.shortcut && macroKey(m.shortcut) === k);
      if (macro) {
        setMsg({ id, err: true, text: `${shown}: Macro "${macro.name}" uses this key.` });
        return;
      }
      setRecording(null);
      const mine = keysFor(id);
      if (mine.includes(k)) { setMsg(null); return; }
      const other = actionForKey(k, id);
      const changes: Partial<Record<ActionId, string[]>> = { [id]: [...mine, k] };
      if (other) changes[other] = keysFor(other).filter((x) => x !== k);
      setActionKeys(changes);
      setMsg(other ? { id, err: false, text: `${shown}: Moved from ${ACTION_BY_ID[other].label}.` } : null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, p]);

  const remove = (id: ActionId, k: string) => {
    setActionKeys({ [id]: keysFor(id).filter((x) => x !== k) });
    setMsg(null);
  };

  const reset = (id: ActionId) => {
    // Give the default keys back. Take them from other actions that use them now.
    const changes: Partial<Record<ActionId, string[] | null>> = { [id]: null };
    const moved: string[] = [];
    for (const k of defaultKeys(id)) {
      const other = actionForKey(k, id);
      if (other) {
        changes[other] = (changes[other] ?? keysFor(other)).filter((x) => x !== k);
        moved.push(ACTION_BY_ID[other].label);
      }
    }
    setActionKeys(changes);
    setMsg(moved.length ? { id, err: false, text: `Moved from ${[...new Set(moved)].join(', ')}.` } : null);
  };

  return (
    <Modal title="Keyboard shortcuts" onClose={close} wide>
      <div className="key-editor" data-testid="key-editor">
        <input className="key-filter" data-testid="key-filter" placeholder="Filter actions or keys" autoFocus
          value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="key-list">
          {rows.map((a) => {
            const keys = keysFor(a.id);
            const m = msg?.id === a.id ? msg : null;
            return (
              <div key={a.id} className="key-row" data-testid={`key-row-${a.id}`}>
                <span className="key-label">{a.label}</span>
                <span className="key-chips">
                  {recording === a.id ? (
                    <span className="key-recording" data-testid="key-recording">Press keys... (Esc cancels)</span>
                  ) : (
                    keys.map((k) => (
                      <span key={k} className="key-chip" data-testid="key-chip" data-key={k}>
                        <kbd>{formatKey(k)}</kbd>
                        <button type="button" className="key-x" aria-label={`Remove ${formatKey(k)}`} data-testid="key-remove"
                          onClick={() => remove(a.id, k)}>×</button>
                      </span>
                    ))
                  )}
                  <button type="button" className="link-btn" data-testid="key-add"
                    onClick={() => { setMsg(null); setRecording(recording === a.id ? null : a.id); }}>
                    + Add
                  </button>
                  {isOverridden(a.id) && (
                    <button type="button" className="link-btn" data-testid="key-reset" onClick={() => reset(a.id)}>Reset</button>
                  )}
                </span>
                {m && <span className={`key-msg${m.err ? ' err' : ''}`} data-testid="key-msg">{m.text}</span>}
              </div>
            );
          })}
          {rows.length === 0 && <div className="msg muted">No match.</div>}
        </div>
        <div className="key-note" data-testid="key-note">
          Keys for {PLATFORM_NAME[p]}. Each OS keeps its own keys. The workspace saves your changes.
          {macros.some((m) => m.shortcut) ? ' Macro keys: Macros > Manage macros.' : ''}
        </div>
        <div className="form-buttons">
          <button type="button" className="btn" data-testid="key-reset-all" onClick={() => { resetAllKeys(); setMsg(null); setRecording(null); }}>
            Reset all
          </button>
          <button type="button" className="btn primary" onClick={close}>Close</button>
        </div>
      </div>
    </Modal>
  );
}
