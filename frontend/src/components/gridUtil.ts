// Grid helpers: column widths and value formatting.
import type { ResultSet } from '../state/store';
import { rowsOf } from '../state/rows';

export const ROW_H = 22;
export const ROWNUM_W = 64;
export const DEFAULT_COL_W = 140;
const MIN_W = 48;
const MAX_W = 480;

let canvas: HTMLCanvasElement | null = null;
function measure(text: string, font: string): number {
  canvas ??= document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return text.length * 7.5;
  ctx.font = font;
  return ctx.measureText(text).width;
}

export function fmt(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Width per column from the header and the first 1000 rows. */
export function optimizeWidths(r: ResultSet): number[] {
  const rows = rowsOf(r.id);
  const cs = getComputedStyle(document.documentElement);
  const mono = `13px ${cs.getPropertyValue('--font-mono') || 'monospace'}`;
  const ui = `600 12px ${cs.getPropertyValue('--font-ui') || 'sans-serif'}`;
  const n = Math.min(r.rowCount, 1000);
  return r.columns.map((c, ci) => {
    let w = measure(c.name, ui) + 24;
    for (let i = 0; i < n; i++) {
      const s = fmt(rows[i]?.[ci]);
      if (s.length * 9 > w) w = Math.max(w, measure(s, mono) + 16);
    }
    return Math.round(Math.max(MIN_W, Math.min(MAX_W, w)));
  });
}

export function defaultWidths(r: ResultSet): number[] {
  return r.columns.map((c) => (c.jdbcType === 2 || c.jdbcType === 3 || c.jdbcType === 4 ? 100 : c.jdbcType === 91 || c.jdbcType === 93 ? 160 : DEFAULT_COL_W));
}

export function isNumeric(jdbcType: number): boolean {
  return [-7, -6, -5, 2, 3, 4, 5, 6, 7, 8].includes(jdbcType);
}
