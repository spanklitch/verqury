# 0010. Multi-session terminal — tabs, one per project/build

- **Status:** Accepted
- **Date:** 2026-07-12

## Context

The embedded terminal (ADR-0009) shipped as a **single** session: one global `ptyProc`
in main, one xterm in the renderer. In practice the owner runs more than one thing at a
time — an agent CLI in project A while a build or a second agent runs in project B — and
a single shell forces serialization and loses context on every switch. The workbench
needs concurrent, independently-scrollable shells, each anchored to the project it serves.

## Decision

Promote both sides of the bridge from a singleton to a **keyed map of sessions**, one per
tab, surfaced as a tab strip.

- **Main:** `ptys = Map<id, pty>`. `ptyStart(id, {shell, cwd})` spawns a PTY pinned at
  `cwd` (the project repo) and tags every `pty:data` / `pty:exit` event with its `id`;
  `pty:input` / `pty:resize` / `pty:kill` are keyed by `id`.
- **Renderer:** `sessions = Map<id, {term, fit, wrap}>`. A single pair of PTY listeners
  dispatches each event to its session by `id`. Each session's container is created once
  and moved in/out of the view on tab switch (the ADR-0009 trick, now per-session), so
  scrollback and the live process survive both tab switches and app-view navigation.
- **Tab identity is the pin:** project-launched tabs use a deterministic id `proj:<slug>`,
  so relaunching an adapter for a project **focuses/restarts its existing tab** instead of
  piling up duplicates (one tab per project). Plain shells use `shell:<n>` via a `+` button.
- **Launch is renderer-driven:** `launchAdapter` (main) no longer touches a PTY; it returns
  a `{ id, label, cwd }` pin and the renderer opens the tab and writes the command. This
  guarantees the xterm listener is attached *before* the command runs — no missed first line
  (the race that a main-side write would have introduced).

## Consequences

- The old main-side `pty:send` (bracketed-paste + `nav:terminal`) is gone; "send to
  terminal" is now a renderer op against the **active** tab (`sendToActiveTerminal`),
  creating a shell tab if none is open. `nav:terminal` IPC is removed — the renderer
  switches views itself.
- Still no new concept and no anti-goal crossed: several shells the user drives is not
  agent orchestration. Verqury hosts and organizes; the agent still does the work.
- Background tabs create a "which one wants me?" problem, so attention is **per tab**: a
  session's BEL (`term.onBell`) beeps, glows *that* tab, and desktop-notifies when hidden.
  This is a direct consequence of going multi-session — a single terminal never needed it.
- `before-quit` now kills every PTY in the map, not one.
- A tiny `window.__verquryTerm` hook exposes the terminal entrypoints for the headless
  VERQURY_VERIFY harness (multi-tab done-when: independent sessions, project reuse,
  isolation, persistence, close) — same spirit as `window.__verquryReady`.
