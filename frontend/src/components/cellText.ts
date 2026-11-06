// Long cell values (JSON, XML, multi-line text): detection and pretty format for the cell dialog.
import { fmt } from './gridUtil';

export type CellLang = 'json' | 'xml' | 'sql' | 'plaintext';

/** The server cuts CLOBs at this length and adds " …" (TabConn.MAX_LOB_CHARS). */
const MAX_LOB_CHARS = 32_768;
const LONG_CHARS = 60;

/** Value text as shown in the dialog. */
export function cellText(v: unknown): string {
  return v == null ? '' : fmt(v);
}

/** True when the server sent only the first part of a CLOB. Such a value must not be saved back. */
export function isTruncated(v: unknown): boolean {
  return typeof v === 'string' && v.length > MAX_LOB_CHARS && v.endsWith(' …');
}

/** Double-click opens the dialog (not the inline editor) for these values. */
export function isLongValue(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'object') return true;
  if (typeof v !== 'string') return false;
  if (v.length > LONG_CHARS || v.includes('\n')) return true;
  return detectLang(v) === 'json' || detectLang(v) === 'xml';
}

export function detectLang(text: string): CellLang {
  const t = text.trim();
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      JSON.parse(t);
      return 'json';
    } catch {
      /* not JSON */
    }
  }
  if (t.startsWith('<') && t.endsWith('>') && /<[A-Za-z?!]/.test(t)) return 'xml';
  if (/^\s*(select|with|insert|update|delete|merge|create|alter|begin|declare)\b/i.test(t)) return 'sql';
  return 'plaintext';
}

/** Pretty JSON with 2 spaces. Throws on invalid JSON. */
export function formatJson(text: string): string {
  return JSON.stringify(JSON.parse(text), null, 2);
}

/** One-line JSON. Throws on invalid JSON. */
export function compactJson(text: string): string {
  return JSON.stringify(JSON.parse(text));
}

/** Indents XML by tag depth. Text, comments, CDATA and processing instructions stay as they are. */
export function formatXml(text: string): string {
  const tokens = text.replace(/>\s+</g, '><').trim().match(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) ?? [];
  const out: string[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const pad = '  '.repeat(depth);
    if (tok.startsWith('</')) {
      depth = Math.max(0, depth - 1);
      out.push('  '.repeat(depth) + tok);
    } else if (tok.startsWith('<?') || tok.startsWith('<!') || tok.endsWith('/>')) {
      out.push(pad + tok);
    } else if (tok.startsWith('<')) {
      // <a>text</a> stays on one line
      const next = tokens[i + 1];
      const close = tokens[i + 2];
      if (next !== undefined && !next.startsWith('<') && close?.startsWith('</')) {
        out.push(pad + tok + next.trim() + close);
        i += 2;
      } else {
        out.push(pad + tok);
        depth++;
      }
    } else {
      out.push(pad + tok.trim());
    }
  }
  return out.join('\n');
}
