// Start-up and session flow: app login, workspace restore, update check.
import { client } from './api/client';
import type { SessionResponse } from './api/protocol';
import { initWorkspace, loadWorkspace, saveNow } from './state/persist';
import { activeTab, ensureConnected, log, updateTab, useStore } from './state/store';
import { loadSavedProfiles } from './state/profiles';

const set = useStore.setState;
const get = useStore.getState;
const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;
let updateTimer: number | undefined;

export async function boot() {
  try {
    const sess = await client.session();
    if (!sess.user) {
      set({ session: sess, auth: 'login' });
      return;
    }
    await afterLogin(sess);
  } catch (e) {
    console.error('[sqlwb] session check failed', e);
    set({ session: null, auth: 'login' });
  }
}

export async function login(name: string, password: string) {
  const sess = await client.login(name, password);
  const prev = get().session?.user;
  if (prev && prev !== sess.user && get().ready) {
    // Other user: start clean with that user's workspace.
    window.location.reload();
    return;
  }
  await afterLogin(sess);
}

async function afterLogin(sess: SessionResponse) {
  set({ session: sess, auth: 'ready' });
  let fromBrowser = false;
  if (!get().ready) {
    const [cfg, ws, saved] = await Promise.all([client.config(), loadWorkspace(), loadSavedProfiles()]);
    fromBrowser = ws.fromBrowser;
    initWorkspace(cfg, ws.doc, saved);
  }
  // DB connections the server still holds (page reload within 15 min): use them, no new login.
  const live = await client.liveTabs();
  for (const [tabId, info] of Object.entries(live)) {
    if (get().tabs.some((t) => t.id === tabId)) updateTab(tabId, { conn: 'connected', info });
  }
  client.start();
  void checkUpdate();
  window.clearInterval(updateTimer);
  updateTimer = window.setInterval(() => void checkUpdate(), UPDATE_EVERY_MS);
  const t = activeTab();
  if (t && fromBrowser) log(t.id, 'warn', 'The last server save failed. This browser had a newer copy of your work: restored from it.');
  if (fromBrowser) void saveNow();
  if (t && t.conn !== 'connected') void ensureConnected(t.id);
}

export async function logout() {
  await saveNow();
  await client.logout();
  window.location.reload();
}

export async function checkUpdate() {
  try {
    set({ update: await client.getUpdate() });
  } catch (e) {
    set({ update: { current: '', latest: '', updateAvailable: false, error: String(e) } });
  }
}

/** Admin only. Starts the update, waits for the restart, then reloads. */
export async function startUpdate(build: string) {
  set({ dialog: { kind: 'restarting', text: `Starting update to build ${build}...` } });
  try {
    const r = await client.startUpdate(build);
    set({ dialog: { kind: 'restarting', text: `${r.message} (${r.activeSessions} active sessions). Restarting...` } });
  } catch (e) {
    set({ dialog: { kind: 'about', text: `Update failed: ${String(e)}` } });
    return;
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // Give the server time to go down before polling.
  await sleep(client.mock ? 500 : 4000);
  for (;;) {
    try {
      await client.health();
      window.location.reload();
      return;
    } catch {
      await sleep(2000);
    }
  }
}
