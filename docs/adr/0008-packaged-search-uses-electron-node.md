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

## Decision

The subprocess launcher is configurable (`api.configureNode`). Defaults stay as they
were — system `node`, empty extra env — so dev and `npm test` are unchanged. When the
app is packaged (`app.isPackaged`), main configures the subprocess to run under
**Electron's own embedded node** via `process.execPath` with
`ELECTRON_RUN_AS_NODE=1`. electron-builder rebuilds `better-sqlite3` for Electron's
ABI at package time (`npmRebuild: true`, `asarUnpack` the module), so the CLI loaded
by that embedded node finds a matching binary.

## Consequences

- The packaged app is self-contained: no dependency on a user-installed `node`, and
  one consistent ABI (Electron's).
- ADR-0006's architecture is preserved — `better-sqlite3` is still never loaded into
  the Electron *main/renderer*; only the short-lived subprocess loads it.
- Dev and tests keep using the system node with the system-ABI build — no
  electron-rebuild in the normal loop; the rebuild happens only inside packaging.
- Cost: this is verified by building and launching the packaged app. The
  `ELECTRON_RUN_AS_NODE` path only exercises in a real package, not in `electron .`
  dev runs, so it needs a packaged smoke test (recorded in engineering-notes).

## Alternatives considered

- **Bundle a standalone node binary** — rejected: ~50 MB, and a second toolchain to
  version alongside Electron's own node.
- **Load `better-sqlite3` in-process in Electron** (drop the subprocess) — rejected:
  reintroduces the dual-ABI dance in dev/test that ADR-0006 removed, for a feature
  used once per query.
- **Require `node` on the user's PATH** — rejected as a shipped default: fine for the
  developer audience but not self-contained; `VERQURY_NODE` still allows it as an
  override.
