// "Save changes to database" flow: key columns -> confirm -> saveChanges.
import { api } from '../api/rpc';
import { buildChanges, bump, clearEdits, editsOf, hasEdits, previewSql } from './edits';
import { rowsOf } from './rows';
import { log, useStore, type ResultSet } from './store';

function splitName(table: string): [string | undefined, string] {
  const parts = table.split('.');
  return parts.length > 1 ? [parts[0].replace(/"/g, ''), parts[1].replace(/"/g, '')] : [undefined, table.replace(/"/g, '')];
}

/** Key columns from the server, or from the user when the table has no PK. */
async function keyColumns(tabId: string, r: ResultSet): Promise<string[] | null> {
  const e = editsOf(r.id);
  if (e.keys?.length) return e.keys;
  const [schema, name] = splitName(r.table!);
  let pk: string[] = [];
  try {
    pk = await api.pk(tabId, schema, name);
  } catch (err) {
    log(tabId, 'warn', `Could not read the primary key: ${String(err)}`);
  }
  const names = new Set(r.columns.map((c) => c.name.toUpperCase()));
  pk = pk.filter((k) => names.has(k.toUpperCase()))
    .map((k) => r.columns.find((c) => c.name.toUpperCase() === k.toUpperCase())!.name);
  if (pk.length) {
    e.keys = pk;
    return pk;
  }
  return new Promise((resolve) => {
    useStore.setState({
      dialog: {
        kind: 'keys', tabId, resultId: r.id,
        onOk: (cols) => { e.keys = cols; resolve(cols.length ? cols : null); },
      },
    });
  });
}

export async function saveResultChanges(tabId: string, resultId: string) {
  const tab = useStore.getState().tabs.find((t) => t.id === tabId);
  const r = tab?.results.find((x) => x.id === resultId);
  if (!tab || !r?.table || !hasEdits(resultId)) return;
  const e = editsOf(resultId);
  const needKeys = e.changed.size > [...e.inserted].filter((i) => e.changed.has(i)).length
    || [...e.deleted].some((i) => !e.inserted.has(i));
  let keys: string[] = [];
  if (needKeys) {
    const k = await keyColumns(tabId, r);
    if (!k) { log(tabId, 'warn', 'Save cancelled: no key columns.'); return; }
    keys = k;
  }
  const changes = buildChanges(r, keys);
  if (changes.length === 0) return;
  const table = r.table;
  useStore.setState({
    dialog: {
      kind: 'confirm', title: 'Confirm updates', okLabel: 'Save', pre: previewSql(table, changes),
      text: `${changes.length} statement(s) will run against ${table}.`,
      onOk: () => {
        api.saveChanges(tabId, table, changes).then((count) => {
          applySaved(tabId, r);
          const ac = useStore.getState().profiles[tab.profileId]?.autocommit;
          log(tabId, 'info', `${count} row(s) saved to ${table}.${ac ? '' : ' Use Commit to make it final.'}`);
        }, (err) => log(tabId, 'error', `Save failed: ${err instanceof Error ? err.message : String(err)}`));
      },
    },
  });
}

/** After a save: write the changes into the buffer, drop deleted rows. */
function applySaved(tabId: string, r: ResultSet) {
  const e = editsOf(r.id);
  const rows = rowsOf(r.id);
  const out: unknown[][] = [];
  for (let i = 0; i < r.rowCount; i++) {
    if (e.deleted.has(i)) continue;
    const row = (rows[i] ?? r.columns.map(() => null)).slice();
    e.changed.get(i)?.forEach((v, c) => { row[c] = v; });
    out.push(row);
  }
  rows.length = 0;
  out.forEach((x) => rows.push(x));
  clearEdits(r.id);
  bump(tabId, r.id, { rowCount: out.length, sel: undefined });
}
