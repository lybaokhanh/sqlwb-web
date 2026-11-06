// Smoke test of window routing, Wb commands, the file area, completion and profile options (H2 in memory).
// Usage: node scripts/smoke-wb.mjs [baseUrl]   Exit code 0 = pass, "PASS smoke-wb" on stdout.
const base = process.argv[2] || 'http://localhost:8484';
const fail = (m) => { console.error('FAIL', m); process.exit(1); };
setTimeout(() => fail('timeout'), 60000);
const ok = (m) => console.log('ok  ', m);

const r = await fetch(base + '/api/session');
const cookie = r.headers.get('set-cookie').split(';')[0];
const req = (p, method = 'GET', body) => fetch(base + p, { method, headers: { cookie, 'content-type': 'application/json' }, body });
if ((await req('/api/login', 'POST', JSON.stringify({ name: 'smokewb', password: 'smoke-pass' }))).status !== 200) fail('login');

/** One browser tab: a WebSocket with its window id. Returns helpers to send and wait for messages. */
function win(id) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { cookie } });
  const msgs = [];
  const waiters = [];
  ws.onmessage = (ev) => {
    for (const m of JSON.parse(ev.data)) {
      msgs.push(m);
      for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
    }
  };
  const open = new Promise((res) => { ws.onopen = () => { ws.send(JSON.stringify({ type: 'hello', win: id })); res(); }; });
  const send = (m) => ws.send(JSON.stringify({ tabId: 't1', ...m }));
  const wait = (pred) => {
    const hit = msgs.find(pred);
    return hit ? Promise.resolve(hit) : new Promise((res) => waiters.push({ pred, res }));
  };
  /** Runs SQL and returns all messages of that request after execEnd. */
  const exec = async (reqId, sql) => {
    send({ type: 'execute', reqId, mode: 'all', cursor: 0, selStart: 0, selEnd: 0, maxRows: 0, timeout: 0, sql });
    await wait((m) => m.type === 'execEnd' && m.reqId === reqId);
    const ids = new Set(msgs.filter((m) => m.reqId === reqId && m.resultId).map((m) => m.resultId));
    return msgs.filter((m) => m.reqId === reqId || (m.resultId && ids.has(m.resultId)));
  };
  return { ws, msgs, open, send, wait, exec };
}

const RUN = Date.now().toString(36);
const profile = (db, extra = {}) => ({ url: `jdbc:h2:mem:${db}${RUN};DB_CLOSE_DELAY=-1`, user: 'sa', password: '', autocommit: true, ...extra });

// 1. Two windows, same tab id "t1": each gets only its own result
const a = win('wA');
const b = win('wB');
await Promise.all([a.open, b.open]);
a.send({ type: 'connect', profile: profile('smokeA') });
b.send({ type: 'connect', profile: profile('smokeB') });
await Promise.all([a.wait((m) => m.type === 'connected'), b.wait((m) => m.type === 'connected')]);
const [ra, rb] = await Promise.all([a.exec('qa', "select 'A' as w from dual"), b.exec('qb', "select 'B' as w from dual")]);
const rowA = ra.find((m) => m.type === 'rows');
const rowB = rb.find((m) => m.type === 'rows');
if (rowA?.rows[0][0] !== 'A' || rowB?.rows[0][0] !== 'B') fail(`window results ${JSON.stringify(rowA?.rows)} ${JSON.stringify(rowB?.rows)}`);
if (a.msgs.some((m) => m.reqId === 'qb') || b.msgs.some((m) => m.reqId === 'qa')) fail('a window got the other window messages');
ok('two windows: own results only');
const live = await (await req('/api/tabs?win=wA')).json();
if (!live.t1) fail('GET /api/tabs?win=wA ' + JSON.stringify(live));
ok('GET /api/tabs?win= lists the window tabs');

// 2. Wb commands
const setup = await a.exec('s', 'create table t1(id int primary key, name varchar(20));\ninsert into t1 values (1, \'x\'), (2, \'y\');');
if (setup.some((m) => m.level === 'error')) fail('setup ' + JSON.stringify(setup.filter((m) => m.level === 'error')));
const exp = await a.exec('e', 'WbExport -type=text -file=smoke/t1.txt -delimiter=, -header=true;\nselect * from t1 order by id;');
if (exp.some((m) => m.level === 'error')) fail('WbExport ' + JSON.stringify(exp.filter((m) => m.level === 'error')));
const files = (await (await req('/api/files')).json()).files;
if (!files.some((f) => f.name === 'smoke/t1.txt')) fail('file list ' + JSON.stringify(files) + ' messages: ' + JSON.stringify(exp));
const body = await (await req('/api/files/content?name=smoke/t1.txt')).text();
if (!body.includes('ID,NAME') || !body.includes('2,y')) fail('export content ' + body);
ok('WbExport writes into the file area, download works');

