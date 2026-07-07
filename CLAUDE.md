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
