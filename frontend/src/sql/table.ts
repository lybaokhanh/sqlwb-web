// Finds the table of a simple single-table SELECT, else undefined.
// "select ... from [schema.]table [alias] [where|order by|group by ...]"
// No joins, no comma lists, no sub-selects in FROM.

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][\w$#]*)`;
const NAME = String.raw`(${IDENT}(?:\.${IDENT})?)`;
const RE = new RegExp(
  String.raw`^\s*select\s+[\s\S]+?\s+from\s+${NAME}(?:\s+(?:as\s+)?(?!where\b|order\b|group\b|having\b|fetch\b|for\b)[A-Za-z_]\w*)?\s*(?:$|;|where\b|order\b|group\b|having\b|fetch\b|for\b)`,
  'i',
);

export function singleTable(sql: string): string | undefined {
  const text = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
  if (/\bjoin\b/i.test(text) || /\bunion\b/i.test(text)) return undefined;
  // FROM part: up to WHERE/ORDER/GROUP; a comma there means several tables.
  const from = text.match(/\bfrom\b([\s\S]*?)(?:\bwhere\b|\border\b|\bgroup\b|\bhaving\b|\bfetch\b|$)/i);
  if (!from || from[1].includes(',') || from[1].includes('(')) return undefined;
  const m = text.match(RE);
  return m ? m[1] : undefined;
}
