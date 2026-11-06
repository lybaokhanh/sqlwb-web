// Connection Manager: saved profiles on the left (groups, filter), the selected
// profile on the right, Test / Save / Connect. Layout follows the
// "Select Connection Profile" window of the desktop SQL Workbench/J.
import { useMemo, useRef, useState } from 'react';
import { client } from '../api/client';
import type { TestResult } from '../api/protocol';
import { DEFAULT_COLOR, getPassword, openTabFor, switchTabProfile, useStore, type Profile } from '../state/store';
import { deleteProfile, importProfileFile, savedProfiles, upsertProfile } from '../state/profiles';
import { Modal } from './FeatureDialogs';

type Draft = Omit<Profile, 'id'>;

const close = () => useStore.setState({ dialog: null });

const EMPTY: Draft = {
  name: 'New profile', group: '', url: 'jdbc:oracle:thin:@//host:1521/SERVICE', user: '', autocommit: false,
  color: '#3b82f6', savePassword: true, saved: true,
};

const OPTIONS: [keyof Draft, string][] = [
  ['savePassword', 'Save password'],
  ['confirmUpdates', 'Confirm updates'],
  ['readOnly', 'Read only'],
  ['confirmNoWhere', 'Confirm DML without WHERE'],
  ['rememberSchema', 'Remember DbExplorer Schema'],
  ['autocommit', 'Autocommit'],
];

/** Drivers in the image. The URL prefix picks the entry; a change sets the template URL. */
const DRIVERS = [
  { name: 'Oracle', prefix: 'jdbc:oracle:', url: 'jdbc:oracle:thin:@//host:1521/SERVICE' },
  { name: 'PostgreSQL', prefix: 'jdbc:postgresql:', url: 'jdbc:postgresql://host:5432/database' },
  { name: 'H2', prefix: 'jdbc:h2:', url: 'jdbc:h2:mem:test' },
];

/** "More options" check boxes, as in the desktop dialog. */
const MORE_FLAGS: [keyof Draft, string][] = [
  ['checkUncommitted', 'Check for uncommitted changes'],
  ['ignoreDropErrors', 'Ignore DROP errors'],
  ['emptyStringIsNull', 'Empty string is NULL'],
  ['trimCharData', 'Trim CHAR data'],
  ['removeComments', 'Remove comments'],
  ['hideWarnings', 'Hide warnings'],
];

/** "More options" text fields. rows = 0: one-line input. */
const MORE_TEXT: [keyof Draft, string, number, string][] = [
  ['defaultSchema', 'Default schema', 0, 'e.g. HR'],
  ['altDelimiter', 'Alternate delimiter', 0, 'e.g. /'],
  ['connectScript', 'Connect script (runs after each connect)', 3, "e.g. WbVarDef env=dev;\nalter session set nls_date_format='YYYY-MM-DD';"],
  ['variables', 'Variables (name=value per line)', 2, 'env=dev'],
  ['properties', 'Extended properties (JDBC, name=value per line)', 2, 'oracle.jdbc.defaultRowPrefetch=500'],
  ['schemaFilter', 'Schema filter (one regex per line, hidden; first line "(include)" = show only these)', 2, 'APEX_.*'],
  ['catalogFilter', 'Catalog filter (same rules)', 2, ''],
];

function draftOf(p: Profile | undefined): Draft {
  if (!p) return { ...EMPTY };
  const { id: _id, ...rest } = p;
  return rest;
}

