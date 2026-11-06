// Request/response over the WebSocket, matched by reqId.
// Used for "meta" (-> metaResult) and "saveChanges" (-> saved).
import { client } from './client';
import type { ClientMsg, DbColumn, DbIndexCol, DbObject, DbParam, DbSearchHit, MetaMsg, RowChange } from './protocol';

let seq = 0;
const waiting = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

client.subscribeAll((m) => {
  if (m.type !== 'metaResult' && m.type !== 'saved' && m.type !== 'error') return;
  const id = m.reqId;
  if (!id) return;
  const w = waiting.get(id);
  if (!w) return;
  waiting.delete(id);
  if (m.type === 'error') w.reject(new Error(m.message));
  else if (m.type === 'metaResult') w.resolve(m.items);
  else w.resolve(m.count);
});

function request<T>(build: (reqId: string) => ClientMsg, timeoutMs = 60_000): Promise<T> {
  const reqId = `q${Date.now().toString(36)}${(seq++).toString(36)}`;
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      waiting.delete(reqId);
      reject(new Error('No answer from the server (timeout).'));
    }, timeoutMs);
    waiting.set(reqId, {
      resolve: (v) => { window.clearTimeout(timer); resolve(v as T); },
      reject: (e) => { window.clearTimeout(timer); reject(e); },
    });
    client.send(build(reqId));
  });
}

type MetaArgs = Omit<MetaMsg, 'type' | 'tabId' | 'reqId' | 'what'>;
const meta = <T>(tabId: string, what: MetaMsg['what'], args: MetaArgs = {}, timeoutMs?: number) =>
  request<T>((reqId) => ({ type: 'meta', tabId, reqId, what, ...args }), timeoutMs);

export const api = {
  schemas: (tabId: string) => meta<string[]>(tabId, 'schemas'),
  tableTypes: (tabId: string) => meta<string[]>(tabId, 'tableTypes'),
  objects: (tabId: string, schema: string, types?: string[]) => meta<DbObject[]>(tabId, 'objects', { schema, types }),
  procedures: (tabId: string, schema: string) => meta<DbObject[]>(tabId, 'procedures', { schema }),
  triggers: (tabId: string, schema: string) => meta<DbObject[]>(tabId, 'triggers', { schema }),
  params: (tabId: string, schema: string, name: string) => meta<DbParam[]>(tabId, 'params', { schema, name }),
  /** One table per request; the server stops a query after 30 s. */
  search: (tabId: string, schema: string, name: string, value: string, maxRows: number) =>
    meta<DbSearchHit>(tabId, 'search', { schema, name, value, maxRows }, 45_000),
  columns: (tabId: string, schema: string, name: string) => meta<DbColumn[]>(tabId, 'columns', { schema, name }),
  indexes: (tabId: string, schema: string, name: string) => meta<DbIndexCol[]>(tabId, 'indexes', { schema, name }),
  pk: (tabId: string, schema: string | undefined, name: string) => meta<string[]>(tabId, 'pk', { schema, name }),
  /** The spec names the object type field "type"; that clashes with the message type, so both names are sent. */
  source: (tabId: string, schema: string, name: string, objectType: string) =>
    meta<string>(tabId, 'source', { schema, name, objectType, types: [objectType] }),
  saveChanges: (tabId: string, table: string, changes: RowChange[]) =>
    request<number>((reqId) => ({ type: 'saveChanges', tabId, reqId, table, changes })),
};
