# Engineering Notes & Runbook

Operational knowledge for building, shipping, and debugging Verqury — written so someone
other than the original author can run it. These are hard-won gotchas; most cost a build cycle
(or several) to diagnose the first time. Organized by area, mostly as *symptom → cause → fix*.

The architecture *why* lives in [`adr/`](adr/); this file is the *how* and the *what bit us*.

---

## 1. Build & CI

- Node 20 workspace: `core/` (verqury-core library + CLI) and `app/` (Electron shell).
- `npm test` runs workspace tests via `node --test` — no test framework dependency.
- Version is hand-set in package.json until packaging lands (Phase 8).

## 2. Data layer & index

**The index is derived, never authoritative (ADR-0001).** `core/src/search.js`
scans the markdown tree and mirrors it into SQLite FTS5. Delete `index.sqlite` and
`verqury index rebuild` (or any mutation, which refreshes) reconstructs it. No code
path may read state that exists *only* in SQLite.

**FTS5 has no UPDATE.** Row changes are done as delete-then-insert keyed on `path`.
`refreshIndex` compares each file's `mtime` (stored `UNINDEXED`) to the indexed value:
unchanged → skip, changed → delete+insert, missing-on-disk → delete. This is why
`documents` stores `path`/`type`/`project`/`mtime` as `UNINDEXED` columns — retrievable
and filterable, but not tokenized into the full-text terms.

**Separation of concerns:** core domain functions (`projects`, `guidance`, `memory`)
do pure file I/O and never touch the DB. The CLI refreshes the index after a mutation;
the Phase 2 Electron watcher will own refresh its own way. Keep it that way — it keeps
the "files are truth" boundary clean.

**WAL side files:** the index opens in WAL mode, so `index.sqlite-wal` / `-shm` appear
next to it. `.gitignore` uses `*.sqlite*` to cover them (the data root is outside the
repo anyway; this is defensive).

## 3. Electron shell & OS integration

<!-- Expected hot spots (plan §6): better-sqlite3 electron-rebuild incantation,
     X11 global hotkey and clipboard-polling gotchas. Record them when hit. -->

## 4. Packaging & distribution

<!-- electron-builder AppImage/.deb notes land in Phase 8. -->

## 5. Credentials & secrets

- Verqury MVP holds no credentials: no API keys, no tokens, no accounts (ADR-0004).
- The user data root (`~/FlawedWorks/verqury/` by default) lives outside the repo and
  is never committed; `.sqlite` and `.env` are gitignored defensively.
