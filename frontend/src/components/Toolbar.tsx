// Icon toolbar. Tooltips show the shortcut from the registry.
import { Icon } from './icons';
import { ACTION_BY_ID, shortcutText, type ActionId } from '../shortcuts';
import { isEnabled, runAction } from '../actions';
import { useStore } from '../state/store';
import { useTheme } from '../theme';

const GROUPS: [ActionId, string][][] = [
  [['execSelected', 'execSel'], ['execCurrent', 'execCur'], ['cancel', 'cancel']],
  [['histFirst', 'first'], ['histBack', 'back'], ['histNext', 'next'], ['histLast', 'last']],
  [['saveChanges', 'save'], ['insertRow', 'insertRow'], ['copyRow', 'copyRow'], ['deleteRow', 'deleteRow'], ['filter', 'filter']],
  [['commit', 'commit'], ['rollback', 'rollback']],
  [['connect', 'connect'], ['dbExplorer', 'dbExplorer']],
];

function tip(id: ActionId) {
  const k = shortcutText(id);
  return k ? `${ACTION_BY_ID[id].label} (${k})` : ACTION_BY_ID[id].label;
}

export function Toolbar() {
  // Re-render on any state change so enabled flags stay current.
  const s = useStore();
  const theme = useTheme();
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  const profile = tab ? s.profiles[tab.profileId] : undefined;
  const connLabel = !tab || !profile
    ? 'Not connected'
    : tab.conn === 'connected'
      ? `${profile.name}: ${tab.info?.user ?? profile.user}@${tab.info?.schema ?? ''}`
      : `${profile.name} (${tab.conn === 'connecting' ? 'connecting...' : 'not connected'})`;

  return (
    <div className="toolbar" role="toolbar">
      {GROUPS.map((g, gi) => (
        <div className="tb-group" key={gi}>
          {g.map(([id, icon]) => (
            <button key={id} className="tb-btn" title={tip(id)} aria-label={ACTION_BY_ID[id].label}
              disabled={!isEnabled(id)} onClick={() => runAction(id)} data-action={id}>
              <Icon name={icon} />
            </button>
          ))}
        </div>
      ))}
      <div className="tb-group">
        <button className="tb-btn" data-action="toggleTheme" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          aria-label="Toggle theme" onClick={() => runAction('toggleTheme')}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
      </div>
      <div className="tb-spacer" />
      {s.session?.admin && s.update?.updateAvailable && (
        <button className="update-btn" data-testid="update-btn" title={`Build ${s.update.latest}${s.update.latestDate ? ` (${s.update.latestDate})` : ''} is available`}
          onClick={() => useStore.setState({ dialog: { kind: 'update', build: s.update!.latest } })}>
          Update to Build {s.update.latest}
        </button>
      )}
      <div className="tb-conn" title={profile?.url}>
        {profile && <span className="conn-dot" style={{ background: profile.color }} />}
        <span className={`conn-state ${tab?.conn ?? 'none'}`} />
        {connLabel}
        {s.link === 'mock' && <span className="badge">MOCK</span>}
        {s.link === 'closed' && <span className="badge warn">OFFLINE</span>}
        {tab && (tab.conn === 'none' || tab.conn === 'error') && (
          <button className="link-btn" onClick={() => runAction('reconnect')}>Reconnect</button>
        )}
        {s.session?.user && <span className="app-user" title="Logged in user">{s.session.user}</span>}
      </div>
    </div>
  );
}
