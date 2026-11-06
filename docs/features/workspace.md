# Saved workspace

Since: v0.1.0

![After a reload only the password is asked](../images/workspace.png)

| Item | Behavior |
|---|---|
| Saved | Tabs, SQL, cursor, macros. Stored on the server per user, 1 s after a change |
| Reload | The workspace comes back. Only the database password is asked (unless saved) |
| Passwords | Never in the workspace |
| Save fails | A browser copy restores the work after a reload |
| Two browser tabs | The older tab gets a conflict dialog. No silent overwrite |

## Dialog size

Since: Unreleased

| Item | Behavior |
|---|---|
| Resize | Drag the grip in the bottom-right corner of a dialog. The dialog stays centered |
| Saved | One size per dialog kind (connection manager, cell dialog, macros, ...). Saved when you release the mouse |
| Where | In the browser (localStorage), not in the server workspace. Each screen keeps its own sizes |
| Limits | Min. 280 x 140 px. Max. the window size minus a margin. A saved size that is too big for the window gets smaller |
| Default size | Double-click the grip. The saved size is removed |
| Escape | Closes the top dialog, also when the focus is not in the dialog |
