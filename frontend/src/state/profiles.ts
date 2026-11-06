// Saved connection profiles (Connection Manager). The list lives on the server
// (GET/PUT /api/profiles). Passwords with "Save password" are encrypted there;
// all other passwords stay in memory only.
import type { ProfileOptions, SavedProfile } from '../api/protocol';
import { PROFILE_OPTION_KEYS } from '../api/protocol';
import { client } from '../api/client';
import { DEFAULT_COLOR, getPassword, setPassword, useStore, type Profile } from './store';

const get = useStore.getState;
const set = useStore.setState;

/** Stable id of a saved profile, so workspace tabs find it again after a reload. */
export const savedId = (name: string) => `sp:${name}`;

/** The profile options that are set (empty text and false are left out). */
function options(p: ProfileOptions): ProfileOptions {
  const o: Record<string, unknown> = {};
  for (const k of PROFILE_OPTION_KEYS) if (p[k] !== undefined && p[k] !== '' && p[k] !== false) o[k] = p[k];
  return o as ProfileOptions;
}

export function toProfile(s: SavedProfile): Profile {
  return {
    ...options(s),
    id: savedId(s.name), name: s.name, url: s.url, user: s.user, autocommit: s.autocommit,
    fetchSize: s.fetchSize, timeout: s.timeout, color: s.color || DEFAULT_COLOR,
    sysdba: s.sysdba, readOnly: s.readOnly, confirmUpdates: s.confirmUpdates, confirmNoWhere: s.confirmNoWhere,
    rememberSchema: s.rememberSchema, explorerSchema: s.explorerSchema,
    group: s.group || undefined, tags: s.tags, savePassword: s.savePassword,
    saved: true,
  };
}

function toSaved(p: Profile): SavedProfile {
  return {
    ...options(p),
    name: p.name, group: p.group ?? '', url: p.url, user: p.user, autocommit: p.autocommit,
    fetchSize: p.fetchSize, timeout: p.timeout, color: p.color,
    sysdba: p.sysdba, readOnly: p.readOnly, confirmUpdates: p.confirmUpdates, confirmNoWhere: p.confirmNoWhere,
    rememberSchema: p.rememberSchema, explorerSchema: p.explorerSchema,
    tags: p.tags,
    savePassword: !!p.savePassword,
    password: p.savePassword ? getPassword(p.id) ?? '' : undefined,
  };
}

export function savedProfiles(): Profile[] {
  return Object.values(get().profiles).filter((p) => p.saved)
    .sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.name.localeCompare(b.name));
}

/** Loads the saved list. Saved passwords go into memory, so tabs connect without a prompt. */
export async function loadSavedProfiles(): Promise<SavedProfile[]> {
  try {
    const doc = await client.getProfiles();
    for (const s of doc.profiles) if (s.password && !s.passwordLost) setPassword(savedId(s.name), s.password);
    return doc.profiles;
  } catch (e) {
    console.warn('[sqlwb] saved profiles not loaded', e);
    return [];
  }
}

let saving: Promise<void> = Promise.resolve();
/** Writes the whole saved list (one request at a time). */
export function persistProfiles(): Promise<void> {
  saving = saving.then(() => client.putProfiles({ profiles: savedProfiles().map(toSaved) })).catch((e) => {
    console.error('[sqlwb] saving profiles failed', e);
    throw e;
  });
  return saving;
}

/** Adds or replaces a saved profile. A rename keeps the tabs: they move to the new id. */
export async function upsertProfile(p: Omit<Profile, 'id'>, password: string, oldId?: string): Promise<string> {
  const id = savedId(p.name);
  if (password) setPassword(id, password);
  else if (oldId && oldId !== id) { const pw = getPassword(oldId); if (pw) setPassword(id, pw); }
  set((s) => {
    const profiles = { ...s.profiles };
    if (oldId && oldId !== id) delete profiles[oldId];
    profiles[id] = { ...p, id, saved: true };
    const tabs = oldId && oldId !== id ? s.tabs.map((t) => (t.profileId === oldId ? { ...t, profileId: id } : t)) : s.tabs;
    return { profiles, tabs };
  });
  await persistProfiles();
  return id;
}

/** Removes the profile from the saved list. Open tabs keep it until they close. */
export async function deleteProfile(id: string) {
  set((s) => ({ profiles: { ...s.profiles, [id]: { ...s.profiles[id], saved: false } } }));
  await persistProfiles();
}

/** Desktop WbProfiles.xml / .properties. Same names replace, new names are added. Returns the count. */
export async function importProfileFile(file: File): Promise<number> {
  const text = await file.text();
  const list = await client.importProfiles(text, /\.properties$/i.test(file.name));
  set((s) => {
    const profiles = { ...s.profiles };
    for (const sp of list) {
      const p = toProfile(sp);
      profiles[p.id] = p;
      if (sp.password) setPassword(p.id, sp.password);
    }
    return { profiles };
  });
  await persistProfiles();
  return list.length;
}

/** DB Explorer: keep the last schema for profiles with "Remember DbExplorer Schema". */
export function rememberExplorerSchema(profileId: string, schema: string) {
  const p = get().profiles[profileId];
  if (!p?.saved || !p.rememberSchema || p.explorerSchema === schema) return;
  set((s) => ({ profiles: { ...s.profiles, [profileId]: { ...p, explorerSchema: schema } } }));
  void persistProfiles().catch(() => undefined);
}
