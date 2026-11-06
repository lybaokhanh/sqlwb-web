// Small bridge between the store/actions and the lazy Monaco editor.
// All functions are no-ops until the editor is loaded.

export interface EditorBridge {
  /** Current text, cursor offset and selection offsets of the tab. */
  snapshot(tabId: string): { sql: string; cursor: number; selStart: number; selEnd: number } | null;
  setText(tabId: string, sql: string): void;
  /** Insert text at the cursor of the shown tab. */
  insert(text: string): void;
  /** Run a Monaco action, e.g. 'editor.action.commentLine'. */
  run(actionId: string): void;
  focus(): void;
  setCursorOffset(tabId: string, offset: number): void;
  highlight(tabId: string, start: number, length: number): void;
  clearHighlight(tabId: string): void;
  disposeTab(tabId: string): void;
}

const noop: EditorBridge = {
  snapshot: () => null,
  setText: () => {},
  insert: () => {},
  run: () => {},
  focus: () => {},
  setCursorOffset: () => {},
  highlight: () => {},
  clearHighlight: () => {},
  disposeTab: () => {},
};

export const editorBridge: { current: EditorBridge } = { current: noop };
