# 0003. Electron for the desktop shell

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

Velora needs three OS-level features to deliver its core loop: a system tray
presence, a global hotkey, and clipboard capture. The maintainer's stack is
JavaScript and Python; the target platform is Linux x64 (Xubuntu/X11) only for MVP.
The main desktop-shell candidates are Electron (JS end-to-end, heavy) and Tauri
(light, but backend commands are written in Rust).

## Decision

We will build the desktop shell in Electron. Target Linux x64/X11 only for MVP;
package as AppImage and .deb.

## Consequences

- JS end-to-end matches the maintainer's stack; tray, global hotkeys, and clipboard
  polling are first-class Electron APIs.
- We accept the memory/disk footprint of a bundled Chromium as the cost of velocity
  for a solo MVP.
- Native modules (better-sqlite3) require electron-rebuild — a known build gotcha to
  document when hit.
- Wayland support is explicitly deferred.

## Alternatives considered

- **Tauri** — rejected: Rust backend is outside the maintainer's stack; the
  footprint win doesn't justify the learning curve for a solo MVP.
- **Local web app (Node server + browser tab)** — rejected: no tray, no global
  hotkey, no reliable clipboard watching; those are the product's spine.
