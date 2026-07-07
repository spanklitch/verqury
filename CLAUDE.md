# Verqury — Engineering Journal / AI Context

**Layer, not IDE.** Low-friction Linux desktop companion for AI-assisted product
development. This file is the raw lab notebook — verbose, chronological. The distilled,
outward-facing docs are README.md, CHANGELOG.md, docs/adr/, docs/engineering-notes.md.

## Session protocol (binding)

1. Read `verqury-build-plan.md` (scope + specs) and `PROGRESS.md` (state) first.
2. Execute exactly ONE phase per session. Verify its success criteria. Update PROGRESS.md.
3. Anti-goals are binding (plan §1): no embedded chat, no editor, no agent
   orchestration, no cloud/multi-user. Reject scope creep toward these.
4. ADR-0001 is load-bearing: truth lives in markdown files; SQLite is a deletable
   index. Any feature storing truth only in SQLite is wrong.
5. Propose before coding; confirm with Gary before any git push.

## Key facts

- Workspace: `core/` = verqury-core (plain Node lib + `verqury` CLI, ESM, node:test);
  `app/` = Electron shell (empty until Phase 2).
- Target: Linux x64, X11 (Xubuntu). Wayland deferred.
- Data root (user data, NOT this repo): `~/FlawedWorks/verqury/` — spec in plan §3.
- Data layer schemas (frontmatter), packet template syntax, adapter config shape:
  all specified in plan §3–§4. The plan is the spec; don't re-derive.

## Build-by-build notes

### 2026-07-06 — Phase 0
Scaffolded repo, docs, workspace. Details in PROGRESS.md session log. Nothing
non-obvious encountered.

### 2026-07-07 — Phase 1
verqury-core data layer + `verqury` CLI (projects, guidance, memory, FTS5 search).
Deps: better-sqlite3, gray-matter. 17 tests green. Deferred ULID→Phase 4 and
chokidar→Phase 2 (no Phase-1 consumer). Domain = pure file I/O; CLI refreshes the
index after mutations. FTS5 = delete+insert on mtime change (no UPDATE) — see
docs/engineering-notes.md §2. Details in PROGRESS.md session log.

### 2026-07-07 — Phase 2
Electron shell (app/): main.js (ESM) + preload.cjs + vanilla renderer; project list,
detail (narrative + stage control + memory timeline), search, tray, live file watcher.
Testable logic in app/src/{api,watcher}.js. **ADR-0006: search runs out-of-process
(system `node` + CLI), so Electron never loads better-sqlite3 → NO electron-rebuild.**
Deps: electron 41, chokidar 5. 23 tests green. Both done-when criteria proven in the
running app via the VERQURY_VERIFY harness (live update 2→3; stage change persisted).
Engineering gotchas (execPath vs node, ESM/CJS, capturePage) in engineering-notes §3.

### 2026-07-07 — Phase 3
Guidance library: Projects/Guidance tabs, scoped guidance browsing, markdown preview,
copy-to-clipboard, new-from-template, promote-to-global. Core: listAllGuidance,
promoteGuidance + CLI. In-house dependency-free markdown renderer (app/src/markdown.js,
HTML-escaped; ADR-0005) — also upgrades narrative. Clipboard/external-links via preload
bridge. Renderer is now an ES module. 29 tests green; all done-when proven via harness
(markdownRendered / guidanceCreated / guidancePromoted true) + FTS-findable. Details in
PROGRESS.md; renderer notes in engineering-notes §3.

### 2026-07-07 — Phase 4
Artifact inbox + clipboard capture. Core: artifacts.js (CRUD + guessKind), ids.js (ULID,
deferred from P1), activeProject config, artifact indexing, artifact/active CLI. App:
global Control+Alt+C → clipboard→artifact into active project + notification; Inbox tab
(capture-to selector, kind filter, copy-back/retag/change-kind/delete). Capture logic
injectable (api.captureClipboard) → unit-tested sans Electron. Artifact bodies stored
VERBATIM (not fenced) for exact copy-back. 36 tests green; harness proves hotkeyRegistered
/ captureFiledArtifact / captureRoundTrips / inboxCards. X11 hotkey/clipboard gotchas in
engineering-notes §3.

### 2026-07-07 — Phase 5
Session bootstrapper. Core packets.js: GLOBAL packet templates at <root>/packets/
(ADR-0007, deviates from §3 per-project sketch), {{project.*}}/{{includes}}/{{log:N}}
substitution + tiny in-house globber, renderPacket, 3 starters seeded by init. packet
list|render CLI. App: ⚡ Bootstrap panel in project detail (packet dropdown, live preview,
copy / write-to-repo). 40 tests green; harness proves packetHasContext/packetFileWritten/
packetClipboard/bootstrapPreview. Fixed a null-text-node bug (replaceChildren with null).
