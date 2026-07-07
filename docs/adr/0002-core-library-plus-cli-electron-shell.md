# 0002. Core logic is a plain Node library + CLI; Electron is a shell

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

Velora is built one AI-agent session per phase, so each phase must be independently
verifiable at low cost. The maintainer works terminal-first, and the terminal agents
that drive builds could themselves use Velora's features headless. Coupling business
logic to an Electron renderer would make every feature testable only through UI.

## Decision

We will implement all business logic in `velora-core`, a dependency-light plain Node
package with a thin CLI (`velora` command). The Electron app consumes the same
library and contains presentation and OS-integration code only (tray, hotkey,
clipboard, windows).

## Consequences

- Every feature is testable and verifiable from the terminal before UI exists,
  de-risking each build session.
- Terminal agents and scripts can drive Velora headless.
- UI phases become pure presentation work.
- Harder: OS-integration features (clipboard capture, hotkeys) still live only in
  the shell, so the CLI cannot exercise them — accepted, they are inherently UI-side.

## Alternatives considered

- **Logic in the Electron main process** — rejected: unverifiable without launching
  the app; blocks headless use.
