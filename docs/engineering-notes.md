# Engineering Notes & Runbook

Operational knowledge for building, shipping, and debugging Velora — written so someone
other than the original author can run it. These are hard-won gotchas; most cost a build cycle
(or several) to diagnose the first time. Organized by area, mostly as *symptom → cause → fix*.

The architecture *why* lives in [`adr/`](adr/); this file is the *how* and the *what bit us*.

---

## 1. Build & CI

- Node 20 workspace: `core/` (velora-core library + CLI) and `app/` (Electron shell).
- `npm test` runs workspace tests via `node --test` — no test framework dependency.
- Version is hand-set in package.json until packaging lands (Phase 8).

## 2. Data layer & index

<!-- symptom → cause → fix entries as they are earned. Watch: file-watcher/index drift,
     frontmatter parse failures, concurrent app+agent writes. -->

## 3. Electron shell & OS integration

<!-- Expected hot spots (plan §6): better-sqlite3 electron-rebuild incantation,
     X11 global hotkey and clipboard-polling gotchas. Record them when hit. -->

## 4. Packaging & distribution

<!-- electron-builder AppImage/.deb notes land in Phase 8. -->

## 5. Credentials & secrets

- Velora MVP holds no credentials: no API keys, no tokens, no accounts (ADR-0004).
- The user data root (`~/FlawedWorks/velora/` by default) lives outside the repo and
  is never committed; `.sqlite` and `.env` are gitignored defensively.
