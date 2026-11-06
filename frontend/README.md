# sqlwb-web frontend

Web UI for SQL Workbench/J (the engine build is set by `WB_BUILD` in the Dockerfile). Vite + React 18 + TypeScript, Monaco editor (bundled, lazy).

## Build (Docker)

The container build runs:

```
npm ci && npm run build      # output: dist/
```

`.npmrc` points to the public npm registry. `package-lock.json` must stay in the repo.

## Dev

- `npm run dev` - Vite on :5173. Proxies `/api` and `/ws` to the backend on `http://localhost:8484`.
- No backend running: the app switches to the in-memory mock by itself (dev only).
- Force the mock: open `/?mock=1` (works in dev, preview, and the container).

## Check

```
npm run build                # exit 0
npx playwright test          # exit 0, uses installed Chrome or Edge, never downloads browsers
```

- Tests start `vite preview` on :4173 and use `?mock=1`.
- Against the container: `PW_BASE_URL=http://localhost:8484 npx playwright test`.
- `PW_CHANNEL=chrome|msedge` picks the browser.
- Screenshots go to `tests/screenshots/`.

## Layout

| Path | What |
|---|---|
| `src/api/protocol.ts` | Wire types (HTTP + WebSocket) |
| `src/api/client.ts` | HTTP helpers, one WebSocket, reconnect, 4401 -> login |
| `src/api/mock.ts` | Fake server, same messages (frames as arrays), mock HTTP |
| `src/api/rpc.ts` | Request/response by reqId (meta, saveChanges) |
| `src/boot.ts` | App login, workspace restore, update check |
| `src/state/edits.ts`, `save.ts` | Editable grid and "Save changes" flow |
| `src/state/exporter.ts` | CSV / TSV / SQL INSERT export |
| `src/state/features.ts` | DB Explorer tab, macros, bookmarks |
| `src/shortcuts.ts` | Central shortcut registry (menus, tooltips, key handler) |
| `src/actions.ts` | Action handlers. No handler = disabled menu item |
| `src/state/` | Store (zustand), row buffers, workspace save/restore |
| `src/editor/` | Lazy Monaco setup and the editor bridge |
| `src/components/` | Menu bar, toolbar, tabs, grid, dialogs, status bar |

## Notes

- Passwords: memory only, unless the profile has "Save password" (server stores it encrypted, `/api/profiles`). The workspace (`PUT /api/workspace`) never holds them.
- Browsers reserve Ctrl+T, Ctrl+W and Ctrl+Tab. Use Alt+T, Alt+W, Alt+PageDown / Alt+PageUp.
