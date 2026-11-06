// Host for the lazy Monaco editor.
import { useEffect, useRef, useState } from 'react';

export function EditorPane() {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let disposed = false;
    let api: { dispose(): void } | undefined;
    import('../editor/monacoEditor')
      .then((m) => {
        if (disposed || !ref.current) return;
        api = m.mountEditor(ref.current);
        setState('ready');
      })
      .catch((e) => {
        console.error('[sqlwb] editor load failed', e);
        setState('error');
      });
    return () => {
      disposed = true;
      api?.dispose();
    };
  }, []);

  return (
    <div className="editor-pane">
      <div className="editor-host" ref={ref} data-testid="editor" />
      {state !== 'ready' && (
        <div className="editor-loading">{state === 'loading' ? 'Loading editor...' : 'Editor could not load.'}</div>
      )}
    </div>
  );
}
