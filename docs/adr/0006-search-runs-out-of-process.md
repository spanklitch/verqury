# 0006. Search runs out-of-process; Electron never loads better-sqlite3

- **Status:** Accepted
- **Date:** 2026-07-07

## Context

`better-sqlite3` is a native module compiled against a specific Node ABI. Electron
embeds its own Node with a *different* ABI than the system Node, so a module built
for one fails to load in the other. The usual fix (`@electron/rebuild`) rebuilds the
module for Electron — but then the same `node_modules` copy no longer loads under the
system Node that runs the CLI and the test suite. In an npm workspace with a single
hoisted copy, that forces a fragile "rebuild before running the app, rebuild back
before running tests" dance, recompiling on every switch. The plan (§6) budgeted time
for exactly this.

Meanwhile, almost nothing in the app needs SQLite: the project list, detail,
narrative, and memory timeline all come from plain markdown via the native-free
`verqury-core/files` surface, which loads in Electron with no rebuild. Only the search
box needs the FTS index, and it fires at human speed (type a query, press enter).

## Decision

The Electron main process never loads `better-sqlite3`. It imports only
`verqury-core/files` (no sqlite) for in-process file reads/writes, and runs search by
shelling out to `node <cli> search --json` — spawning the **system `node`** (ABI-matched
to the installed `better-sqlite3`), not Electron's embedded node. The index is refreshed
the same way (`node <cli> index refresh`), debounced, while the app runs.

## Consequences

- No `electron-rebuild`, ever. `better-sqlite3` stays built for the system Node, so the
  CLI and `npm test` keep working with zero ABI juggling. The plan's Phase-2 rebuild
  budget is not needed.
- A clean split: frequent reads are in-process (instant); infrequent search is a
  ~50–100 ms subprocess. Acceptable for a search box.
- The `verqury-core/files` barrel exists precisely to give consumers a sqlite-free
  entry point; the `.` barrel still exports everything for the CLI/tests.
- **Trade-off accepted:** the running app requires `node` on `PATH` for search. That is
  true on the dev machine. Packaging (Phase 8) must resolve it — bundle a node, or
  rebuild `better-sqlite3` for Electron and load it in-process, or ship a helper. This
  ADR would be superseded if Phase 8 chooses in-process sqlite.

## Alternatives considered

- **`@electron/rebuild` + in-process sqlite** — rejected for now: the dual-ABI dance is
  the fragile path the plan warned about, for a feature used once per query.
- **A pure-JS SQLite (sql.js/wasm)** — rejected: worse FTS story and slower, and it
  would fork the storage engine away from the CLI's `better-sqlite3`.
