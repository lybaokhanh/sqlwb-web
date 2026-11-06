// Benchmark of sqlwb-web against a real DB. Runs in a node container next to the app (see RUNBOOK.md).
// Env: BASE (default http://localhost:8484), USERS (parallel users, default 10), DB_URL, DB_USER, DB_PASSWORD (never printed).
// Prints a Markdown table. Exit code 0 = all targets met, 1 = a target missed, 2 = error.
const BASE = process.env.BASE || 'http://localhost:8484';
const USERS = Number(process.env.USERS || 10);
const DB = { url: process.env.DB_URL, user: process.env.DB_USER, password: process.env.DB_PASSWORD, autocommit: true };
if (!DB.url || !DB.user || !DB.password) { console.error('Set DB_URL, DB_USER, DB_PASSWORD'); process.exit(2); }
const oracle = DB.url.startsWith('jdbc:oracle:');
const DUAL = oracle ? ' from dual' : '';

async function client(name) {
  const r = await fetch(BASE + '/api/session');
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const l = await fetch(BASE + '/api/login', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name, password: 'bench-' + name }) });
  if (l.status !== 200) throw new Error('login ' + l.status);
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/ws', { headers: { cookie } });
  const waiters = [];
  ws.onmessage = (ev) => { for (const m of JSON.parse(ev.data)) { if (process.env.DEBUG) console.error('<', m.type, m.reqId || '', m.text || m.message || ''); for (const w of [...waiters]) w(m); } };
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
  const c = {
    ws,
    send: (m) => ws.send(JSON.stringify({ tabId: 't1', ...m })),
    until: (pred, onMsg) => new Promise((ok, ko) => {
      const w = (m) => {
        if (m.type === 'error' || (m.type === 'message' && m.level === 'error')) { waiters.splice(waiters.indexOf(w), 1); ko(new Error(m.message || m.text)); return; }
        if (onMsg) onMsg(m);
        if (pred(m)) { waiters.splice(waiters.indexOf(w), 1); ok(m); }
      };
      waiters.push(w);
    }),
  };
  c.send({ type: 'connect', profile: DB });
  await c.until((m) => m.type === 'connected');
  return c;
}
const exec = (c, reqId, sql, extra = {}) => c.send({ type: 'execute', reqId, mode: 'all', cursor: 0, selStart: 0, selEnd: 0, maxRows: 0, timeout: 0, maxResults: 20, sql, ...extra });
const rows = [];

try {
  console.error('connect');
  const c = await client('bench0');
  // Warm-up: the server is a long-running JVM, so measure it warm (JIT compiled)
  const script = Array.from({ length: 1000 }, (_, i) => `select ${i} as n${DUAL};`).join('\n');
  for (const w of ['w1', 'w2']) {
    const done = c.until((m) => m.type === 'execEnd' && m.reqId === w);
    exec(c, w, script);
    await done;
  }

  console.error('step 1: script (3 runs, median)');
  // 1. 1,000 statements in one script: app overhead = server wall time - DB time (execute + first fetch)
  const runs = [];
  for (const id of ['s1', 's2', 's3']) {
    let dbMs = 0;
    const t1 = performance.now();
    const done = c.until((m) => m.type === 'execEnd' && m.reqId === id, (m) => { if (m.type === 'stmtEnd' && m.reqId === id) dbMs += m.execMs + m.fetchMs; });
    exec(c, id, script);
    const end = await done;
    runs.push({ ms: end.ms, db: dbMs, parse: end.parseMs, client: performance.now() - t1, pct: (end.ms - dbMs) / end.ms * 100 });
  }
  runs.sort((a, b) => a.pct - b.pct);
  const r1 = runs[1];
  console.error('runs: ' + runs.map((r) => r.pct.toFixed(1) + '%').join(', '));
  rows.push(['1,000 statements, app overhead (median of 3, warm)', `${r1.pct.toFixed(1)}% (server ${r1.ms.toFixed(0)} ms, DB ${r1.db.toFixed(0)} ms, parse ${r1.parse.toFixed(1)} ms, client ${r1.client.toFixed(0)} ms)`, '< 5%', r1.pct < 5]);
  console.error('step 2: 100k rows');
  // 2. 100k rows x 20 cols: time to the first page of 500 rows at the client
  const cols = Array.from({ length: 20 }, (_, i) => i % 2 ? `'txt'||level as c${i}` : `level*${i} as c${i}`).join(', ');
  const big = oracle ? `select ${cols} from dual connect by level <= 100000` : `select ${cols.replaceAll('level', 'x')} from system_range(1, 100000)`;
  const t2 = performance.now();
  const bigEnd = c.until((m) => m.type === 'execEnd' && m.reqId === 'big');
  const firstRows = c.until((m) => m.type === 'rows');
  exec(c, 'big', big);
  await firstRows;
  const first = performance.now() - t2;
  rows.push(['100k x 20, first 500 rows at the client', `${first.toFixed(0)} ms`, '< 1000 ms', first < 1000]);
  await bigEnd;
  c.ws.close();

  console.error(`step 3: ${USERS} users`);
  // 3. USERS users in parallel, short select for 20 s each
  const users = await Promise.all(Array.from({ length: USERS }, (_, i) => client('bench' + (i + 1))));
  const lat = [];
  const stopAt = performance.now() + 20000;
  await Promise.all(users.map(async (u, i) => {
    let n = 0;
    while (performance.now() < stopAt) {
      const t = performance.now();
      exec(u, `q${i}-${n}`, `select 1 as one${DUAL}`);
      const id = `q${i}-${n++}`;
      await u.until((m) => m.type === 'execEnd' && m.reqId === id);
      lat.push(performance.now() - t);
    }
    u.ws.close();
  }));
  lat.sort((a, b) => a - b);
  const p95 = lat[Math.ceil(lat.length * 0.95) - 1];
  rows.push([`${USERS} users, short select, p95 round trip`, `${p95.toFixed(1)} ms (${lat.length} queries)`, '< 200 ms', p95 < 200]);
} catch (e) {
  console.error('ERROR', e.message);
  process.exit(2);
}

console.log(`\n| Check | Result | Target | Pass |\n|---|---|---|---|`);
for (const [a, b, t, ok] of rows) console.log(`| ${a} | ${b} | ${t} | ${ok ? 'yes' : 'NO'} |`);
console.log(`\nDate: ${new Date().toISOString()}  Base: ${BASE}  DB: ${DB.url}`);
console.log('CPU: read `docker stats --no-stream sqlwb-web` during the run (target <= 200%).');
process.exit(rows.every((r) => r[3]) ? 0 : 1);
