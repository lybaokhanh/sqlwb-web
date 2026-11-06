// Simple SQL statement splitter (client side only: mock server and Ctrl+J).
// The real server uses the SQL Workbench parser.
// Knows ';' and a line with only '/' as delimiters, quotes and comments.

export interface Stmt { sql: string; start: number; end: number }

export function splitStatements(text: string): Stmt[] {
  const out: Stmt[] = [];
  let start = 0;
  let i = 0;
  const n = text.length;
  const push = (end: number, next: number) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const sql = raw.trim();
    if (sql) out.push({ sql, start: start + lead, end: start + lead + sql.length });
    start = next;
  };
  while (i < n) {
    const c = text[i];
    if (c === "'" || c === '"') {
      const q = c;
      i++;
      while (i < n && text[i] !== q) i++;
      i++;
    } else if (c === '-' && text[i + 1] === '-') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
    } else if (c === ';') {
      push(i, i + 1);
      i++;
    } else if (c === '/' && isAloneOnLine(text, i)) {
      push(i, i + 1);
      i++;
    } else {
      i++;
    }
  }
  push(n, n);
  return out;
}

function isAloneOnLine(text: string, i: number): boolean {
  const ls = text.lastIndexOf('\n', i - 1) + 1;
  let le = text.indexOf('\n', i);
  if (le < 0) le = text.length;
  return text.slice(ls, le).trim() === '/';
}

/** The statement that holds the cursor (or the one just before it). */
export function statementAt(text: string, cursor: number): Stmt | undefined {
  const all = splitStatements(text);
  if (all.length === 0) return undefined;
  let best = all[0];
  for (const s of all) {
    if (s.start <= cursor) best = s;
    if (cursor >= s.start && cursor <= s.end) return s;
  }
  return best;
}
