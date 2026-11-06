// In-memory fake server. Same messages as the real backend.
// On with URL ?mock=1, or by itself in dev when /ws fails.
import type {
  ClientMsg, ColumnInfo, CompletionItem, DbObject, ExecuteMsg, FileInfo, LoadStartMsg, LoadStats, MetaMsg, ServerFrame, ServerMsg, SessionResponse, UpdateInfo, UpdateStarted, WorkspaceDoc, ProfilesDoc, SavedProfile, TestResult,
} from './protocol';
import { FIRST_PAGE_ROWS } from './protocol';
import { HttpError } from "./errors";
import { splitStatements, statementAt } from '../sql/split';

type Emit = (m: ServerFrame) => void;

interface MockResult { tabId: string; total: number; cols: ColumnInfo[] }

const COLS = 20;
const KEYWORDS = [
  'select', 'from', 'where', 'and', 'or', 'not', 'null', 'is', 'in', 'as', 'on', 'join', 'left', 'right',
  'inner', 'outer', 'group', 'by', 'order', 'having', 'insert', 'into', 'values', 'update', 'set',
  'delete', 'create', 'table', 'drop', 'alter', 'union', 'all', 'distinct', 'case', 'when', 'then',
  'else', 'end', 'commit', 'rollback', 'asc', 'desc', 'limit', 'like', 'between', 'exists', 'with',
];
const NEWLINE_BEFORE = ['from', 'where', 'group', 'order', 'having', 'union', 'left', 'right', 'inner', 'join', 'values', 'set'];

function columns(): ColumnInfo[] {
  const cols: ColumnInfo[] = [{ name: 'ID', typeName: 'NUMBER', jdbcType: 2, nullable: false }];
  for (let c = 1; c < COLS; c++) {
    const kind = c % 4;
    if (kind === 0) cols.push({ name: `AMOUNT_${c}`, typeName: 'NUMBER(12,2)', jdbcType: 3, nullable: true });
    else if (kind === 1) cols.push({ name: `NAME_${c}`, typeName: 'VARCHAR2(100)', jdbcType: 12, nullable: true });
    else if (kind === 2) cols.push({ name: `CREATED_${c}`, typeName: 'DATE', jdbcType: 93, nullable: true });
    else cols.push({ name: `CODE_${c}`, typeName: 'VARCHAR2(10)', jdbcType: 12, nullable: true });
  }
  return cols;
}

/** "select ... json": one more column PAYLOAD with JSON (cell dialog tests). */
const JSON_COL: ColumnInfo = { name: 'PAYLOAD', typeName: 'CLOB', jdbcType: 2005, nullable: true };
function jsonValue(i: number): string {
  return JSON.stringify({ id: i + 1, tags: ['a', 'b'], owner: { name: `User ${i + 1}`, active: i % 2 === 0 } });
}

function row(i: number, json = false): unknown[] {
  const r: unknown[] = [i + 1];
  for (let c = 1; c < COLS; c++) {
    const kind = c % 4;
    if ((i + c) % 37 === 0) r.push(null);
    else if (kind === 0) r.push(Math.round(((i * 7919 + c * 31) % 100000)) / 100);
    else if (kind === 1) r.push(`Name ${i + 1}-${c}`);
    else if (kind === 2) r.push(new Date(Date.UTC(2020, 0, 1) + ((i * 86400000) % 2e11)).toISOString().slice(0, 19).replace('T', ' '));
    else r.push(`C${(i * 13 + c) % 997}`);
  }
  if (json) r.push(jsonValue(i));
  return r;
}

export function mockFormat(sql: string): string {
  let out = sql.replace(/\b[a-z_]+\b/gi, (w) => (KEYWORDS.includes(w.toLowerCase()) ? w.toUpperCase() : w));
  for (const k of NEWLINE_BEFORE) {
    out = out.replace(new RegExp(`\\s+(${k.toUpperCase()})\\b`, 'g'), '\n$1');
  }
  return out;
}

