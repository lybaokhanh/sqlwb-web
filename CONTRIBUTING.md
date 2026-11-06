# Contributing

## Commits

Conventional commits: `feat`, `fix`, `docs`, `test`, `build`, `ci`, `chore`. Scope: `backend`, `frontend`.

## Feature docs and releases

Each feature has a doc page and a demo image. Each release lists its features with the doc link and the image.

| Part | Where | Rule |
|---|---|---|
| Doc page | `docs/features/<feature>.md` | Title, `Since: vX.Y.Z` (or `Since: Unreleased`), demo image, table of behavior |
| Demo image | `docs/images/<feature>.png` | Made by a test in `frontend/tests/docs/demo-images.spec.ts`. Light theme, 1400×860, mock server |
| Index | `docs/features/README.md` | One row per feature |
| Changelog | `CHANGELOG.md` | Entry under `## [Unreleased]`: bold name, one line, `[Docs](docs/features/<feature>.md)`, image |
| Release notes | GitHub release | Made from `CHANGELOG.md` by `.github/workflows/release.yml` |

### Add a feature

1. Add a test to `frontend/tests/docs/demo-images.spec.ts`. It calls `shot(page, '<feature>')`.
2. Run `npm run docs:images` in `frontend/`.
3. Look at `docs/images/<feature>.png`. It must show the feature.
4. Write `docs/features/<feature>.md` with `Since: Unreleased`.
5. Add a row to `docs/features/README.md`.
6. Add the entry under `## [Unreleased]` in `CHANGELOG.md`.
7. Run `node scripts/check-docs.mjs --pr origin/main`.

A changed feature: update its doc page. Run step 2 again when the UI changed.

### Release

1. Rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`. Add a new empty `## [Unreleased]` on top.
2. Replace `Since: Unreleased` with `Since: vX.Y.Z` in `docs/features/`.
3. Update the compare links at the end of `CHANGELOG.md`.
4. Commit, then tag: `git tag -a vX.Y.Z -m vX.Y.Z`.
5. Push the tag. `release.yml` makes the GitHub release. `docker.yml` pushes the image.

### Checks

| Check | Runs | Fails when |
|---|---|---|
| `node scripts/check-docs.mjs` | `docs.yml` on push to main | A doc has no image, an image is missing or unused, a doc is not in the index or the changelog |
| `node scripts/check-docs.mjs --pr <base>` | `docs.yml` on PRs | Same, plus: a `feat` commit without changes in `CHANGELOG.md`, `docs/features/` and `docs/images/` |
| `node scripts/check-docs.mjs --notes <tag>` | `release.yml` on tags | `CHANGELOG.md` has no section for the tag |
