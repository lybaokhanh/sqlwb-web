// Smoke test: missing :name / $[?name] variables make the server ask (varPrompt) and wait (varValues).
// Usage: node scripts/smoke-vars.mjs [baseUrl]   Needs H2 in JDBC_URL_ALLOW. Exit code 0 = pass.
const base = process.argv[2] || 'http://localhost:8484';
const fail = (m) => { console.error('FAIL', m); process.exit(1); };
setTimeout(() => fail('timeout'), 30000);

const r = await fetch(base + '/api/session');
const cookie = r.headers.get('set-cookie').split(';')[0];
const login = await fetch(base + '/api/login', {
  method: 'POST', headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'smokevars', password: 'smoke-pass' }),
});
if (login.status !== 200) fail('login ' + login.status);

const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { cookie } });
const send = (m) => ws.send(JSON.stringify({ tabId: 'v1', ...m }));
const exec = (reqId, sql) => send({ type: 'execute', reqId, mode: 'all', cursor: 0, selStart: 0, selEnd: 0, maxRows: 0, timeout: 0, sql });
const prompts = {};
const rows = {};
const msgs = [];

ws.onopen = () => send({ type: 'connect', profile: { url: 'jdbc:h2:mem:smokevars' + Date.now() + ';DB_CLOSE_DELAY=-1', user: 'sa', password: '', autocommit: true } });
ws.onmessage = (ev) => { for (const m of JSON.parse(ev.data)) handle(m); };

function handle(m) {
  if (m.type === 'error') fail(m.message);
  if (m.type === 'message') msgs.push(m.text);
  if (m.type === 'connected') {
    exec('setup', "create table orders(region_id int, status_id int, created_on date);\ninsert into orders values (1, 7, date '2026-01-05'), (1, 8, date '2026-02-02'), (2, 7, date '2026-03-02');");
  }
  if (m.type === 'varPrompt') (prompts[m.reqId] ??= []).push(m);
  if (m.type === 'rows') (rows[m.resultId] ??= []).push(...m.rows);
  if (m.type === 'resultMeta') rows[m.reqId] = m.resultId;

  // 1. Two missing binds: one prompt with both names. The value ':x' in a string is not a bind.
  if (m.type === 'execEnd' && m.reqId === 'setup') {
    exec('a', "select count(*) as c, ':notabind' as s from orders where region_id = :regionId and status_id = :statusId;\nselect count(*) as c2 from orders where region_id = :regionId;");
  }
  if (m.type === 'varPrompt' && m.reqId === 'a') {
    if (m.names.join() !== 'regionId,statusId') fail('prompt names ' + m.names);
    send({ type: 'varValues', reqId: 'a', values: { regionId: '1', statusId: '7' } });
  }
  if (m.type === 'execEnd' && m.reqId === 'a') {
    if (!m.ok) fail('run a failed: ' + msgs.slice(-3).join(' | '));
    if (prompts.a.length !== 1) fail('asked ' + prompts.a.length + ' times in one run (expect 1)');
    if (!msgs.some((t) => t.includes("regionId = '1'"))) fail('no "Variables:" message: ' + JSON.stringify(msgs));
    // 2. Next run asks again, prefilled with the last values. Cancel stops the run.
    exec('b', 'select * from orders where region_id = :regionId');
  }
  if (m.type === 'varPrompt' && m.reqId === 'b') {
    if (m.values.regionId !== '1') fail('prefill ' + JSON.stringify(m.values));
    send({ type: 'varValues', reqId: 'b', values: null });
  }
  if (m.type === 'execEnd' && m.reqId === 'b') {
    if (m.ok) fail('cancelled run reports ok');
    if (!msgs.some((t) => t.startsWith('Cancelled: no value for regionId'))) fail('no cancel message');
    // 3. WbVarDef value: no prompt. $[?name]: always a prompt.
    exec('c', "WbVarDef regionId=2;\nselect count(*) as c from orders where region_id = :regionId and status_id = $[?status];");
  }
  if (m.type === 'varPrompt' && m.reqId === 'c') {
    if (m.names.join() !== 'status') fail('prompt c names ' + m.names);
    send({ type: 'varValues', reqId: 'c', values: { status: '7' } });
  }
  if (m.type === 'execEnd' && m.reqId === 'c') {
    if (!m.ok) fail('run c failed: ' + msgs.slice(-3).join(' | '));
    console.log('PASS smoke-vars');
    process.exit(0);
  }
}