/** Like Vars.missing on the server: names that need a value before the statement runs. */
function mockMissingVars(sql: string, defined: Map<string, string>, asked: Record<string, string>): string[] {
  const out = new Set<string>();
  for (const m of sql.matchAll(/\$\[([&?])([A-Za-z_][\w.]*)]/g)) {
    if (!(m[2] in asked) && (m[1] === '?' || !defined.has(m[2]))) out.add(m[2]);
  }
  if (!/^\s*(begin|declare|create\s+(or\s+replace\s+)?(trigger|procedure|function|package))\b/i.test(sql)) {
    const plain = sql.replace(/'(?:[^']|'')*'|"[^"]*"|--[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
    for (const m of plain.matchAll(/(?<![:\w]):([A-Za-z_][\w.]*)/g)) {
      if (!defined.has(m[1]) && !(m[1] in asked)) out.add(m[1]);
    }
  }
  return [...out];
}

export class MockServer {
  private sink: Emit = () => {};
  private batch: ServerMsg[] = [];
  private batchTimer: number | undefined;
  private results = new Map<string, MockResult>();
  private cancelled = new Set<string>();
  private connected = new Map<string, boolean>();
  private seq = 0;
  private varWait = new Map<string, (v: Record<string, string> | null) => void>();
  /** WbVarDef values per tab (mock: only `WbVarDef name=value`). */
  private vars = new Map<string, Map<string, string>>();

  onMessage(cb: Emit) { this.sink = cb; }

  /** Like the server: messages go out as arrays, every 25 ms. */
  private emit(m: ServerMsg) {
    this.batch.push(m);
    if (this.batchTimer !== undefined) return;
    this.batchTimer = window.setTimeout(() => {
      this.batchTimer = undefined;
      const b = this.batch;
      this.batch = [];
      this.sink(b);
    }, 25);
  }

  private later(m: ServerMsg, ms = 0) {
    setTimeout(() => this.emit(m), ms);
  }

  send(msg: ClientMsg) {
    switch (msg.type) {
      case 'ping':
        this.later({ type: 'pong' });
        break;
      case 'connect':
        this.connected.set(msg.tabId, msg.profile.autocommit);
        this.later({
          type: 'connected', tabId: msg.tabId,
          info: {
            product: 'Oracle (mock)', version: '19c', user: msg.profile.user || 'mock',
            schema: (msg.profile.user || 'MOCK').toUpperCase(), url: msg.profile.url,
            autocommit: msg.profile.autocommit, ms: 120,
          },
        }, 150);
        break;
      case 'disconnect':
        this.connected.delete(msg.tabId);
        this.later({ type: 'disconnected', tabId: msg.tabId });
        break;
      case 'cancel':
        this.cancelled.add(msg.tabId);
        this.varWait.get(msg.tabId)?.(null);
        break;
      case 'varValues':
        this.varWait.get(msg.tabId)?.(msg.values);
        break;
      case 'commit':
      case 'rollback':
        this.later({ type: 'message', tabId: msg.tabId, reqId: '', level: 'info', text: msg.type === 'commit' ? 'COMMIT successfully executed' : 'ROLLBACK successfully executed' });
        this.later({ type: 'txState', tabId: msg.tabId, open: false });
        break;
      case 'complete':
        this.later({ type: 'completion', tabId: msg.tabId, reqId: msg.reqId, items: mockComplete(msg.sql, msg.cursor) }, 30);
        break;
      case 'hello':
        break;
      case 'format':
        this.later({ type: 'formatted', tabId: msg.tabId, reqId: msg.reqId, sql: mockFormat(msg.sql) }, 30);
        break;
      case 'fetch': {
        const r = this.results.get(msg.resultId);
        if (!r) {
          this.later({ type: 'error', tabId: msg.tabId, message: `Unknown result ${msg.resultId}` });
          break;
        }
        const end = Math.min(r.total, msg.offset + msg.count);
        const rows: unknown[][] = [];
        for (let i = msg.offset; i < end; i++) rows.push(row(i, r.cols.includes(JSON_COL)));
        this.later({ type: 'rows', tabId: msg.tabId, resultId: msg.resultId, offset: msg.offset, rows, done: end >= r.total, total: r.total }, 5);
        break;
      }
      case 'execute':
        void this.execute(msg);
        break;
      case 'meta': {
        const items = mockMeta(msg);
        if (items === undefined) this.later({ type: 'error', tabId: msg.tabId, reqId: msg.reqId, message: `Object not found: ${msg.name}` }, 20);
        else this.later({ type: 'metaResult', tabId: msg.tabId, reqId: msg.reqId, what: msg.what, items }, 40);
        break;
      }
      case 'saveChanges':
        this.later({ type: 'saved', tabId: msg.tabId, reqId: msg.reqId, count: msg.changes.length }, 60);
        break;
      case 'loadStart':
        this.loadStart(msg);
        break;
      case 'loadStop':
        this.loadStop(msg.tabId);
        break;
    }
  }

