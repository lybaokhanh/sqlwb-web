// Compare engine: pure functions, no store and no DOM except DOMParser for XML.
// Matches rows of A and B by key columns and compares the other columns with "equal when" options.

export interface CompareOptions {
  /** Whitespace at the start or end does not count. */
  trim: boolean;
  /** Upper and lower case count as equal. */
  kase: boolean;
  /** NULL and '' count as equal. */
  nul: boolean;
  /** JSON and XML: compare by path, not by text. */
  struct: boolean;
  /** JSON arrays: order does not count. */
  arr: boolean;
  /** Display only: the grid hides the ignored columns. */
  hide: boolean;
}

export const DEFAULT_OPTIONS: CompareOptions = { trim: true, kase: false, nul: true, struct: true, arr: false, hide: false };

export type Status = 'same' | 'chg' | 'add' | 'del';
export type StructKind = 'JSON' | 'XML';

export interface PathDiff { p: string; a?: string; b?: string }
export interface StructDiff { kind: StructKind; ch: PathDiff[] }

/** Schema names of A and B (passed through the compare; no option uses them now). */
export interface EnvNames { a: string; b: string }

const NULL_MARK = '\u0000NULL';
const DECIMAL = /^-?\d+(\.\d+)?$/;

function text(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function norm(v: unknown, o: CompareOptions): string {
  let s = text(v);
  if (s == null) return o.nul ? '' : NULL_MARK;
  if (o.trim) s = s.trim();
  if (o.kase) s = s.toLowerCase();
  return s;
}

/** Scalar compare with the options. Plain decimals compare by value (1.50 = 1.5). */
export function valuesEqual(a: unknown, b: unknown, o: CompareOptions, _env?: EnvNames): boolean {
  const ta = text(a);
  const tb = text(b);
  if (o.nul && (ta == null || ta === '') && (tb == null || tb === '')) return true;
  const x = norm(a, o);
  const y = norm(b, o);
  if (x === y) return true;
  if (DECIMAL.test(x) && DECIMAL.test(y)) return Number(x) === Number(y);
  return false;
}

type Parsed = { kind: 'JSON'; v: unknown } | { kind: 'XML'; v: Element };

export function parseStruct(v: unknown): Parsed | null {
  const s = text(v);
  if (s == null) return null;
  const t = s.trim();
  if (/^[[{]/.test(t)) {
    try {
      return { kind: 'JSON', v: JSON.parse(t) };
    } catch {
      return null;
    }
  }
  if (t.startsWith('<') && t.endsWith('>')) {
    const d = new DOMParser().parseFromString(t, 'application/xml');
    if (!d.querySelector('parsererror') && d.documentElement) return { kind: 'XML', v: d.documentElement };
  }
  return null;
}

/** Kind of a value (JSON, XML) or undefined. */
export function structKind(v: unknown): StructKind | undefined {
  return parseStruct(v)?.kind;
}

const jsonKind = (v: unknown) => (Array.isArray(v) ? 'arr' : v && typeof v === 'object' ? 'obj' : 'val');
const jsonShow = (v: unknown) => (v === null ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const sortArr = (v: unknown[], o: CompareOptions) =>
  (o.arr ? v.slice().sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1)) : v);

/**
 * JSON differences in tree order: keys in the order of A, then the keys only in B.
 * A subtree on one side only, or a container that is empty on one side, gives one row with the whole value.
 */
function diffJson(a: unknown, b: unknown, p: string, o: CompareOptions, env: EnvNames, out: PathDiff[]) {
  const ka = jsonKind(a);
  const kb = jsonKind(b);
  if (ka === 'val' && kb === 'val') {
    if (!valuesEqual(jsonShow(a), jsonShow(b), o, env)) out.push({ p, a: jsonShow(a), b: jsonShow(b) });
    return;
  }
  if (ka !== kb) { out.push({ p, a: jsonShow(a), b: jsonShow(b) }); return; }
  if (ka === 'arr') {
    const xa = sortArr(a as unknown[], o);
    const xb = sortArr(b as unknown[], o);
    if (!xa.length || !xb.length) {
      if (xa.length !== xb.length) out.push({ p, a: JSON.stringify(xa), b: JSON.stringify(xb) });
      return;
    }
    for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
      const q = `${p}[${i}]`;
      if (i >= xa.length) out.push({ p: q, b: jsonShow(xb[i]) });
      else if (i >= xb.length) out.push({ p: q, a: jsonShow(xa[i]) });
      else diffJson(xa[i], xb[i], q, o, env, out);
    }
    return;
  }
  const oa = a as Record<string, unknown>;
  const ob = b as Record<string, unknown>;
  const keysA = Object.keys(oa);
  const keysB = Object.keys(ob);
  if (!keysA.length || !keysB.length) {
    if (keysA.length !== keysB.length) out.push({ p, a: JSON.stringify(oa), b: JSON.stringify(ob) });
    return;
  }
  for (const k of [...keysA, ...keysB.filter((x) => !(x in oa))]) {
    const q = `${p}.${k}`;
    if (!(k in ob)) out.push({ p: q, a: jsonShow(oa[k]) });
    else if (!(k in oa)) out.push({ p: q, b: jsonShow(ob[k]) });
    else diffJson(oa[k], ob[k], q, o, env, out);
  }
}

function flatXml(el: Element, p: string, out: Record<string, string>) {
  [...el.attributes].sort((x, y) => (x.name < y.name ? -1 : 1)).forEach((a) => { out[`${p}/@${a.name}`] = a.value; });
  const kids = [...el.children];
  const count: Record<string, number> = {};
  const seen: Record<string, number> = {};
  kids.forEach((k) => { count[k.tagName] = (count[k.tagName] ?? 0) + 1; });
  kids.forEach((k) => {
    const n = k.tagName;
    seen[n] = (seen[n] ?? 0) + 1;
    flatXml(k, `${p}/${n}${count[n] > 1 ? `[${seen[n]}]` : ''}`, out);
  });
  const txt = [...el.childNodes].filter((n) => n.nodeType === 3 || n.nodeType === 4).map((n) => n.nodeValue).join('').trim();
  if (txt || !kids.length) out[`${p}/text()`] = txt;
  return out;
}

/** Differences by path, or null when the values are not both JSON or both XML. */
export function structDiff(a: unknown, b: unknown, o: CompareOptions, env: EnvNames): StructDiff | null {
  const pa = parseStruct(a);
  const pb = parseStruct(b);
  if (!pa || !pb || pa.kind !== pb.kind) return null;
  if (pa.kind === 'JSON') {
    const ch: PathDiff[] = [];
    diffJson(pa.v, pb.v, '$', o, env, ch);
    return { kind: 'JSON', ch };
  }
  const fa = flatXml(pa.v, `/${pa.v.tagName}`, {});
  const fb = flatXml(pb.v as Element, `/${(pb.v as Element).tagName}`, {});
  const paths = [...Object.keys(fa), ...Object.keys(fb).filter((p) => !(p in fa))];
  const ch = paths
    .filter((p) => !(p in fa && p in fb && valuesEqual(fa[p], fb[p], o, env)))
    .map((p) => ({ p, a: fa[p], b: fb[p] }));
  return { kind: pa.kind, ch };
}

export interface CellResult { eq: boolean; s?: StructDiff }

export function compareCell(a: unknown, b: unknown, o: CompareOptions, env: EnvNames): CellResult {
  if (o.struct) {
    const s = structDiff(a, b, o, env);
    if (s) return { eq: !s.ch.length, s };
  }
  return { eq: valuesEqual(a, b, o, env) };
}

/** One working row. id is stable for the life of the compare session (also for new rows). */
export interface WRow { id: number; v: unknown[] }

export interface PairRow {
  st: Status;
  a?: WRow;
  b?: WRow;
  /** Changed flag per column (chg rows). */
  d?: boolean[];
  /** Struct diff per column (both sides JSON or XML). */
  s?: (StructDiff | undefined)[];
  /** Match key. */
  mk: string;
  /** Unique id of the pair (selection, React key). */
  k: string;
}

export function matchKey(v: unknown[], keyIdx: number[]): string {
  return keyIdx.map((i) => (v[i] == null ? '\u0000' : String(v[i]))).join('\u0001');
}

/**
 * Pairs rows by match key. Duplicate keys pair up in order, so no row hides.
 * Key and ignored columns do not count for the status.
 */
export function compareRows(
  a: WRow[], b: WRow[], keyIdx: number[], ignore: Set<number>, o: CompareOptions, env: EnvNames,
): PairRow[] {
  const mb = new Map<string, WRow[]>();
  for (const r of b) {
    const k = matchKey(r.v, keyIdx);
    const list = mb.get(k);
    if (list) list.push(r); else mb.set(k, [r]);
  }
  const keySet = new Set(keyIdx);
  const out: PairRow[] = [];
  for (const ra of a) {
    const mk = matchKey(ra.v, keyIdx);
    const rb = mb.get(mk)?.shift();
    if (!rb) { out.push({ st: 'del', a: ra, mk, k: `a${ra.id}` }); continue; }
    const res = ra.v.map((x, i) => (keySet.has(i) || ignore.has(i) ? { eq: true } : compareCell(x, rb.v[i], o, env)));
    const d = res.map((x) => !x.eq);
    out.push({ st: d.some(Boolean) ? 'chg' : 'same', a: ra, b: rb, d, s: res.map((x) => (x as CellResult).s), mk, k: `a${ra.id}b${rb.id}` });
  }
  mb.forEach((list) => list.forEach((rb) => out.push({ st: 'add', b: rb, mk: matchKey(rb.v, keyIdx), k: `b${rb.id}` })));
  return out;
}

// ---- Text diff for the edit boxes: lines, then words inside changed lines ----

type Op = ['=', number, number] | ['-', number] | ['+', null, number];

function lcs(a: string[], b: string[]): Op[] | null {
  const n = a.length;
  const m = b.length;
  if (n * m > 4e6) return null;
  const dp: Uint32Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) ops.push(['=', i++, j++]);
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(['-', i++]);
    else ops.push(['+', null, j++]);
  }
  while (i < n) ops.push(['-', i++]);
  while (j < m) ops.push(['+', null, j++]);
  return ops;
}

