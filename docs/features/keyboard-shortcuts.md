# Keyboard shortcuts per OS, change keys

Since: Unreleased

![Key editor](../images/keyboard-shortcuts.png)

Hotkeys work in a normal browser tab. You do not need to install the app (PWA).
Each OS gets its own default keys. You can change all keys.

| Item | Behavior |
|---|---|
| OS | The app finds the OS of the browser: Windows, macOS or Linux |
| Windows / Linux | Keys use Ctrl. Menus show `Ctrl+Shift+E` |
| macOS | Keys use ⌘ (Cmd). Menus show symbols: `⇧⌘E`, `⌘↩` |
| Browser and OS keys | The browser or the OS keeps some keys (Ctrl+T, Ctrl+W, Ctrl+Tab, ⌘Q, ⌘M). Menus show only keys that work |
| Change keys | Help → Keyboard shortcuts |
| Saved | In the workspace on the server, per OS. A Mac and a Windows PC keep different keys |

## Change keys

1. Open Help → Keyboard shortcuts.
2. Type in the filter box to find the action.
3. Click **+ Add**. Press the new key. Esc cancels.
4. Click × on a key to remove it.
5. Click **Reset** to get the default keys back. **Reset all** resets all actions.

| Case | Result |
|---|---|
| The browser or the OS keeps the key | Error: "The browser or OS keeps this key". Press another key |
| A macro uses the key | Error with the macro name. Change the macro key in Macros → Manage macros |
| Another action uses the key | The key moves to this action. The row shows "Moved from <action>" |
| Key without Ctrl, Alt or ⌘ | Error. Plain keys are for typing. Function keys (F1 to F12) are allowed |
| Editor keys (Undo, Find, Replace, Jump to line, Code completion) | The editor handles the default keys. A changed key runs the action from the app |

## Default keys that differ on macOS

| Action | Windows / Linux | macOS |
|---|---|---|
| Replace | Ctrl+H | ⌥⌘F |
| Jump to line | Ctrl+G | ⌃G |
| Next / previous tab | Alt+PageDown / Alt+PageUp | ⌃⌥→ / ⌃⌥← |
| History back / next | Alt+Left / Alt+Right | ⌃⌥↑ / ⌃⌥↓ |
| Manage macros | Ctrl+M | ⇧⌘M |
| Code completion | Ctrl+Space | ⌃Space |

## Limits

| Limit | Note |
|---|---|
| Macro keys | Set in Macros → Manage macros. `Ctrl` in a macro key means ⌘ on macOS |
| Win / Super key | No default uses it. The OS keeps most of these keys |
