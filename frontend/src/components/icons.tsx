// Small 16px line icons (stroke = currentColor).
const P: Record<string, string> = {
  execSel: 'M3 2.5v11l8-5.5z M13 3v10',
  execCur: 'M4 2.5v11l9-5.5z',
  cancel: 'M4 4h8v8H4z',
  first: 'M4 3v10 M12 3l-5 5 5 5',
  back: 'M10 3l-5 5 5 5',
  next: 'M6 3l5 5-5 5',
  last: 'M12 3v10 M4 3l5 5-5 5',
  save: 'M3 2.5h8l2.5 2.5v8.5h-10.5z M5.5 2.5v3.5h5v-3.5 M5 13.5v-4h6v4',
  insertRow: 'M2 4h12 M2 8h7 M2 12h7 M12.5 8.5v5 M10 11h5',
  copyRow: 'M5 5h8.5v8.5H5z M3 11V2.5h8.5',
  deleteRow: 'M2 4h12 M2 8h7 M2 12h7 M10 11h5',
  filter: 'M2 3h12l-4.5 5.5v4.5l-3 1.5v-6z',
  commit: 'M3 8.5l3 3 7-7',
  rollback: 'M5 3L2 6l3 3 M2 6h7.5a3.5 3.5 0 0 1 0 7H6',
  connect: 'M6 2v3 M10 2v3 M4 5h8v3a4 4 0 0 1-8 0z M8 12v2.5',
  dbExplorer: 'M8 2c3 0 5 .9 5 2s-2 2-5 2-5-.9-5-2 2-2 5-2z M3 4v8c0 1.1 2 2 5 2s5-.9 5-2V4 M3 8c0 1.1 2 2 5 2s5-.9 5-2',
  moon: 'M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z',
  sun: 'M8 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z M8 1v2 M8 13v2 M1 8h2 M13 8h2 M3 3l1.4 1.4 M11.6 11.6L13 13 M3 13l1.4-1.4 M11.6 4.4L13 3',
  close: 'M4 4l8 8 M12 4l-8 8',
  plus: 'M8 3v10 M3 8h10',
  down: 'M3 6l5 5 5-5',
  tabsSide: 'M2 3h12v10H2z M6 3v10 M3.5 5.5h1 M3.5 7.5h1 M3.5 9.5h1',
  tabsTop: 'M2 3h12v10H2z M2 6h12 M4 4.5h2 M7.5 4.5h2',
};

export function Icon({ name, size = 16 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? ''} />
    </svg>
  );
}
