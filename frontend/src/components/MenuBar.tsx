// Desktop-style menu bar. Click opens, hover switches, Esc closes.
import { useEffect, useRef, useState } from 'react';
import { MENUS } from '../menus';
import { ACTION_BY_ID, formatKey, macroKey, shortcutText } from '../shortcuts';
import { isEnabled, runAction } from '../actions';
import { useStore } from '../state/store';
import { runMacro } from '../state/features';

export function MenuBar() {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const macros = useStore((s) => s.macros);
  useStore((s) => s.keys); // re-render when the user changes keys

  useEffect(() => {
    if (open === null) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(null); }
      if (e.key === 'ArrowRight') setOpen((o) => (o === null ? o : (o + 1) % MENUS.length));
      if (e.key === 'ArrowLeft') setOpen((o) => (o === null ? o : (o - 1 + MENUS.length) % MENUS.length));
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="menubar" ref={ref} role="menubar">
      {MENUS.map((m, i) => (
        <div key={m.title} className="menu-root">
          <button
            className={`menu-title${open === i ? ' open' : ''}`}
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={open === i}
            onMouseDown={(e) => { e.preventDefault(); setOpen(open === i ? null : i); }}
            onMouseEnter={() => open !== null && setOpen(i)}
          >
            {m.title}
          </button>
          {open === i && (
            <div className="menu-drop" role="menu">
              {m.items.map((it, k) =>
                it === '-' ? (
                  <div key={k} className="menu-sep" />
                ) : (
                  <button
                    key={k}
                    role="menuitem"
                    className="menu-item"
                    disabled={!isEnabled(it)}
                    onClick={() => { setOpen(null); runAction(it); }}
                  >
                    <span className="menu-label">{ACTION_BY_ID[it].label}</span>
                    <span className="menu-key">{shortcutText(it)}</span>
                  </button>
                ),
              )}
              {m.dynamic === 'macros' && macros.length > 0 && <div className="menu-sep" />}
              {m.dynamic === 'macros' && macros.map((mac, k) => (
                <button key={`mac${k}`} role="menuitem" className="menu-item" onClick={() => { setOpen(null); runMacro(mac); }}>
                  <span className="menu-label">{mac.name}</span>
                  <span className="menu-key">{mac.shortcut ? (macroKey(mac.shortcut) ? formatKey(macroKey(mac.shortcut)) : mac.shortcut) : ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
