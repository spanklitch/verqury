# 0008. Packaged search runs the CLI under Electron's embedded node

- **Status:** Accepted
- **Date:** 2026-07-07

## Context

[ADR-0006](0006-search-runs-out-of-process.md) keeps `better-sqlite3` out of the
Electron process by running search as a subprocess: `node <cli> search`. In
development and tests that is the *system* `node` on PATH, ABI-matched to the
`better-sqlite3` installed by npm. ADR-0006 explicitly deferred the packaging
question: a shipped AppImage cannot assume an end user has `node` on PATH, and the
system `node`'s ABI may not match the bundled `better-sqlite3`.

Packaging attempt 1 tried Electron's embedded node
(`ELECTRON_RUN_AS_NODE`) so the app would be self-contained. That path requires
`npmRebuild: true` to rebuild `better-sqlite3` for Electron's ABI — but electron-builder's
"installing production dependencies" step **prunes dev-dependencies from a hoisted npm
workspace and deletes its own `app-builder-bin` helper mid-build** (`spawn … app-builder
ENOENT`). That is a hard electron-builder + workspaces incompatibility, not a config typo.

## Decision

The search subprocess runs under the **system `node`** (the launcher stays configurable
via `api.configureNode` / `$VERQURY_NODE`; there is no `app.isPackaged` switch). To make
that work in a package:

- `npmRebuild: false` — electron-builder does not rebuild/reinstall, so it never prunes
  and never deletes `app-builder-bin`. The build completes.
- `asar: false` — the app ships as plain files, so the system `node` (which cannot read
  an asar archive) can execute `verqury-core/cli.js` and load `better-sqlite3`.
- `better-sqlite3` ships as the system-ABI build produced by `npm install`; the same
  system `node` loads it, so the ABI matches.

## Consequences

- The build succeeds in the workspace layout (the blocker above is gone).
- ADR-0006 is preserved: `better-sqlite3` is still never loaded into Electron's
  main/renderer; only the short-lived subprocess loads it.
- Dev and tests are unchanged (they already used the system node).
- **Trade-off:** the packaged app requires `node` on PATH, and the bundled
  `better-sqlite3` prebuild matches the ABI of the `node` that installed it. Both hold
  for the developer audience (and for Gary specifically). Public multi-machine
  distribution would want a self-contained variant — revisit then (bundle a node, or
  solve the workspace-rebuild issue) and supersede this ADR.

## Alternatives considered

- **Electron embedded node + `npmRebuild: true`** — blocked by the electron-builder
  workspace prune bug (above).
- **Bundle a standalone node binary** — deferred: ~50 MB and a second toolchain to
  version; not worth it for the current audience.
- **Two-package.json / de-hoisted build layout** to satisfy electron-builder — deferred:
  a larger restructure than a first release needs.
