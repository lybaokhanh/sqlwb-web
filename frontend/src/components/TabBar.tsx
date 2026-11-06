// Statement tabs, grouped by connection profile (schema): one group per profile,
// header = profile name and color (click collapses), close button,
// double-click renames, middle-click closes, drag to reorder inside a group.
// Like Edge, the tabs can sit in a strip on top or in a sidebar on the left (vertical tabs).
import { useState } from 'react';
import { Icon } from './icons';
import { addTab, closeTab, groupTabs, moveTab, selectTab, updateTab, useStore, type Tab } from '../state/store';
import { shortcutText } from '../shortcuts';
import { setSidebarWidth, toggleVerticalTabs, useSidebarWidth, useVerticalTabs } from '../tabLayout';

export function TabBar() {
  const vertical = useVerticalTabs();
  const width = useSidebarWidth();
  const tabs = useStore((s) => s.tabs);
  const activeId = useStore((s) => s.activeTabId);
  const profiles = useStore((s) => s.profiles);
  useStore((s) => s.keys); // re-render when the user changes keys
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (profileId: string) => setCollapsed((c) => {
    const n = new Set(c);
    if (n.has(profileId)) n.delete(profileId); else n.add(profileId);
    return n;
  });

  const drop = (target: Tab) => {
    const from = tabs.findIndex((t) => t.id === drag);
    const to = tabs.findIndex((t) => t.id === target.id);
    // Only inside the same group: Connect changes the schema of a tab, not drag.
    if (from >= 0 && from !== to && tabs[from].profileId === target.profileId) moveTab(from, to);
    setDrag(null);
  };

  const renderTab = (t: Tab) => (
    <div
      key={t.id}
      role="tab"
      aria-selected={t.id === activeId}
      className={`stab${t.id === activeId ? ' active' : ''}${t.running ? ' running' : ''}`}
      title={`${profiles[t.profileId]?.name ?? ''}${t.info?.schema ? ` (schema ${t.info.schema})` : ''}${t.conn === 'connected' ? '' : ' (not connected)'}${
        t.kind === 'explorer' ? `\nFor: ${tabs.find((x) => x.id === t.sourceTabId)?.title ?? '-'}` : ''}`}
      draggable={editing !== t.id}
      onDragStart={() => setDrag(t.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => drop(t)}
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
      {t.conn !== 'connected' && <span className="stab-off" aria-label="not connected" />}
      {tabs.length > 1 && (
        <button className="stab-close" aria-label={`Close ${t.title}`} title={`Close tab (${shortcutText('closeTab')})`}
          onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}>
          <Icon name="close" size={12} />
        </button>
      )}
    </div>
  );

  // Drag the right edge of the sidebar to change its width.
  const onResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = width;
    const move = (ev: PointerEvent) => setSidebarWidth(w0 + ev.clientX - x0, false);
    const up = (ev: PointerEvent) => {
      setSidebarWidth(w0 + ev.clientX - x0);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing-x');
    };
    document.body.classList.add('resizing-x');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const layoutBtn = (
    <button className="stab-layout" data-action="verticalTabs" aria-pressed={vertical}
      aria-label={vertical ? 'Move tabs to the top' : 'Move tabs to the side'}
      title={`${vertical ? 'Move tabs to the top' : 'Move tabs to the side'} (${shortcutText('verticalTabs')})`}
      onClick={toggleVerticalTabs}>
      <Icon name={vertical ? 'tabsTop' : 'tabsSide'} size={14} />
    </button>
  );
  const addBtn = (
    <button className="stab-add" aria-label="Add tab" title={`Add tab (${shortcutText('newTab')})`} onClick={addTab}>
      <Icon name="plus" size={14} />{vertical && <span>New tab</span>}
    </button>
  );

  return (
    <div className={`tabbar${vertical ? ' vertical' : ''}`} role="tablist" aria-orientation={vertical ? 'vertical' : 'horizontal'}
      data-testid="tabbar" style={vertical ? { width } : undefined}>
      {vertical ? <div className="tabbar-head"><span>Tabs</span>{layoutBtn}</div> : layoutBtn}
      <div className="tabbar-groups">
      {groupTabs(tabs).map(({ profileId, tabs: members }) => {
        const p = profiles[profileId];
        const name = p?.name ?? 'No connection';
        const closed = collapsed.has(profileId);
        // A collapsed group still shows its active tab.
        const shown = closed ? members.filter((t) => t.id === activeId) : members;
        return (
          <div key={profileId} className={`tgroup${closed ? ' collapsed' : ''}`} role="group" aria-label={name}
            data-testid="tab-group" style={{ ['--band' as string]: p?.color ?? 'var(--border)' }}>
            <button className="tgroup-head" aria-expanded={!closed}
              title={`${name}: ${members.length} tab(s). Click to ${closed ? 'expand' : 'collapse'}.`}
              onClick={() => toggle(profileId)}>
              <Icon name={closed ? 'next' : 'down'} size={11} />
              <span className="tgroup-name">{name}</span>
              {closed && <span className="tgroup-count">{members.length}</span>}
            </button>
            {shown.map(renderTab)}
          </div>
        );
      })}
        {vertical && addBtn}
      </div>
      {!vertical && addBtn}
      {vertical && <div className="tabbar-resize" role="separator" aria-orientation="vertical" onPointerDown={onResize}
        onDoubleClick={() => setSidebarWidth(220)} />}
    </div>
  );
}