  private loads = new Map<string, { timer: number; end: () => void }>();

  private loadStart(m: LoadStartMsg) {
    this.loadStop(m.tabId);
    const t0 = performance.now();
    let count = 0;
    let errors = 0;
    const stats = (): LoadStats => {
      const elapsedMs = Math.round(performance.now() - t0);
      const rps = Math.round((m.ratePerSec > 0 ? m.ratePerSec : 180 * m.sessions) * (0.85 + Math.random() * 0.3));
      count += rps;
      if (Math.random() < 0.2) errors++;
      const p50 = Math.round(3 + Math.random() * 3);
      return { elapsedMs, count, errors, rps, p50, p95: p50 * 3, p99: p50 * 5, max: p50 * 9, lastError: errors ? 'ORA-00054: resource busy (mock)' : undefined };
    };
    const end = () => {
      window.clearInterval(timer);
      this.loads.delete(m.tabId);
      this.emit({ type: 'loadEnd', tabId: m.tabId, reqId: m.reqId, sessions: m.sessions, ...stats() });
    };
    const timer = window.setInterval(() => {
      const s = stats();
      if (s.elapsedMs >= m.seconds * 1000) end();
      else this.emit({ type: 'loadStats', tabId: m.tabId, reqId: m.reqId, ...s });
    }, 1000);
    this.loads.set(m.tabId, { timer, end });
  }

  private loadStop(tabId: string) {
    this.loads.get(tabId)?.end();
  }

