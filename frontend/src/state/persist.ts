// Workspace save/restore on the server (GET/PUT /api/workspace).
// Debounced 1 s, and at once (keepalive) when the page hides.
// localStorage is only an offline fallback. Passwords are never saved.
import type { ConfigResponse, KeyMap, SavedProfile, WorkspaceConnection, WorkspaceDoc } from "../api/protocol";
import { client, HttpError } from "../api/client";
import { savedId, toProfile } from "./profiles";
import { getTheme, setTheme } from '../theme';
import {
  DEFAULT_COLOR, DEFAULT_PROFILE_ID, makeTab, newId, useStore, type Profile, type Tab,
} from './store';

const FALLBACK_KEY = 'sqlwb.workspace.v2';

export function toDoc(): WorkspaceDoc {
  const s = useStore.getState();
  return {
    tabs: s.tabs.filter((t) => t.kind !== 'explorer').map((t) => {
      const p = s.profiles[t.profileId];
      const connection: WorkspaceConnection | undefined = p
        ? {
          name: p.name, url: p.url, user: p.user, autocommit: p.autocommit, fetchSize: p.fetchSize, color: p.color,
          sysdba: p.sysdba, readOnly: p.readOnly, confirmUpdates: p.confirmUpdates, timeout: p.timeout,
          confirmNoWhere: p.confirmNoWhere, group: p.group,
        }
        : undefined;
      return { id: t.id, title: t.title, sql: t.sql, cursor: t.cursor, connection, split: t.split, history: t.history.slice(-20) };
    }),
    activeTab: s.tabs.find((t) => t.id === s.activeTabId)?.kind === 'explorer' ? undefined : s.activeTabId,
    theme: getTheme(),
    maxRows: s.maxRows,
    timeout: s.timeout,
    maxResults: s.maxResults,
    macros: s.macros,
    keys: s.keys,
  };
}

function saveFallback(doc: WorkspaceDoc) {
  // Offline copy without usernames.
  const copy: WorkspaceDoc = {
    ...doc,
    tabs: doc.tabs?.map((t) => (t.connection ? { ...t, connection: { ...t.connection, user: '' } } : t)),
  };
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(copy));
  } catch {
    /* storage blocked */
  }
}

function loadFallback(): WorkspaceDoc {
  try {
    return JSON.parse(localStorage.getItem(FALLBACK_KEY) ?? '{}') as WorkspaceDoc;
  } catch {
    return {};
  }
}

let conflictOpen = false;

/** Save now. Returns false when the server save failed (the browser copy keeps the work). */
export async function saveNow(keepalive = false, force = false): Promise<boolean> {
  const doc = toDoc();
  saveFallback({ ...doc, unsentAt: Date.now(), baseVer: client.workspaceVersion });
  try {
    await client.putWorkspace(doc, keepalive, force);
    saveFallback(doc);
    return true;
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) showConflict();
    return false;
  }
}

/** Another browser tab saved a newer workspace. The user picks which one stays. */
function showConflict() {
  if (conflictOpen) return;
  conflictOpen = true;
  useStore.setState({
    dialog: {
      kind: 'confirm', title: 'Workspace changed in another browser tab',
      text: 'Another browser tab saved this workspace after this tab loaded it. Keep this tab (overwrite the other one), or load the other version?',
      okLabel: 'Keep this tab',
      onOk: () => { conflictOpen = false; void saveNow(false, true); },
      onCancel: () => {
        conflictOpen = false;
        const doc = loadFallback();
        delete doc.unsentAt;
        saveFallback(doc);
        window.location.reload();
      },
    },
  });
}

/** Server copy, or the browser copy when the last server save failed (unsentAt). */
export async function loadWorkspace(): Promise<{ doc: WorkspaceDoc; fromBrowser: boolean }> {
  const local = loadFallback();
  try {
    const doc = await client.getWorkspace();
    // Use the browser copy only when nobody saved on the server since (another PC, another browser).
    if (local.unsentAt && local.baseVer === client.workspaceVersion) return { doc: local, fromBrowser: true };
    return { doc, fromBrowser: false };
  } catch {
    return { doc: local, fromBrowser: !!local.unsentAt };
  }
}

let subscribed = false;

/** Keeps only well-formed key lists from the saved workspace. */
function cleanKeys(raw: unknown): KeyMap {
  const out: KeyMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [plat, acts] of Object.entries(raw as Record<string, unknown>)) {
    if (!acts || typeof acts !== 'object') continue;
    const m: Record<string, string[]> = {};
    for (const [id, list] of Object.entries(acts as Record<string, unknown>)) {
      if (Array.isArray(list)) m[id] = list.filter((k): k is string => typeof k === 'string');
    }
    out[plat] = m;
  }
  return out;
}

