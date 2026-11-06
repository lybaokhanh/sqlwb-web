// Row data lives outside the store: 100k x 20 arrays must not be copied on
// each update. The store keeps only counters (rowCount, version).
const buffers = new Map<string, unknown[][]>();

export function rowsOf(resultId: string): unknown[][] {
  let b = buffers.get(resultId);
  if (!b) buffers.set(resultId, (b = []));
  return b;
}

export function putRows(resultId: string, offset: number, rows: unknown[][]): number {
  const b = rowsOf(resultId);
  for (let i = 0; i < rows.length; i++) b[offset + i] = rows[i];
  return b.length;
}

export function dropRows(resultId: string) {
  buffers.delete(resultId);
}
