# 0005. Vanilla-leaning frontend, no framework

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

Verqury's UI is lists, panes, forms, and a markdown preview — no complex shared state,
no deep component trees. The build runs one AI-agent session per phase, where
dependency surface and build tooling directly cost tokens and debugging time.

## Decision

We will build the Electron renderer in plain HTML/CSS/JS, with at most a minimal
build step (esbuild) if bundling becomes necessary. No React or other UI framework
in MVP.

## Consequences

- Minimal dependency surface; no framework upgrades; cheap build sessions.
- Renderer code stays legible to any future maintainer or agent.
- Harder: if the UI grows real state complexity post-0.1, we may retrofit a
  framework — accepted, and a future ADR would record that reversal.

## Alternatives considered

- **React** — rejected for MVP: adds build tooling and dependency weight for UI
  that is fundamentally CRUD over files.
