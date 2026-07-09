# 0009. Embed a terminal — Verqury becomes an agent workbench

- **Status:** Accepted
- **Date:** 2026-07-08

## Context

Verqury was built as a "layer, not IDE" — deliberately not embedding a terminal or
editor (ADR-0002/0003/0005, and the plan's anti-goals). In use, the owner found the
real goal is a *coherent operating environment*: an AI CLI (Claude Code, Grok, …)
running **inside** Verqury, with the guidance library, clipboard/artifact organizer,
and project memory around it — so context and text flow without switching apps. The
original brief held both instincts ("unify into one environment" and "don't replace my
terminal"); this resolves it toward *unify*.

Anchoring the distro's terminal *application* into the Electron window was considered
and rejected: Chromium exposes no way to host a foreign native window, and X11
reparenting hacks fight Chromium's layout/paint/focus and die on Wayland.

## Decision

Embed a terminal as a native part of the app: **node-pty** spawns a real PTY in the
Electron main process and streams it over the preload bridge to an **xterm.js** widget
in the renderer (the same approach as VS Code's integrated terminal). It runs the
user's real shell and CLIs; Verqury hosts and organizes, the agent still does the work.

This supersedes the "no embedded terminal" stance of the anti-goals. Verqury is now an
**agent workbench**, not a pure layer.

## Consequences

- **Two native modules, two ABIs, two processes.** node-pty is built for Electron's ABI
  (it loads in main); better-sqlite3 stays system-node ABI (it loads only in the search
  subprocess, ADR-0006/0008). They coexist because they never load in the same process.
  Gotcha: `electron-rebuild` rebuilds *all* native modules — after rebuilding node-pty
  for Electron, run `npm rebuild better-sqlite3` to put it back on system ABI.
- Packaging keeps `npmRebuild: false` (avoids the workspace prune bug, ADR-0008) and
  `asar: false`, so both native binaries ship as-is in the state we built them.
- Text flows both ways in one DOM model: drop text onto the terminal → `pty.write`;
  select in the terminal → capture/copy out; "send to terminal" from guidance/packets.
- xterm.js is vendored (`renderer/vendor/`) so the no-bundler renderer can import it.
- Trade-off accepted: more surface, a second native toolchain, and a genuine identity
  shift from "layer" to "workbench." Deliberate, and recorded here rather than drifted.
