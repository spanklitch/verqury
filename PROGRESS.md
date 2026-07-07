# Velora — Build Progress

One phase per AI-agent session against [velora-build-plan.md](velora-build-plan.md).
Each session: read the plan, read this file, execute the next incomplete phase,
verify success criteria, update this file.

## Phase checklist

- [x] **Phase 0 — Repo init & scaffolding** (2026-07-06)
- [ ] **Phase 1 — velora-core: data layer + CLI**
- [ ] **Phase 2 — Electron shell + project views**
- [ ] **Phase 3 — Guidance library**
- [ ] **Phase 4 — Artifact inbox + clipboard capture**
- [ ] **Phase 5 — Session bootstrapper**
- [ ] **Phase 6 — Task router**
- [ ] **Phase 7 — Adapter registry + launch**
- [ ] **Phase 8 — Packaging, docs, release prep**

## Open questions (plan §7)

1. Data root location: `~/FlawedWorks/velora/` — building against this default; configurable.
2. ~~Back-import Mebit/ZAGNALS?~~ **RESOLVED 2026-07-07: yes, seed both** at end of
   Phase 1 via the normal CLI (no importer feature — scope creep). Entries are stubs +
   pointers: project.md with `repo:` path to the code repo + links, plus a few decisions/
   log entries distilled from each project's CLAUDE.md. Source code never enters Velora.
   Data root is user data, never in this repo — publishability unaffected (ADR-0001).
   Note: live post-ship projects will cycle `stage` back to `build` per release train;
   the linear stage enum is a label, not a gate.
3. Capture hotkey (Ctrl+Alt+C proposed) — needed by Phase 4.

## Repo status

Private GitHub repo `spanklitch/velora` created + main pushed 2026-07-07 (Gary confirmed).

## Session log

### 2026-07-06 — Phase 0 (session 1)
**Shipped:** Repo at `~/claude-projects/velora/` (git init, branch `main`); build plan
moved into repo; standard doc set via project-docs skill (README with architecture
diagram, CHANGELOG at [Unreleased], ADRs 0001–0005 covering plan §2, engineering-notes
stub); Node 20 workspace `core/` + `app/` with `velora` CLI stub, node:test smoke test,
minimal eslint flat config; `.gitignore` (secrets, node_modules, *.sqlite) written first.

**Verified:** `npm install && npm test` green; `npm run lint` clean; secret-hygiene grep
clean; first commit made locally.

**Deviations:** none.

**Not done (deliberate):** GitHub remote/push — awaits Gary's confirmation per push
protocol. No dependencies beyond eslint installed (gray-matter, better-sqlite3, chokidar
etc. land in Phase 1 when used).

**Next session:** Phase 1 — data layer + CLI (the keystone; plan §5 Phase 1 + §3 spec).
