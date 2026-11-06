// Statement tabs: color band = connection color, close button,
// double-click renames, middle-click closes, drag to reorder.
import { useState } from 'react';
import { Icon } from './icons';
import { addTab, closeTab, moveTab, selectTab, updateTab, useStore } from '../state/store';
import { shortcutText } from '../shortcuts';

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeId = useStore((s) => s.activeTabId);
  const profiles = useStore((s) => s.profiles);
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<number | null>(null);

  return (
    <div className="tabbar" role="tablist">
      {tabs.map((t, i) => (
        <div
          key={t.id}
          role="tab"
          aria-selected={t.id === activeId}
          className={`stab${t.id === activeId ? ' active' : ''}${t.running ? ' running' : ''}`}
          style={{ ['--band' as string]: profiles[t.profileId]?.color ?? 'transparent' }}
          title={`${profiles[t.profileId]?.name ?? ''}${t.conn === 'connected' ? '' : ' (not connected)'}`}
          draggable={editing !== t.id}
          onDragStart={() => setDrag(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => { if (drag !== null && drag !== i) moveTab(drag, i); setDrag(null); }}
          onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
          onAuxClick={(e) => { if (e.button === 1) closeTab(t.id); }}
          onClick={() => selectTab(t.id)}
          onDoubleClick={() => setEditing(t.id)}
        >
          {editing === t.id ? (
            <input
              className="stab-edit"
              autoFocus
              defaultValue={t.title}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v) updateTab(t.id, { title: v }); setEditing(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setEditing(null);
              }}
            />
          ) : (
            <span className="stab-title">{t.title}</span>
          )}
          {tabs.length > 1 && (
            <button className="stab-close" aria-label={`Close ${t.title}`} title={`Close tab (${shortcutText('closeTab')})`}
              onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}>
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      ))}
      <button className="stab-add" aria-label="Add tab" title={`Add tab (${shortcutText('newTab')})`} onClick={addTab}>
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}
