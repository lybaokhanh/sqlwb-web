// App shell: menu bar, toolbar, statement tabs, workspace, status bar.
import { useEffect } from 'react';
import { MenuBar } from './components/MenuBar';
import { Toolbar } from './components/Toolbar';
import { TabBar } from './components/TabBar';
import { Workspace } from './components/Workspace';
import { StatusBar } from './components/StatusBar';
import { Dialogs } from './components/Dialogs';
import { LoginScreen } from './components/LoginScreen';
import { matchEvent, matchKey } from './shortcuts';
import { runMacro } from './state/features';
import { runAction } from './actions';
import { useStore } from './state/store';

export function App() {
  const ready = useStore((s) => s.ready);
  const auth = useStore((s) => s.auth);

  useEffect(() => {
    // Capture phase: runs before Monaco, so app shortcuts win.
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (s.dialog || s.palette || s.auth !== 'ready') return;
      const macro = s.macros.find((m) => m.shortcut && matchKey(e, m.shortcut));
      if (macro) {
        e.preventDefault();
        e.stopPropagation();
        runMacro(macro);
        return;
      }
      const id = matchEvent(e);
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      runAction(id);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (!ready) {
    if (auth === 'login') return <LoginScreen overlay={false} />;
    return <div className="boot">Loading...</div>;
  }
  return (
    <div className="app">
      <MenuBar />
      <Toolbar />
      <TabBar />
      <Workspace />
      <StatusBar />
      <Dialogs />
      {auth === 'login' && <LoginScreen overlay />}
    </div>
  );
}
