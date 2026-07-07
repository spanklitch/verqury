# Verqury — Build Progress

One phase per AI-agent session against [verqury-build-plan.md](verqury-build-plan.md).
Each session: read the plan, read this file, execute the next incomplete phase,
verify success criteria, update this file.

## Phase checklist

- [x] **Phase 0 — Repo init & scaffolding** (2026-07-06)
- [x] **Phase 1 — verqury-core: data layer + CLI** (2026-07-07)
- [ ] **Phase 2 — Electron shell + project views**
- [ ] **Phase 3 — Guidance library**
- [ ] **Phase 4 — Artifact inbox + clipboard capture**
- [ ] **Phase 5 — Session bootstrapper**
- [ ] **Phase 6 — Task router**
- [ ] **Phase 7 — Adapter registry + launch**
- [ ] **Phase 8 — Packaging, docs, release prep**

## Open questions (plan §7)

1. Data root location: `~/FlawedWorks/verqury/` — building against this default; configurable.
2. ~~Back-import Mebit/ZAGNALS?~~ **RESOLVED 2026-07-07: yes, seed both** at end of
   Phase 1 via the normal CLI (no importer feature — scope creep). Entries are stubs +
   pointers: project.md with `repo:` path to the code repo + links, plus a few decisions/
   log entries distilled from each project's CLAUDE.md. Source code never enters Verqury.
   Data root is user data, never in this repo — publishability unaffected (ADR-0001).
   Note: live post-ship projects will cycle `stage` back to `build` per release train;
   the linear stage enum is a label, not a gate.
3. ~~Capture hotkey?~~ **RESOLVED 2026-07-07: Ctrl+Alt+C** (Phase 4).

All plan §7 questions are now resolved.

## Repo status

Private GitHub repo `spanklitch/verqury` created + main pushed 2026-07-07 (Gary confirmed).

**RENAMED Velora → Verqury 2026-07-07:** "Velora" is taken by a company publishing a
vibe-coding product. Gary researched availability, is registering "Verqury" and grabbing
verqury.com. Renamed everywhere: repo dir, GitHub repo, package names (verqury,
verqury-core, verqury-app), CLI command (`verqury`), data root (`~/FlawedWorks/verqury/`),
all docs + plan file. Tagline "Layer, not IDE" unchanged. Historic references to "Velora"
in early commit messages remain — history is immutable, and the name never shipped.

## Session log

### 2026-07-06 — Phase 0 (session 1)
**Shipped:** Repo at `~/claude-projects/verqury/` (git init, branch `main`); build plan
moved into repo; standard doc set via project-docs skill (README with architecture
diagram, CHANGELOG at [Unreleased], ADRs 0001–0005 covering plan §2, engineering-notes
stub); Node 20 workspace `core/` + `app/` with `verqury` CLI stub, node:test smoke test,
minimal eslint flat config; `.gitignore` (secrets, node_modules, *.sqlite) written first.

**Verified:** `npm install && npm test` green; `npm run lint` clean; secret-hygiene grep
clean; first commit made locally.

**Deviations:** none.

**Not done (deliberate):** GitHub remote/push — awaits Gary's confirmation per push
protocol. No dependencies beyond eslint installed (gray-matter, better-sqlite3, chokidar
etc. land in Phase 1 when used).

**Next session:** Phase 1 — data layer + CLI (the keystone; plan §5 Phase 1 + §3 spec).

### 2026-07-07 — Phase 1 (session 2, Opus)
**Shipped:** `verqury-core` data layer + `verqury` CLI. Modules in `core/src/`:
`paths`, `slug`, `schema` (enum vocab + validation), `frontmatter` (gray-matter
wrapper), `config`, `init`, `projects` (create/list/show/set-stage), `guidance`
(add/list/show, global + project scope), `memory` (log add, numbered decision add),
`search` (FTS5 build/refresh/search/rebuild), barrel `index.js`, and `cli.js`
(init, project, guidance, log, decision, search, index, config). Deps added:
better-sqlite3, gray-matter. 17 tests across 6 files (unit + CLI child-process
round-trip) against temp data roots.

**Verified:** `npm test` 17/17 green; `npm run lint` clean; manual end-to-end run of
the success-criteria commands (init → project create → log/decision → search →
delete index.sqlite → rebuild → search) all correct; generated project.md /
decision / config.json inspected — well-formed YAML frontmatter, Ctrl+Alt+C hotkey
default present.

**Deviations from plan (deliberate, per simplicity rule):**
- **ULID deferred to Phase 4.** Plan listed "ULID generation" under Phase 1, but no
  Phase-1 command produces one (ULIDs are for artifacts/tasks). Added no ulid dep.
- **chokidar deferred to Phase 2.** Phase 1 needs on-demand build/refresh/rebuild
  only; the live watcher is an app-runtime concern.
- Domain functions do pure file I/O; the CLI refreshes the index after mutations
  (clean ADR-0001 boundary; the Phase 2 watcher will refresh its own way).
- Fixed a leftover `companion` typo in the plan's Phase 1 success criteria → `verqury`.
- Broadened `.gitignore` `*.sqlite` → `*.sqlite*` (WAL side files).

**Not done (deliberate):** artifacts/tasks/packets dirs are created per project but
have no commands yet (their phases: 4/6/5). No Electron. No push yet — awaits Gary.

**Next session:** Phase 2 — Electron shell + project views (plan §5 Phase 2). First
Electron install; budget time for better-sqlite3 electron-rebuild (plan §6).