  private async execute(m: ExecuteMsg) {
    const t0 = performance.now();
    const { tabId, reqId } = m;
    this.cancelled.delete(tabId);
    if (!this.connected.has(tabId)) {
      this.later({ type: 'error', tabId, reqId, message: 'Not connected' });
      this.later({ type: 'execEnd', tabId, reqId, ms: 0, ok: false });
      return;
    }
    let stmts: { sql: string; start: number }[];
    if (m.mode === 'all') stmts = splitStatements(m.sql);
    else if (m.mode === 'selected' && m.selEnd > m.selStart) {
      const part = m.sql.slice(m.selStart, m.selEnd);
      stmts = splitStatements(part).map((s) => ({ sql: s.sql, start: s.start + m.selStart }));
    } else {
      const s = statementAt(m.sql, m.cursor);
      stmts = s ? [s] : [];
    }
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const open: string[] = [];
    const maxResults = m.maxResults > 0 ? m.maxResults : 20;
    let ok = true;
    const answers: Record<string, string> = {};
    for (let index = 0; index < stmts.length; index++) {
      if (this.cancelled.has(tabId)) {
        this.emit({ type: 'message', tabId, reqId, level: 'warn', text: 'Statement cancelled.' });
        ok = false;
        break;
      }
      const { sql, start } = stmts[index];
      const s0 = performance.now();
      this.emit({ type: 'stmtStart', tabId, reqId, index, sql, start });
      // Variables: :name and $[&name] without a value, every $[?name]. Ask once per run, like the server.
      const def = sql.match(/^\s*wbvardef\s+([A-Za-z_][\w.]*)\s*=\s*(.*?)\s*;?\s*$/is);
      if (def) {
        if (!this.vars.has(tabId)) this.vars.set(tabId, new Map());
        this.vars.get(tabId)!.set(def[1], def[2].replace(/^'(.*)'$/s, '$1'));
        this.emit({ type: 'message', tabId, reqId, level: 'info', text: `Variable ${def[1]} defined with value '${def[2]}'` });
        this.emit({ type: 'stmtEnd', tabId, reqId, index, ms: 0, execMs: 0, fetchMs: 0, rows: 0 });
        continue;
      }
      const defined = this.vars.get(tabId) ?? new Map<string, string>();
      const need = mockMissingVars(sql, defined, answers);
      if (need.length) {
        const values = await new Promise<Record<string, string> | null>((resolve) => {
          this.varWait.set(tabId, resolve);
          this.emit({ type: 'varPrompt', tabId, reqId, index, names: need, values: Object.fromEntries(need.map((n) => [n, defined.get(n) ?? ''])) });
        });
        this.varWait.delete(tabId);
        if (!values) {
          this.emit({ type: 'message', tabId, reqId, level: 'warn', text: `Cancelled: no value for ${need.join(', ')}` });
          this.emit({ type: 'stmtEnd', tabId, reqId, index, ms: 0, error: true, execMs: 0, fetchMs: 0, rows: 0 });
          ok = false;
          break;
        }
        Object.assign(answers, values);
        this.emit({ type: 'message', tabId, reqId, level: 'info', text: `Variables: ${need.map((n) => `${n} = '${values[n] ?? ''}'`).join(', ')}` });
      }
      // Short pause only for small runs, so big scripts stay fast.
      if (stmts.length < 50) await sleep(40);
      const verb = sql.trim().split(/\s+/)[0].toLowerCase();
      let affected = 0;
      if (/^error\b/i.test(sql.trim()) || sql.toLowerCase().includes('fail')) {
        this.emit({ type: 'message', tabId, reqId, level: 'error', text: 'ORA-00900: invalid SQL statement (mock)' });
        const ms = Math.round(performance.now() - s0);
        this.emit({ type: 'stmtEnd', tabId, reqId, index, ms, error: true, execMs: ms, fetchMs: 0, rows: 0 });
        ok = false;
        continue;
      }
      if (verb === 'select' || verb === 'with') {
        const num = sql.match(/\d+/);
        let total = num ? parseInt(num[0], 10) : 50;
        if (m.maxRows > 0) total = Math.min(total, m.maxRows);
        const resultId = `m${++this.seq}`;
        const json = /\bjson\b/i.test(sql);
        const cols = json ? [...columns(), JSON_COL] : columns();
        this.results.set(resultId, { tabId, total, cols });
        this.emit({ type: 'resultMeta', tabId, reqId, resultId, sql, columns: cols });
        const first = Math.min(FIRST_PAGE_ROWS, total);
        const rows: unknown[][] = [];
        for (let i = 0; i < first; i++) rows.push(row(i, json));
        const done = first >= total;
        this.emit({ type: 'rows', tabId, resultId, offset: 0, rows, done, total: done ? total : -1 });
        this.emit({ type: 'message', tabId, reqId, level: 'info', text: `${total} rows retrieved` });
        affected = total;
        open.push(resultId);
        while (open.length > maxResults) {
          const old = open.shift()!;
          this.results.delete(old);
          this.emit({ type: 'resultClosed', tabId, resultId: old });
        }
      } else if (verb === 'commit' || verb === 'rollback') {
        this.emit({ type: 'message', tabId, reqId, level: 'info', text: `${verb.toUpperCase()} successfully executed` });
        this.emit({ type: 'txState', tabId, open: false });
      } else {
        const count = (sql.length * 7) % 11;
        this.emit({ type: 'updateCount', tabId, reqId, count });
        affected = count;
        this.emit({ type: 'message', tabId, reqId, level: 'info', text: `${count} rows affected` });
        if (!this.connected.get(tabId) && ['insert', 'update', 'delete', 'merge'].includes(verb)) this.emit({ type: 'txState', tabId, open: true });
      }
      const ms = Math.round(performance.now() - s0);
      const fetchMs = Math.round(ms * 0.3);
      this.emit({ type: 'stmtEnd', tabId, reqId, index, ms, execMs: ms - fetchMs, fetchMs, rows: affected });
    }
    this.emit({ type: 'execEnd', tabId, reqId, ms: Math.round(performance.now() - t0), ok });
  }
}