export const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function words(x: string, y: string): [string, string] {
  const tx = x.match(/\w+|\s+|[^\w\s]/g) ?? [];
  const ty = y.match(/\w+|\s+|[^\w\s]/g) ?? [];
  const ops = lcs(tx, ty);
  if (!ops) return [escHtml(x), escHtml(y)];
  let hx = '';
  let hy = '';
  for (const op of ops) {
    if (op[0] === '=') { hx += escHtml(tx[op[1]]); hy += escHtml(ty[op[2]]); }
    else if (op[0] === '-') hx += `<mark class="wd">${escHtml(tx[op[1]])}</mark>`;
    else hy += `<mark class="wa">${escHtml(ty[op[2]])}</mark>`;
  }
  return [hx, hy];
}

export interface TextDiff {
  ha: string; hb: string; add: number; del: number;
  /** Lines in B that only moved, or differ only by spaces or a trailing comma. Soft mark, not a change. */
  mv: number;
}

const line = (cls: string, h: string) => `<span class="l ${cls}">${h || '​'}</span>`;

/** HTML for the two highlight layers. A line that only moved (or differs by spaces or a trailing comma) is not a change. */
export function textDiff(va: string, vb: string): TextDiff {
  const A = va.split('\n');
  const B = vb.split('\n');
  const ops = lcs(A, B);
  if (!ops) return { ha: A.map((l) => line('', escHtml(l))).join(''), hb: B.map((l) => line('', escHtml(l))).join(''), add: 0, del: 0, mv: 0 };
  let ha = '';
  let hb = '';
  let add = 0;
  let del = 0;
  let dels: number[] = [];
  let adds: number[] = [];
  const flush = () => {
    const k = Math.max(dels.length, adds.length);
    for (let x = 0; x < k; x++) {
      const d = dels[x];
      const a = adds[x];
      if (d != null && a != null) {
        const [wx, wy] = words(A[d], B[a]);
        ha += line('ld', wx);
        hb += line('la', wy);
      } else if (d != null) ha += line('ld', escHtml(A[d]));
      else hb += line('la', escHtml(B[a]));
    }
    del += dels.length;
    add += adds.length;
    dels = [];
    adds = [];
  };
  const key = (s: string) => s.trim().replace(/,$/, '');
  const sameA = new Set<number>();
  const sameB = new Set<number>();
  const cb = new Map<string, number>();
  const ca = new Map<string, number>();
  for (const op of ops) if (op[0] === '+') { const k = key(B[op[2]]); cb.set(k, (cb.get(k) ?? 0) + 1); }
  for (const op of ops) {
    if (op[0] !== '-') continue;
    const k = key(A[op[1]]);
    if ((cb.get(k) ?? 0) > 0) { cb.set(k, cb.get(k)! - 1); sameA.add(op[1]); ca.set(k, (ca.get(k) ?? 0) + 1); }
  }
  for (const op of ops) {
    if (op[0] !== '+') continue;
    const k = key(B[op[2]]);
    if ((ca.get(k) ?? 0) > 0) { ca.set(k, ca.get(k)! - 1); sameB.add(op[2]); }
  }
  for (const op of ops) {
    if (op[0] === '=') { flush(); ha += line('', escHtml(A[op[1]])); hb += line('', escHtml(B[op[2]])); }
    else if (op[0] === '-') { if (sameA.has(op[1])) { flush(); ha += line('lm', escHtml(A[op[1]])); } else dels.push(op[1]); }
    else if (sameB.has(op[2])) { flush(); hb += line('lm', escHtml(B[op[2]])); } else adds.push(op[2]);
  }
  flush();
  return { ha, hb, add, del, mv: sameB.size };
}

export function plainLines(v: string): string {
  return v.split('\n').map((l) => line('', escHtml(l))).join('');
}
