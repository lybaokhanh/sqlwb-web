// Smoke test of the HTTP + WebSocket protocol against an in-memory H2 DB (no company DB).
// Usage: node scripts/smoke-ws.mjs [baseUrl]   Exit code 0 = pass.
const base = process.argv[2] || 'http://localhost:8484';
const t0 = Date.now();
const fail = (m) => { console.error('FAIL', m); process.exit(1); };
setTimeout(() => fail('timeout'), 30000);

const r = await fetch(base + '/api/session');
if (r.status !== 200) fail('session ' + r.status);
const cookie = r.headers.get('set-cookie').split(';')[0];
const post = (p, body, method = 'POST') => fetch(base + p, { method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });

const login = await post('/api/login', { name: 'smoke', password: 'smoke-pass' });
if (login.status !== 200) fail('login ' + login.status);
const save = await post('/api/workspace', { tabs: [{ id: 't1', sql: 'select 1', connection: { url: 'x', password: 'secret' } }] }, 'PUT');
if (save.status !== 200) fail('workspace save ' + save.status);
const wsText = await (await fetch(base + '/api/workspace', { headers: { cookie } })).text();
if (wsText.includes('secret') || !wsText.includes('select 1')) fail('workspace content ' + wsText);

const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { cookie } });
const send = (m) => ws.send(JSON.stringify({ tabId: 't1', ...m }));
const exec = (reqId, sql, extra = {}) => send({ type: 'execute', reqId, mode: 'all', cursor: 0, selStart: 0, selEnd: 0, maxRows: 0, timeout: 0, sql, ...extra });
let step = 0;
let stmtEnds = 0;
let closed = 0;

ws.onopen = () => send({ type: 'connect', profile: { url: 'jdbc:h2:mem:smoke;DB_CLOSE_DELAY=-1', user: 'sa', password: '', autocommit: true } });
ws.onmessage = (ev) => {
  const frame = JSON.parse(ev.data);
  if (!Array.isArray(frame)) fail('frame is not an array');
  for (const m of frame) handle(m);
};

function handle(m) {
  if (m.type === 'error') fail(m.message);
  if (m.type === 'message' && m.level === 'error') fail(m.text);
  if (m.type === 'connected') {
    exec('a', "create table t(id int, name varchar(20));\ninsert into t select x, 'n'||x from system_range(1, 1200);\nselect * from t order by id;");
  }
  if (m.type === 'rows' && step === 0) {
    step = 1;
    if (m.rows.length !== 500) fail('first page ' + m.rows.length);
    send({ type: 'fetch', resultId: m.resultId, offset: 500, count: 1000 });
  } else if (m.type === 'rows' && step === 1) {
    if (m.rows.length !== 700 || !m.done || m.total !== 1200) fail('second page ' + m.rows.length + ' ' + m.total);
    step = 2;
    send({ type: 'format', reqId: 'f', sql: 'select a,b from t where a=1' });
  }
  if (m.type === 'formatted') {
    if (!m.sql.startsWith('SELECT a,')) fail('format ' + m.sql);
    exec('c', 'select 1 from dual;\nselect 2 as two from dual;', { mode: 'current', cursor: 30 });
  }
  if (m.type === 'resultMeta' && m.reqId === 'c') {
    if (m.columns[0].name !== 'TWO') fail('current statement picked ' + m.columns[0].name);
    // Variables + bind + 1000-statement script with a cap of 5 open results
    const script = ['WbVarDef lim=3;', 'select count(*) as c from t where id <= :lim;']
      .concat(Array.from({ length: 1000 }, (_, i) => `select ${i} as n from dual;`)).join('\n');
    step = 3;
    exec('d', script, { maxResults: 5 });
  }
  if (m.type === 'rows' && step === 3 && m.rows.length === 1 && m.rows[0][0] === 3) step = 4; // bind :lim worked
  if (m.type === 'stmtEnd' && m.reqId === 'd') {
    if (typeof m.execMs !== 'number' || typeof m.fetchMs !== 'number') fail('stmtEnd timing missing');
    stmtEnds++;
  }
  if (m.type === 'resultClosed') closed++;
  if (m.type === 'execEnd' && m.reqId === 'd') {
    if (step !== 4) fail('bind variable result not seen');
    if (stmtEnds !== 1002) fail('stmtEnd count ' + stmtEnds);
    if (closed < 990) fail('resultClosed count ' + closed);
    scriptMs = m.ms;
    send({ type: 'meta', reqId: 'm1', what: 'columns', schema: 'PUBLIC', name: 'T' });
  }
  if (m.type === 'metaResult' && m.reqId === 'm1') {
    if (m.items.map((c) => c.name).join(',') !== 'ID,NAME') fail('columns ' + JSON.stringify(m.items));
    send({ type: 'saveChanges', reqId: 's1', table: 'T', changes: [
      { op: 'update', key: { ID: 1 }, values: { NAME: 'changed' } },
      { op: 'insert', values: { ID: 5000, NAME: 'new' } },
      { op: 'delete', key: { ID: 2 } }] });
  }
  if (m.type === 'saved') {
    if (m.count !== 3) fail('saved count ' + m.count);
    send({ type: 'loadStart', reqId: 'l1', sessions: 2, seconds: 2, sql: 'select count(*) from t;',
      profile: { url: 'jdbc:h2:mem:smoke;DB_CLOSE_DELAY=-1', user: 'sa', password: '' } });
  }
  if (m.type === 'loadEnd') {
    if (!(m.count > 0) || m.errors !== 0 || !(m.p95 > 0)) fail('load ' + JSON.stringify(m));
    console.log(`PASS smoke-ws in ${Date.now() - t0} ms (1002-statement script: ${scriptMs} ms; load: ${m.count} queries, p95 ${m.p95} ms)`);
    process.exit(0);
  }
}
let scriptMs = 0;