// ---- Mock metadata (DB Explorer) ----
const MOCK_OBJECTS: DbObject[] = [
  { name: 'BONUS', type: 'TABLE', remarks: 'No primary key' },
  { name: 'CUSTOMERS', type: 'TABLE' },
  { name: 'DEPT', type: 'TABLE', remarks: 'Departments' },
  { name: 'EMP', type: 'TABLE', remarks: 'Employees' },
  { name: 'ORDERS', type: 'TABLE' },
  { name: 'EMP_V', type: 'VIEW' },
  { name: 'GET_SALARY', type: 'FUNCTION', status: 'VALID' },
  { name: 'PAYROLL', type: 'PACKAGE', status: 'VALID' },
  { name: 'RAISE_SALARY', type: 'PROCEDURE', status: 'INVALID' },
  { name: 'EMP_SEQ', type: 'SEQUENCE', status: 'VALID' },
  { name: 'EMP_BIU', type: 'TRIGGER', status: 'ENABLED', table: 'EMP', event: 'INSERT OR UPDATE', timing: 'BEFORE EACH ROW' },
];
const CODE_TYPES = ['PROCEDURE', 'FUNCTION', 'PACKAGE'];

function mockMeta(m: MetaMsg): unknown {
  const obj = MOCK_OBJECTS.find((o) => o.name === (m.name ?? '').toUpperCase().split('.').pop());
  switch (m.what) {
    case 'schemas':
      return ['HR', 'SCOTT', 'SYS', 'SYSTEM'];
    case 'tableTypes':
      return ['SYNONYM', 'TABLE', 'VIEW', 'SEQUENCE', 'TYPE'];
    case 'objects': {
      const all = !m.types?.length || m.types.includes('*');
      return MOCK_OBJECTS.filter((o) => o.type !== 'TRIGGER' && !CODE_TYPES.includes(o.type) && (all || m.types!.includes(o.type)));
    }
    case 'procedures':
      return MOCK_OBJECTS.filter((o) => CODE_TYPES.includes(o.type));
    case 'triggers':
      return MOCK_OBJECTS.filter((o) => o.type === 'TRIGGER');
    case 'params':
      if (!obj) return undefined;
      return obj.type === 'FUNCTION'
        ? [{ object: obj.name, name: '(return)', position: 0, mode: 'OUT', type: 'NUMBER' }, { object: obj.name, name: 'P_EMP_ID', position: 1, mode: 'IN', type: 'NUMBER' }]
        : [{ object: obj.type === 'PACKAGE' ? 'RUN' : obj.name, name: 'P_PCT', position: 1, mode: 'IN', type: 'NUMBER' }];
    case 'search': {
      if (!obj) return undefined;
      const v = (m.value ?? '').replace(/%/g, '').toUpperCase();
      const cols = columns().map((c) => c.name);
      const rows = obj.name === 'EMP' || obj.name === 'CUSTOMERS'
        ? Array.from({ length: 3 }, (_, i) => cols.map((_, j) => (j === 0 ? String(i + 1) : j === 1 ? `${v} ${i + 1}` : null)))
        : [];
      return { columns: cols, rows };
    }
    case 'columns':
      if (!obj) return undefined;
      return columns().map((c, i) => ({
        name: c.name, type: c.typeName.replace(/\(.*/, ''), size: c.jdbcType === 12 ? 100 : 12, digits: c.jdbcType === 3 ? 2 : 0,
        nullable: c.nullable, default: null, remarks: i === 0 ? 'Primary key' : null, position: i + 1,
      }));
    case 'indexes':
      if (!obj) return undefined;
      return obj.name === 'BONUS' ? [] : [
        { name: `PK_${obj.name}`, unique: true, column: 'ID', position: 1 },
        { name: `IX_${obj.name}_NAME`, unique: false, column: 'NAME_1', position: 1 },
      ];
    case 'pk':
      if (!obj) return [];
      return obj.name === 'BONUS' ? [] : ['ID'];
    case 'source': {
      if (!obj) return undefined;
      if (obj.type === 'TABLE') {
        const cols = columns().map((c) => `  ${c.name.padEnd(12)} ${c.typeName}${c.nullable ? '' : ' NOT NULL'}`).join(',\n');
        return `CREATE TABLE ${m.schema}.${obj.name}\n(\n${cols}${obj.name === 'BONUS' ? '' : `,\n  CONSTRAINT PK_${obj.name} PRIMARY KEY (ID)`}\n);\n`;
      }
      if (obj.type === 'VIEW') return `CREATE OR REPLACE VIEW ${m.schema}.${obj.name}\nAS\nSELECT ID, NAME_1\nFROM ${m.schema}.EMP;\n`;
      return `CREATE OR REPLACE ${obj.type} ${m.schema}.${obj.name}\nIS\nBEGIN\n  NULL; -- mock source\nEND;\n/\n`;
    }
  }
  return undefined;
}

// ---- Mock completion (Ctrl+Space) ----
const MOCK_TABLES: Record<string, [string, string][]> = {
  DEPARTMENTS: [['DEPARTMENT_ID', 'NUMBER(4)'], ['DEPARTMENT_NAME', 'VARCHAR2(30)'], ['LOCATION_ID', 'NUMBER(4)']],
  EMPLOYEES: [['EMPLOYEE_ID', 'NUMBER(6)'], ['FIRST_NAME', 'VARCHAR2(20)'], ['LAST_NAME', 'VARCHAR2(25)'], ['SALARY', 'NUMBER(8,2)'], ['DEPARTMENT_ID', 'NUMBER(4)']],
};
const TABLE_CONTEXT = ['from', 'join', 'into', 'update', 'table'];

/** Like the jar: tables after FROM / JOIN / INTO, else the columns of the tables in the statement. */
function mockComplete(sql: string, cursor: number): CompletionItem[] {
  const start = sql.lastIndexOf(';', cursor - 1) + 1;
  const endAt = sql.indexOf(';', cursor);
  const stmt = sql.slice(start, endAt < 0 ? sql.length : endAt);
  const last = sql.slice(start, cursor).match(/(\w+)\s+\w*$/)?.[1]?.toLowerCase() ?? '';
  if (TABLE_CONTEXT.includes(last)) {
    return Object.keys(MOCK_TABLES).map((t) => ({ label: t, insert: t, kind: 'table', detail: 'HR TABLE' }));
  }
  const used = [...stmt.matchAll(/\b(?:from|join)\s+(\w+)/gi)].map((m) => m[1].toUpperCase()).filter((t) => MOCK_TABLES[t]);
  return (used.length ? used : Object.keys(MOCK_TABLES))
    .flatMap((t) => MOCK_TABLES[t].map(([c, type]) => ({ label: c, insert: c, kind: 'column' as const, detail: type })));
}

// ---- Mock file area (browser memory) ----
const files = new Map<string, { blob: Blob; modified: number }>([
  ['export/employees.csv', { blob: new Blob(['EMPLOYEE_ID,LAST_NAME\n100,King\n']), modified: Date.UTC(2026, 10, 5) }],
]);
export const mockFiles = {
  list(): FileInfo[] {
    return [...files.entries()].map(([name, f]) => ({ name, size: f.blob.size, modified: f.modified }))
      .sort((a, b) => b.modified - a.modified);
  },
  async put(name: string, blob: Blob) { files.set(name, { blob, modified: Date.now() }); },
  remove(name: string) { files.delete(name); },
  url(name: string): string {
    const f = files.get(name);
    return f ? URL.createObjectURL(f.blob) : '#';
  },
};

// ---- Mock HTTP (session, login, workspace, update) ----
const MOCK_USER_KEY = 'sqlwb.mock.user';
const MOCK_WS_KEY = 'sqlwb.mock.workspace';
const MOCK_CURRENT = '132';
const MOCK_WS_VER_KEY = 'sqlwb.mock.workspace.ver';
const MOCK_PROFILES_KEY = 'sqlwb.mock.profiles';
/** Tests set this key to make workspace saves fail. */
const MOCK_FAIL_SAVE_KEY = 'sqlwb.mock.failSave';

function lsGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}

