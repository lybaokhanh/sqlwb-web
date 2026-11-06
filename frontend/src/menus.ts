// Menu bar content. Labels and shortcuts come from shortcuts.ts.
import type { ActionId } from './shortcuts';

export type MenuItem = ActionId | '-';
export interface Menu { title: string; items: MenuItem[]; /** Extra items from state (macro list). */ dynamic?: 'macros' }

export const MENUS: Menu[] = [
  { title: 'File', items: ['connect', 'reconnect', 'disconnect', '-', 'newTab', 'closeTab', 'renameTab', '-', 'saveWorkspace', 'loadWorkspace', '-', 'logout'] },
  { title: 'Edit', items: ['undo', 'redo', '-', 'find', 'replace', '-', 'toggleComment', 'lowerCase', 'upperCase', 'matchBracket', 'gotoLine', '-', 'commandPalette'] },
  { title: 'View', items: ['nextTab', 'prevTab', '-', 'focusEditor', 'sqlEditor', 'focusMaxRows', 'expandEditor', '-', 'verticalTabs', 'toggleTheme'] },
  { title: 'Data', items: ['saveChanges', 'insertRow', 'copyRow', 'deleteRow', '-', 'filter', 'findInData', '-', 'copyData', 'copyAsInsert', 'saveDataAs', '-', 'optimizeWidths', '-', 'closeResult'] },
  { title: 'SQL', items: ['execCurrent', 'execSelected', 'execAll', 'cancel', '-', 'reformat', 'completion', 'autoCompletion', 'jumpToStatement', '-', 'commit', 'rollback', '-', 'histFirst', 'histBack', 'histNext', 'histLast'] },
  { title: 'Macros', items: ['manageMacros', 'runMacro'], dynamic: 'macros' },
  { title: 'Workspace', items: ['saveWorkspace', 'loadWorkspace', '-', 'renameTab'] },
  { title: 'Tools', items: ['dbExplorer', 'files', 'bookmarks', 'loadRun', '-', 'options', 'commandPalette'] },
  { title: 'Help', items: ['shortcutList', 'about'] },
];