export function ConnectionManager({ select }: { select?: string }) {
  const profiles = useStore((s) => s.profiles);
  const list = useMemo(() => savedProfiles(), [profiles]); // eslint-disable-line react-hooks/exhaustive-deps
  const [selId, setSelId] = useState<string | null>(() => (select && profiles[select]?.saved ? select : list[0]?.id ?? null));
  const [draft, setDraft] = useState<Draft>(() => draftOf(selId ? profiles[selId] : undefined));
  const [pw, setPw] = useState(() => (selId ? getPassword(selId) ?? '' : ''));
  const [showPw, setShowPw] = useState(false);
  const [filter, setFilter] = useState('');
  const [test, setTest] = useState<{ busy?: boolean; r?: TestResult }>({});
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = (id: string | null) => {
    setSelId(id);
    setDraft(draftOf(id ? useStore.getState().profiles[id] : undefined));
    setPw(id ? getPassword(id) ?? '' : '');
    setTest({});
    setError('');
  };
  const upd = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const f = filter.trim().toLowerCase();
  const shown = list.filter((p) => !f || [p.name, p.user, p.group, p.tags, p.url].some((x) => x?.toLowerCase().includes(f)));
  const groups = new Map<string, Profile[]>();
  for (const p of shown) {
    const g = p.group || '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(p);
  }

  const nameTaken = list.some((p) => p.name === draft.name.trim() && p.id !== selId);
  const valid = !!draft.name.trim() && !!draft.url.trim() && !nameTaken;

  const save = async (): Promise<string | null> => {
    if (!valid) return null;
    try {
      const id = await upsertProfile({ ...draft, name: draft.name.trim(), url: draft.url.trim(), saved: true }, pw, selId ?? undefined);
      setSelId(id);
      setError('');
      return id;
    } catch (e) {
      setError(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };

  /** Connect = the current statement tab uses this profile. newTab = open a new statement tab. */
  const connect = async (newTab = false) => {
    const id = await save();
    if (id) (newTab ? openTabFor : switchTabProfile)(id);
  };

  const runTest = async () => {
    setTest({ busy: true });
    try {
      setTest({ r: await client.testConnection({ url: draft.url.trim(), user: draft.user, password: pw, sysdba: draft.sysdba }) });
    } catch (e) {
      setTest({ r: { ok: false, error: e instanceof Error ? e.message : String(e) } });
    }
  };

  const remove = async () => {
    if (!selId) return;
    await deleteProfile(selId);
    pick(savedProfiles()[0]?.id ?? null);
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const n = await importProfileFile(file);
      if (!selId) pick(savedProfiles()[0]?.id ?? null);
      setError('');
      setTest({ r: { ok: true, product: `Imported ${n} profile${n === 1 ? '' : 's'} from ${file.name}` } });
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <Modal title="Select Connection Profile" onClose={close} xl sizeKey="connections">
      <div className="cm">
        <div className="cm-side">
          <div className="cm-tools">
            <button className="btn" data-testid="cm-new" onClick={() => { pick(null); }}>New</button>
            <button className="btn" disabled={!selId} onClick={() => { setSelId(null); setDraft((d) => ({ ...d, name: `Copy of ${d.name}` })); }}>Copy</button>
            <button className="btn" disabled={!selId} data-testid="cm-delete" onClick={() => void remove()}>Delete</button>
            <button className="btn" title="Import WbProfiles.xml or WbProfiles.properties from the desktop app" onClick={() => fileRef.current?.click()}>Import…</button>
            <input ref={fileRef} type="file" accept=".xml,.properties" hidden data-testid="cm-import"
              onChange={(e) => { void onImport(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <input placeholder="Filter (name, user, group, tag)" aria-label="Filter profiles" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="cm-list" role="listbox" aria-label="Profiles" data-testid="cm-list">
            {[...groups.entries()].map(([g, ps]) => (
              <div key={g || '-'}>
                {g && <div className="cm-group">{g}</div>}
                {ps.map((p) => (
                  <button key={p.id} role="option" aria-selected={p.id === selId} className={`cm-item${p.id === selId ? ' sel' : ''}`}
                    onClick={() => pick(p.id)} onDoubleClick={() => switchTabProfile(p.id)} title={p.url}>
                    <span className="dot" style={{ background: p.color || DEFAULT_COLOR }} />
                    <span>{p.name}</span>
                    <span className="cm-user">{p.user}{getPassword(p.id) ? '' : ' 🔒'}</span>
                  </button>
                ))}
              </div>
            ))}
            {list.length === 0 && <div className="msg muted" style={{ padding: 8 }}>No saved profiles. Click New or Import….</div>}
            {list.length > 0 && shown.length === 0 && <div className="msg muted" style={{ padding: 8 }}>No match.</div>}
          </div>
        </div>

        <form className="form cm-form" onSubmit={(e) => { e.preventDefault(); void connect(); }}>
          <div className="form-row">
            <label>Profile name<input name="profileName" value={draft.name} onChange={(e) => upd('name', e.target.value)} /></label>
            <label>Group<input name="group" value={draft.group ?? ''} onChange={(e) => upd('group', e.target.value)} placeholder="e.g. dba" /></label>
          </div>
          {nameTaken && <div className="cm-test err">A profile with this name exists.</div>}
          <label>Driver
            <select name="driver" value={DRIVERS.find((d) => draft.url.startsWith(d.prefix))?.name ?? ''}
              onChange={(e) => { const d = DRIVERS.find((x) => x.name === e.target.value); if (d) upd('url', d.url); }}>
              {DRIVERS.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
              <option value="" disabled>Other (from the URL)</option>
            </select>
          </label>
          <label>URL<input name="url" className="mono" value={draft.url} spellCheck={false} onChange={(e) => upd('url', e.target.value)} /></label>
          <div className="form-row">
            <label>Username<input name="username" value={draft.user} autoComplete="off" onChange={(e) => upd('user', e.target.value)} /></label>
            <label className="check"><input name="sysdba" type="checkbox" checked={!!draft.sysdba} onChange={(e) => upd('sysdba', e.target.checked)} />as SYSDBA</label>
          </div>
          <label>Password
            <span className="cm-pw">
              <input name="password" type={showPw ? 'text' : 'password'} value={pw} autoComplete="new-password" onChange={(e) => setPw(e.target.value)} />
              <button type="button" className="btn" aria-label={showPw ? 'Hide password' : 'Show password'} onClick={() => setShowPw((v) => !v)}>{showPw ? 'Hide' : 'Show'}</button>
            </span>
          </label>
          <div className="form-row">
            <label>Fetch size<input name="fetchSize" type="number" min={0} value={draft.fetchSize ?? ''} onChange={(e) => upd('fetchSize', Number(e.target.value) || undefined)} /></label>
            <label>Timeout (s)<input name="timeout" type="number" min={0} value={draft.timeout ?? ''} onChange={(e) => upd('timeout', Number(e.target.value) || undefined)} /></label>
            <label>Color<input name="color" type="color" value={draft.color || DEFAULT_COLOR} onChange={(e) => upd('color', e.target.value)} /></label>
          </div>
          <div className="cm-opts">
            {OPTIONS.map(([k, label]) => (
              <label key={k} className="check"><input name={k} type="checkbox" checked={!!draft[k]} onChange={(e) => upd(k, e.target.checked as never)} />{label}</label>
            ))}
          </div>
          <label>Tags<input name="tags" value={draft.tags ?? ''} onChange={(e) => upd('tags', e.target.value)} placeholder="comma list, the filter searches them" /></label>
          <details className="cm-more" data-testid="cm-more">
            <summary>More options</summary>
            <div className="cm-opts">
              {MORE_FLAGS.map(([k, label]) => (
                <label key={k} className="check"><input name={k} type="checkbox" checked={!!draft[k]} onChange={(e) => upd(k, e.target.checked as never)} />{label}</label>
              ))}
            </div>
            {MORE_TEXT.map(([k, label, rows, hint]) => (
              <label key={k}>{label}
                {rows === 0
                  ? <input name={k} className="mono" value={String(draft[k] ?? '')} placeholder={hint} spellCheck={false} onChange={(e) => upd(k, e.target.value as never)} />
                  : <textarea name={k} className="mono" rows={rows} value={String(draft[k] ?? '')} placeholder={hint} spellCheck={false} onChange={(e) => upd(k, e.target.value as never)} />}
              </label>
            ))}
          </details>
          <div className={`cm-test${test.r ? (test.r.ok ? ' ok' : ' err') : ''}`} data-testid="cm-test-result">
            {test.busy && 'Testing…'}
            {test.r?.ok && (test.r.version ? `OK: ${test.r.product} ${test.r.version} as ${test.r.user}${test.r.ms != null ? ` (${test.r.ms} ms)` : ''}` : test.r.product)}
            {test.r && !test.r.ok && `Failed: ${test.r.error}`}
          </div>
          {error && <div className="cm-test err">{error}</div>}
          <button type="submit" hidden />
        </form>
      </div>
      <div className="cm-foot">
        <button type="button" className="btn" disabled={test.busy || !draft.url} onClick={() => void runTest()}>Test</button>
        <span className="grow" />
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button type="button" className="btn" disabled={!valid} onClick={() => void save()}>Save</button>
        <button type="button" className="btn" disabled={!valid} title="Open a new statement tab with this profile. Other tabs keep their profile." onClick={() => void connect(true)}>Connect in new tab</button>
        <button type="button" className="btn primary" disabled={!valid} title="All statement tabs and DB Explorers switch to this profile." onClick={() => void connect()}>Connect</button>
      </div>
    </Modal>
  );
}
