// Hidden server connections for the Compare tab. Each has its own server tab id ("<tabId>~cmpA", "<tabId>~cmpB"),
// so the compare never touches the result buffers or the transaction of the statement tab.
// The store ignores messages for tab ids it does not know, so these messages go only to the waiters here.
import { client } from '../api/client';
import type { ColumnInfo, ProfileOptions, ServerMsg } from '../api/protocol';
import { PROFILE_OPTION_KEYS } from '../api/protocol';
import { api } from '../api/rpc';
import { getPassword, newId, useStore } from '../state/store';

/** serverTabId -> profile id of the open hidden connection. */
const open = new Map<string, string>();

function waitFor<T>(match: (m: ServerMsg) => T | undefined, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { off(); reject(new Error(`${what}: no answer from the server.`)); }, ms);
    const off = client.subscribeAll((m) => {
      let v: T | undefined;
      try {
        v = match(m);
      } catch (e) {
        window.clearTimeout(timer);
        off();
        reject(e);
        return;
      }
      if (v !== undefined) { window.clearTimeout(timer); off(); resolve(v); }
    });
  });
}

/** Connects a hidden server tab with a profile. Uses the password in memory. */
export async function connectHidden(serverTabId: string, profileId: string): Promise<void> {
  if (open.get(serverTabId) === profileId) return;
  const p = useStore.getState().profiles[profileId];
  if (!p) throw new Error('Unknown connection profile.');
  const password = getPassword(profileId);
  if (password == null) throw new Error(`Log in to "${p.name}" first: open a tab for it once.`);
  const opts: ProfileOptions = {};
  for (const k of PROFILE_OPTION_KEYS) if (p[k] !== undefined && p[k] !== '') (opts as Record<string, unknown>)[k] = p[k];
  const done = waitFor((m) => {
    if (m.tabId !== serverTabId) return undefined;
    if (m.type === 'connected') return true;
    if (m.type === 'error') throw new Error(m.message);
    return undefined;
  }, 30_000, 'Connect');
  open.delete(serverTabId);
  client.send({
    type: 'connect', tabId: serverTabId,
    profile: {
      ...opts, name: p.name, url: p.url, user: p.user, password, autocommit: false,
      fetchSize: p.fetchSize, sysdba: p.sysdba || undefined, readOnly: p.readOnly || undefined,
    },
  });
  await done;
  open.set(serverTabId, profileId);
}

export function disconnectHidden(serverTabId: string) {
  if (!open.has(serverTabId)) return;
  open.delete(serverTabId);
  client.send({ type: 'disconnect', tabId: serverTabId });
}

export interface QueryResult { columns: ColumnInfo[]; rows: unknown[][] }

/** Max. rows per side. More rows: the compare stops with a message. */
export const MAX_COMPARE_ROWS = 50_000;

/** Runs one SELECT on a hidden connection and fetches all rows. */
export function queryAll(serverTabId: string, sql: string): Promise<QueryResult> {
  const reqId = newId('x');
  let columns: ColumnInfo[] | null = null;
  let resultId = '';
  const rows: unknown[][] = [];
  let ended = false;
  let done = false;
  let error = '';
  return new Promise((resolve, reject) => {
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => finish(new Error('Query: no answer from the server.')), 120_000);
    };
    const finish = (err?: Error) => {
      window.clearTimeout(timer);
      off();
      if (err) reject(err);
      else if (!columns) reject(new Error(error || 'The statement returned no result set.'));
      else resolve({ columns, rows });
    };
    const off = client.subscribeAll((m) => {
      if (m.tabId !== serverTabId) return;
      arm();
      switch (m.type) {
        case 'resultMeta':
          if (m.reqId === reqId && !columns) { columns = m.columns; resultId = m.resultId; }
          break;
        case 'rows':
          if (m.resultId !== resultId) break;
          for (let i = 0; i < m.rows.length; i++) rows[m.offset + i] = m.rows[i];
          if (rows.length > MAX_COMPARE_ROWS) { finish(new Error(`More than ${MAX_COMPARE_ROWS.toLocaleString()} rows. Add a WHERE clause.`)); return; }
          done = m.done;
          if (!done) client.send({ type: 'fetch', tabId: serverTabId, resultId, offset: rows.length, count: 5000 });
          else if (ended) finish();
          break;
        case 'resultClosed':
          if (m.resultId === resultId) { done = true; if (ended) finish(); }
          break;
        case 'varPrompt':
          if (m.reqId === reqId) {
            client.send({ type: 'varValues', tabId: serverTabId, reqId, values: null });
            error = 'Compare does not ask for bind variables. Put the values into the SQL.';
          }
          break;
        case 'message':
          if (m.reqId === reqId && m.level === 'error') error ||= m.text;
          break;
        case 'error':
          if (!m.reqId || m.reqId === reqId) error ||= m.message;
          break;
        case 'execEnd':
          if (m.reqId !== reqId) break;
          ended = true;
          if (!columns) finish(new Error(error || 'The statement returned no result set.'));
          else if (done) finish();
          break;
      }
    });
    arm();
    client.send({
      type: 'execute', tabId: serverTabId, reqId, sql, mode: 'all', cursor: 0, selStart: 0, selEnd: 0,
      maxRows: MAX_COMPARE_ROWS + 1, maxResults: 2, timeout: useStore.getState().timeout || 0,
    });
  });
}

/** Schemas of a hidden connection. */
export function schemasOf(serverTabId: string): Promise<string[]> {
  return api.schemas(serverTabId);
}
