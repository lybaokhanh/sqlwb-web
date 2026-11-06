# Changelog

Each release lists its features with a doc link and a demo image.
The release workflow copies the section of a tag into the GitHub release notes.
Rules: [CONTRIBUTING.md](CONTRIBUTING.md#feature-docs-and-releases).

## [Unreleased]

### Added

- **Keyboard shortcuts per OS, change keys**: hotkeys work in a normal browser tab on Windows, macOS (⌘) and Linux. Menus show only keys that the browser lets through. Help → Keyboard shortcuts changes the keys. The workspace saves them per OS. [Docs](docs/features/keyboard-shortcuts.md)

  ![Keyboard shortcuts](docs/images/keyboard-shortcuts.png)

## [0.2.1] - 2026-11-06

### Fixed

- `/api/version` shows the release version. The image build takes it from the git tag (it showed `0.1.0` in 0.2.0).

## [0.2.0] - 2026-11-06

### Added

- **Ask for missing bind variables**: a run with `:name` without a value opens a dialog for the values. `$[?name]` always asks. [Docs](docs/features/bind-variables.md)

  ![Bind variables](docs/images/bind-variables.png)

- Feature docs with demo images in [docs/features/](docs/features/README.md). `npm run docs:images` makes the images.
- Release notes come from this file, with images. A PR check stops a `feat` change without docs.

## [0.1.1] - 2026-11-06

### Added

- **Sort by column header**: ascending, descending, off. NULL last. Loaded rows only. [Docs](docs/features/result-sort.md)

  ![Sort by column header](docs/images/result-sort.png)

- **Auto completion while typing**: keywords, tables after `FROM`/`JOIN`, columns after `.`. [Docs](docs/features/auto-completion.md)

  ![Auto completion](docs/images/auto-completion.png)

- **Cell dialog for long values**: JSON, XML and multi-line text open formatted. [Docs](docs/features/cell-dialog.md)

  ![Cell dialog](docs/images/cell-dialog.png)

## [0.1.0] - 2026-11-06

First release.

### Added

- **Login and sessions**: app login, 30-day session, lockout after 5 failures. [Docs](docs/features/login.md)

  ![Login](docs/images/login.png)

- **SQL editor and execution**: Monaco editor, engine statement split, result tabs, statistics. [Docs](docs/features/sql-editor.md)

  ![SQL editor](docs/images/sql-editor.png)

- **Large results**: paged fetch, Fetch all, virtual grid for 100,000 rows. [Docs](docs/features/large-results.md)

  ![Large results](docs/images/large-results.png)

- **Dark and light theme**. [Docs](docs/features/themes.md)

  ![Dark theme](docs/images/themes.png)

- **Connection Manager**: profiles, groups, Test, saved passwords, import of `WbProfiles.xml`. [Docs](docs/features/connection-manager.md)

  ![Connection Manager](docs/images/connection-manager.png)

- **Tab groups and vertical tabs**: tabs grouped by schema, sidebar like Edge. [Docs](docs/features/tab-groups.md)

  ![Tab groups](docs/images/tab-groups.png)

- **DB Explorer**: objects, columns, source, procedures, triggers, table data search. [Docs](docs/features/db-explorer.md)

  ![DB Explorer](docs/images/db-explorer.png)

- **Editable result grid**: edit, insert, delete, SQL preview before save. [Docs](docs/features/editable-grid.md)

  ![Editable grid](docs/images/editable-grid.png)

- **Export**: CSV, TSV, SQL INSERT, clipboard. [Docs](docs/features/export.md)

  ![Export](docs/images/export.png)

- **Macros and bookmarks**. [Docs](docs/features/macros-and-bookmarks.md)

  ![Macros](docs/images/macros-and-bookmarks.png)

- **Safe execution**: read-only profiles, confirm updates, confirm DML without WHERE. [Docs](docs/features/safe-execution.md)

  ![Safe execution](docs/images/safe-execution.png)

- **Load run**: repeat a statement and chart the timings. [Docs](docs/features/load-run.md)

  ![Load run](docs/images/load-run.png)

- **Saved workspace**: tabs and SQL come back after a reload. Conflict dialog for two browser tabs. [Docs](docs/features/workspace.md)

  ![Workspace](docs/images/workspace.png)

- **Engine update**: admins install a new SQL Workbench/J build from the UI. [Docs](docs/features/engine-update.md)

  ![Engine update](docs/images/engine-update.png)

[Unreleased]: https://github.com/lybaokhanh/sqlwb-web/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/lybaokhanh/sqlwb-web/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/lybaokhanh/sqlwb-web/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/lybaokhanh/sqlwb-web/releases/tag/v0.1.0
