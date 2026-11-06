// Modal dialogs: login, new connection, prompt, about, key editor,
// and the command palette.
import { useMemo, useState } from 'react';
import {
  cancelLogin, loginTab, useStore, type Dialog,
} from '../state/store';
import { rememberedUser, rememberUser } from '../state/persist';
import { ACTIONS, shortcutText } from '../shortcuts';
import { KeyEditor } from './KeyEditor';
import { isEnabled, runAction } from '../actions';
import { startUpdate } from '../boot';
import { BookmarksDialog, ConfirmDialog, ExportDialog, FilesDialog, KeysDialog, MacrosDialog, Modal, useEscapeClose, VarsDialog } from './FeatureDialogs';
import { ConnectionManager } from "./ConnectionManager";
import { CellDialog } from './CellDialog';
import { upsertProfile } from "../state/profiles";

const close = () => useStore.setState({ dialog: null });

function LoginDialog({ tabId }: { tabId: string }) {
  const tab = useStore((s) => s.tabs.find((t) => t.id === tabId));
  const profile = useStore((s) => (tab ? s.profiles[tab.profileId] : undefined));
  const [user, setUser] = useState(() => profile?.user || rememberedUser(profile?.name ?? '') || '');
  const [pw, setPw] = useState('');
  const [remember, setRemember] = useState(() => !!rememberedUser(profile?.name ?? ''));
  const [savePw, setSavePw] = useState(true);
  // Known user (restored tab): ask only for the password.
  const [editUser, setEditUser] = useState(() => !(profile?.user));
  if (!tab || !profile) return null;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    rememberUser(profile.name, remember ? user : null);
    loginTab(tabId, user, pw);
    // Saved profile: keep the password on the server (encrypted), so the next reload does not ask.
    if (profile.saved && savePw) {
      const { id, ...rest } = profile;
      void upsertProfile({ ...rest, user, savePassword: true }, pw, id).catch(() => undefined);
    }
  };
  return (
    <Modal title={`${editUser ? 'Connect' : 'Reconnect'}: ${profile.name}`} onClose={() => cancelLogin(tabId)} sizeKey="login">
      <form onSubmit={submit} className="form">
        <div className="form-note" title={profile.url}>{profile.url}</div>
        {editUser ? (
          <label>Username<input name="username" autoFocus={!user} value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" /></label>
        ) : (
          <div className="form-user">User <b>{user}</b> <button type="button" className="link-btn" onClick={() => setEditUser(true)}>Other user</button></div>
        )}
        <label>Password<input name="password" type="password" autoFocus={!!user} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></label>
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember username for this session
        </label>
        {profile.saved && (
          <label className="check">
            <input type="checkbox" name="savePassword" checked={savePw} onChange={(e) => setSavePw(e.target.checked)} />
            Save password in profile &quot;{profile.name}&quot;
          </label>
        )}
        <div className="form-buttons">
          <button type="button" className="btn" onClick={() => cancelLogin(tabId)}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!user}>Connect</button>
        </div>
      </form>
    </Modal>
  );
}

function PromptDialog({ d }: { d: Extract<Dialog, { kind: 'prompt' }> }) {
  const [v, setV] = useState(d.value);
  return (
    <Modal title={d.title} onClose={close} sizeKey="prompt">
      <form className="form" onSubmit={(e) => { e.preventDefault(); close(); d.onOk(v); }}>
        <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
        <div className="form-buttons">
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="submit" className="btn primary">OK</button>
        </div>
      </form>
    </Modal>
  );
}

function CommandPalette() {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  useStore((s) => s.keys); // re-render when the user changes keys
  const items = useMemo(() => {
    const f = q.toLowerCase();
    return ACTIONS.filter((a) => isEnabled(a.id) && a.label.toLowerCase().includes(f));
  }, [q]);
  const shut = () => useStore.setState({ palette: false });
  // Escape closes the palette also when the focus is not in the input.
  // The palette is drawn above all dialogs, so Escape closes it first.
  useEscapeClose(shut, true);
  const run = (i: number) => {
    const a = items[i];
    shut();
    if (a) setTimeout(() => runAction(a.id), 0);
  };
  return (
    <div className="modal-back top" onMouseDown={(e) => e.target === e.currentTarget && shut()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <input autoFocus placeholder="Type a command" value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === 'Enter') { e.preventDefault(); run(sel); }
          }} />
        <div className="palette-list">
          {items.map((a, i) => (
            <button key={a.id} className={`palette-item${i === sel ? ' sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => run(i)}>
              <span>{a.label}</span><kbd>{shortcutText(a.id)}</kbd>
            </button>
          ))}
          {items.length === 0 && <div className="msg muted">No match.</div>}
        </div>
      </div>
    </div>
  );
}

export function Dialogs() {
  const d = useStore((s) => s.dialog);
  const palette = useStore((s) => s.palette);
  return (
    <>
      {d?.kind === 'login' && <LoginDialog key={d.tabId} tabId={d.tabId} />}
      {d?.kind === "connect" && <ConnectionManager select={d.select} />}
      {d?.kind === 'prompt' && <PromptDialog d={d} />}
      {d?.kind === 'shortcuts' && <KeyEditor />}
      {d?.kind === 'about' && (
        <Modal title="About" onClose={close}>
          <pre className="about">{d.text}</pre>
          <div className="form-buttons"><button className="btn primary" autoFocus onClick={close}>Close</button></div>
        </Modal>
      )}
      {d?.kind === 'update' && (
        <Modal title={`Update to Build ${d.build}`} onClose={close} sizeKey="update">
          <p className="dialog-text">All users get disconnected and the app restarts. Open transactions are lost.</p>
          <div className="form-buttons">
            <button className="btn" onClick={close}>Cancel</button>
            <button className="btn primary" autoFocus onClick={() => void startUpdate(d.build)}>Update and restart</button>
          </div>
        </Modal>
      )}
      {d?.kind === 'restarting' && (
        <Modal title="Restarting..." onClose={() => {}}>
          <p className="dialog-text" data-testid="restarting">{d.text}</p>
          <p className="dialog-text muted">The page reloads when the server is back.</p>
        </Modal>
      )}
      {d?.kind === 'confirm' && <ConfirmDialog d={d} />}
      {d?.kind === 'keys' && <KeysDialog d={d} />}
      {d?.kind === 'vars' && <VarsDialog key={d.reqId + d.names.join()} d={d} />}
      {d?.kind === 'macros' && <MacrosDialog />}
      {d?.kind === 'bookmarks' && <BookmarksDialog />}
      {d?.kind === 'files' && <FilesDialog />}
      {d?.kind === 'export' && <ExportDialog d={d} />}
      {d?.kind === 'cell' && <CellDialog key={`${d.resultId}:${d.row}:${d.col}`} d={d} />}
      {palette && <CommandPalette />}
    </>
  );
}