const list = await a.exec('l', 'WbList');
const meta = list.find((m) => m.type === 'resultMeta');
const rows = list.filter((m) => m.type === 'rows').flatMap((m) => m.rows);
if (!meta || !rows.some((row) => row.includes('T1'))) fail('WbList ' + JSON.stringify(list.slice(0, 5)));
ok('WbList shows a grid');
const desc = await a.exec('d', 'desc t1');
if (!desc.some((m) => m.type === 'resultMeta')) fail('DESC ' + JSON.stringify(desc.slice(0, 5)));
ok('DESC shows a grid');

const sys = await a.exec('x', 'WbSysExec -program=id');
if (!sys.some((m) => m.level === 'error' && /blocked/.test(m.text))) fail('WbSysExec not blocked ' + JSON.stringify(sys));
for (const bad of ['WbExport -type=text -file=/data/sqlwb.db', 'WbExport -type=text -file=../x.txt', 'WbExport -file="%ConfigDir%/x"', 'WbInclude ~/x.sql', '@/etc/passwd']) {
  const res = await a.exec('p' + bad.length, bad);
  if (!res.some((m) => m.level === 'error' && /not allowed/.test(m.text))) fail('path not refused: ' + bad + ' ' + JSON.stringify(res));
}
ok('blocked command and paths outside the file area refused');
if ((await req('/api/files/content?name=../x')).status !== 400) fail('download ../x not refused');
ok('download with .. refused (400)');

// 3. Completion
const done = (id) => a.wait((m) => m.type === 'completion' && m.reqId === id);
a.send({ type: 'complete', reqId: 'c1', sql: 'select  from t1', cursor: 7 });
const c1 = await done('c1');
if (!c1.items.some((i) => i.label.toUpperCase() === 'NAME')) fail('column completion ' + JSON.stringify(c1));
a.send({ type: 'complete', reqId: 'c2', sql: 'select 1;\nselect * from ', cursor: 24 });
const c2 = await done('c2');
if (!c2.items.some((i) => i.label.toUpperCase() === 'T1')) fail('table completion ' + JSON.stringify(c2));
ok(`completion: columns (${c1.items.length}) and tables (${c2.items.length})`);

// 4. Profile options: connect script, variables, default schema, ignore DROP errors, alternate delimiter
await a.exec('sc', 'create schema s2;\ncreate table s2.only_s2(v int);');
a.send({ type: 'connect', profile: profile('smokeA', {
  connectScript: 'WbVarDef fromScript=42;\nset @dummy = 1;',
  variables: 'fromProfile=7',
  defaultSchema: 'S2',
  ignoreDropErrors: true,
  altDelimiter: '/',
}) });
await a.wait((m) => m.type === 'message' && /Connect script: \d+ statement/.test(m.text));
const vl = await a.exec('v', 'WbVarList');
const vtext = vl.filter((m) => m.type === 'message').map((m) => m.text).join('\n');
if (!/fromScript = 42/.test(vtext) || !/fromProfile = 7/.test(vtext)) fail('variables ' + vtext);
ok('connect script ran, profile variables set');
const sch = await a.exec('sch', 'select count(*) from only_s2');
if (sch.some((m) => m.level === 'error')) fail('default schema ' + JSON.stringify(sch.filter((m) => m.level === 'error')));
ok('default schema set');
const dr = await a.exec('dr', 'drop table no_such_table;\nselect 1 from dual;');
if (dr.some((m) => m.level === 'error') || !dr.some((m) => m.type === 'rows')) fail('ignore DROP errors ' + JSON.stringify(dr));
ok('DROP error ignored, script goes on');
const alt = await a.exec('alt', 'select 1 as a from dual\n/\nselect 2 as b from dual\n/');
if (alt.filter((m) => m.type === 'resultMeta').length !== 2) fail('alternate delimiter ' + JSON.stringify(alt.filter((m) => m.type !== 'rows')));
ok('alternate delimiter / splits');

await req('/api/files/content?name=smoke/t1.txt', 'DELETE');
a.ws.close();
b.ws.close();
console.log('PASS smoke-wb');
process.exit(0);