function ss(k: string, v?: string | null): string | null {
  try {
    if (v === undefined) return sessionStorage.getItem(k);
    if (v === null) sessionStorage.removeItem(k);
    else sessionStorage.setItem(k, v);
  } catch { /* storage blocked */ }
  return null;
}

export const mockHttp = {
  session(): SessionResponse {
    const user = ss(MOCK_USER_KEY) ?? '';
    return { user, admin: !!user };
  },
  /** Mock: every login works. */
  login(name: string): SessionResponse {
    ss(MOCK_USER_KEY, name);
    return { user: name, admin: true };
  },
  logout() { ss(MOCK_USER_KEY, null); },
  getWorkspace(): WorkspaceDoc {
    try {
      return JSON.parse(localStorage.getItem(MOCK_WS_KEY) ?? '{}') as WorkspaceDoc;
    } catch {
      return {};
    }
  },
  workspaceVersion(): number {
    return Number(lsGet(MOCK_WS_VER_KEY) ?? '0');
  },
  /** Same rule as the server: HTTP 409 when expect >= 0 and another tab saved first. */
  putWorkspace(doc: WorkspaceDoc, expect: number): number {
    const ver = this.workspaceVersion();
    if (expect >= 0 && expect !== ver) throw new HttpError(409, 'Saved from another browser tab');
    if (lsGet(MOCK_FAIL_SAVE_KEY)) throw new HttpError(503, 'Mock: save blocked');
    try {
      localStorage.setItem(MOCK_WS_KEY, JSON.stringify(doc));
      localStorage.setItem(MOCK_WS_VER_KEY, String(ver + 1));
    } catch { /* storage blocked */ }
    return ver + 1;
  },
  getProfiles(): ProfilesDoc {
    try {
      return JSON.parse(localStorage.getItem(MOCK_PROFILES_KEY) ?? '{"profiles":[]}') as ProfilesDoc;
    } catch {
      return { profiles: [] };
    }
  },
  /** Mock keeps the password only when savePassword is set (the server encrypts it). */
  putProfiles(doc: ProfilesDoc) {
    const copy = { ...doc, profiles: doc.profiles.map((p) => (p.savePassword ? p : { ...p, password: undefined })) };
    try { localStorage.setItem(MOCK_PROFILES_KEY, JSON.stringify(copy)); } catch { /* storage blocked */ }
  },
  /** Mock import: one profile per <name> found in the text. */
  importProfiles(content: string): SavedProfile[] {
    return [...content.matchAll(/<name>([^<]+)<\/name>/g)].map((m, i) => ({
      name: m[1], group: 'imported', url: 'jdbc:oracle:thin:@//localhost:1521/FREEPDB1', user: m[1].toLowerCase(),
      password: 'pw', savePassword: true, autocommit: false, readOnly: i === 0,
    }));
  },
  testConnection(p: { user: string; password: string }): TestResult {
    return p.password === 'wrong'
      ? { ok: false, error: 'ORA-01017: invalid username/password; logon denied (mock)', ms: 12 }
      : { ok: true, product: 'Oracle', version: '19.18 (mock)', user: p.user.toUpperCase(), ms: 12 };
  },
  update(): UpdateInfo {
    return { current: MOCK_CURRENT, latest: String(Number(MOCK_CURRENT) + 1), latestDate: '2026-11-01', updateAvailable: true };
  },
  startUpdate(): UpdateStarted {
    return { message: 'Update started (mock)', activeSessions: 1 };
  },
};