/** Builds the start state from the saved workspace and /api/config. */
export function initWorkspace(cfg: ConfigResponse, doc: WorkspaceDoc, saved: SavedProfile[] = []) {
  const def: Profile = {
    id: DEFAULT_PROFILE_ID, name: cfg.defaultProfile.name, url: cfg.defaultProfile.url,
    user: rememberedUser(cfg.defaultProfile.name) ?? '', autocommit: false, color: DEFAULT_COLOR,
  };
  const profiles: Record<string, Profile> = { [DEFAULT_PROFILE_ID]: def };
  for (const s of saved) { const p = toProfile(s); profiles[p.id] = p; }
  const byKey = new Map<string, string>();

  const profileFor = (c: WorkspaceConnection | undefined): string => {
    if (!c) return DEFAULT_PROFILE_ID;
    const sp = profiles[savedId(c.name)];
    if (sp && sp.url === c.url) return sp.id;
    if (c.name === def.name && c.url === def.url) {
      if (c.user && !profiles[DEFAULT_PROFILE_ID].user) profiles[DEFAULT_PROFILE_ID] = { ...def, user: c.user, autocommit: c.autocommit, color: c.color ?? def.color };
      return DEFAULT_PROFILE_ID;
    }
    const key = JSON.stringify([c.name, c.url, c.user]);
    let id = byKey.get(key);
    if (!id) {
      id = newId('p');
      byKey.set(key, id);
      profiles[id] = {
        id, name: c.name, url: c.url, user: c.user || rememberedUser(c.name) || '', autocommit: c.autocommit,
        fetchSize: c.fetchSize, color: c.color ?? DEFAULT_COLOR,
        sysdba: c.sysdba, readOnly: c.readOnly, confirmUpdates: c.confirmUpdates, timeout: c.timeout,
        confirmNoWhere: c.confirmNoWhere, group: c.group,
      };
    }
    return id;
  };

  let tabs: Tab[] = (doc.tabs ?? []).map((t) => ({
    ...makeTab(t.title, profileFor(t.connection), t.sql ?? ''),
    id: t.id || newId('t'),
    cursor: t.cursor ?? { line: 1, col: 1 },
    split: t.split ?? 0.45,
    history: t.history ?? [],
    histPos: (t.history ?? []).length - 1,
  }));
  if (tabs.length === 0) tabs = [makeTab('Statement 1', DEFAULT_PROFILE_ID)];
  const activeTabId = tabs.some((t) => t.id === doc.activeTab) ? doc.activeTab! : tabs[0].id;
  if (doc.theme === 'dark' || doc.theme === 'light') setTheme(doc.theme);
  useStore.setState({
    tabs, activeTabId, profiles,
    maxRows: doc.maxRows ?? 0, timeout: doc.timeout ?? 0, maxResults: doc.maxResults ?? 20,
    macros: Array.isArray(doc.macros) ? doc.macros : [], keys: cleanKeys(doc.keys), defaultUrl: cfg.defaultProfile.url,
    ready: true,
  });

  if (subscribed) return;
  subscribed = true;
  let timer: number | undefined;
  const later = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void saveNow(), 1000);
  };
  useStore.subscribe((s, prev) => {
    if (!s.ready) return;
    if (s.tabs === prev.tabs && s.profiles === prev.profiles && s.activeTabId === prev.activeTabId
      && s.maxRows === prev.maxRows && s.timeout === prev.timeout && s.maxResults === prev.maxResults
      && s.macros === prev.macros && s.keys === prev.keys) return;
    later();
  });
  document.addEventListener('sqlwb-theme', later);
  const flushNow = () => {
    window.clearTimeout(timer);
    if (useStore.getState().ready && useStore.getState().auth === 'ready') void saveNow(true);
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); });
  window.addEventListener('pagehide', flushNow);
}

// Username only, in sessionStorage, when the user asks for it.
export function rememberedUser(profileName: string): string | null {
  try {
    return sessionStorage.getItem(`sqlwb.user.${profileName}`);
  } catch {
    return null;
  }
}
export function rememberUser(profileName: string, user: string | null) {
  try {
    if (user) sessionStorage.setItem(`sqlwb.user.${profileName}`, user);
    else sessionStorage.removeItem(`sqlwb.user.${profileName}`);
  } catch {
    /* storage blocked */
  }
}
