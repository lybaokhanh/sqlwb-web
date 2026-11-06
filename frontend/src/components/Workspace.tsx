// Editor on top, result panel below, draggable splitter between.
// The split is stored per tab. A DB Explorer tab covers this area; the
// editor stays mounted (hidden) so Monaco keeps its models.
import { useRef } from 'react';
import { EditorPane } from './EditorPane';
import { ResultPanel, useActiveTab } from './ResultPanel';
import { ExplorerView } from './ExplorerView';
import { updateTab } from '../state/store';

export function Workspace() {
  const tab = useActiveTab();
  const ref = useRef<HTMLDivElement>(null);
  const split = tab?.split ?? 0.45;
  const expanded = split >= 0.99;
  const explorer = tab?.kind === 'explorer';

  const onDown = (e: React.PointerEvent) => {
    if (!tab || !ref.current) return;
    e.preventDefault();
    const box = ref.current.getBoundingClientRect();
    const id = tab.id;
    const move = (ev: PointerEvent) => {
      const f = (ev.clientY - box.top) / box.height;
      updateTab(id, { split: Math.max(0.08, Math.min(0.92, f)) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="workspace" ref={ref}>
      <div className="ws-sql" style={{ display: explorer ? 'none' : 'flex' }}>
        <div className="ws-editor" style={{ flexBasis: `${split * 100}%` }}>
          <EditorPane />
        </div>
        {!expanded && (
          <>
            <div className="splitter" role="separator" aria-orientation="horizontal" onPointerDown={onDown}
              onDoubleClick={() => tab && updateTab(tab.id, { split: 0.45 })} />
            <div className="ws-result">{tab && !explorer && <ResultPanel tab={tab} />}</div>
          </>
        )}
      </div>
      {explorer && tab && <ExplorerView key={tab.id} tab={tab} />}
    </div>
  );
}
