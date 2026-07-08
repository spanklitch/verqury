# Changelog

All notable changes to Verqury are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
### Changed
### Fixed

## [0.1.1] - 2026-07-08

Visual identity and quality-of-life pass.

### Added
- Branding: the Verqury droplet logo as the sidebar mark and app icon
  (`scripts/gen-icon.mjs` renders the PNG via Electron — no external tooling).
- Dark navy theme by default (suits the logo and syntax-colored code) with an
  indigo accent, plus a light/dark toggle in the header (persisted).
- Drag-and-drop capture: drag highlighted text (from another window or a Verqury
  tile) onto the app to file it into the active project — no copy/paste needed.
- `scripts/install-desktop.sh`: installs a desktop/menu launcher that runs the
  built AppImage with the droplet icon.
- Visual polish: refined card/badge/focus states, softer shadows, subtle
  background depth, and typographic tuning.

### Changed
### Fixed

## [0.1.0] - 2026-07-07

First release. Verqury is a local-first Linux desktop workflow layer for
AI-assisted product development — projects with durable memory, a guidance
library, clipboard-capture artifact inbox, session bootstrapper, task router,
and a config-driven adapter registry.

### Added
- Project scaffold: repo, standard doc set (README, ADRs 0001–0005,
  engineering notes), phased build plan, Node workspace (`core/` + `app/`).
- `verqury-core` data layer: data-root bootstrap, frontmatter read/write,
  project registry (create/list/show/set-stage), guidance library
  (global + project scoped), project memory (log entries + numbered
  decisions), and a rebuildable SQLite FTS5 search index (build / incremental
  refresh / search / full rebuild).
- `verqury` CLI over the core library: `init`, `project`, `guidance`, `log`,
  `decision`, `search`, `index`, `config`, `timeline` commands.
- Electron desktop shell: project list (stage/status badges), project detail
  (narrative + stage control + merged log/decision timeline), global search,
  system tray, and a live file watcher so terminal-side edits appear without a
  restart. Vanilla renderer over a sandboxed preload bridge.
- Core: `projectTimeline` / `listLog` / `listDecisions` readers; a native-free
  `verqury-core/files` entry point; `search --json` and `timeline` CLI output.
- Guidance library: a Guidance tab browsing global + per-project guidance,
  markdown preview, copy-to-clipboard, new-from-template (kind-aware scaffold),
  and promote-to-global. Core gains `listAllGuidance` / `promoteGuidance` and
  `guidance promote` / `guidance list --all` CLI. A small dependency-free
  markdown renderer (also upgrades the project narrative from plain text).
- Artifact inbox + clipboard capture: a global Ctrl+Alt+C hotkey files the
  clipboard into the active project as a kind-classified artifact; an Inbox tab
  lists artifacts with kind filter, copy-back, retag, change-kind, and delete;
  an active-project selector. Core gains an `artifacts` module, an in-house ULID
  generator, `activeProject` config, artifact indexing, and `artifact` / `active`
  CLI commands.
- Session bootstrapper: global packet templates ([ADR-0007](docs/adr/0007-packets-are-global-templates.md))
  render against a chosen project — `{{project.*}}` vars, `{{includes}}` guidance
  globs, and `{{log:N}}` recent entries. A Bootstrap panel previews a packet and
  copies it to the clipboard or writes it to the project repo. Ships three starter
  packets (chat-ideation, terminal-build, browser-task). New `verqury packet
  list|render` CLI.
- Task router: a Tasks tab with route-laned task lists (direct / automation /
  browser-agent / human). Hand-off renders the task's payload — enriched with the
  surface's packet context — to the clipboard and marks it handed-off. Attach-report
  links a captured inbox artifact, marks the task done, and echoes a completion entry
  into the project's memory timeline. Core gains a `tasks` module and `verqury task
  add|list|status|handoff|report` CLI.
- Adapter registry: AI surfaces defined purely as config ([ADR-0004](docs/adr/0004-adapters-are-launch-handoff-config.md)) —
  `{slug, label, launch command, handoff packet, notes}`. A Settings tab adds/edits/
  removes adapters, and each project detail has per-adapter launch buttons that copy the
  handoff packet to the clipboard and spawn the (substituted) command detached. Ships
  four starter adapters (claude-code, claude-chat, cursor, browser-agent). Adding a new
  AI tool needs zero code changes. New `verqury adapter list` CLI.
- Packaging: electron-builder config for Linux AppImage + `.deb`, an autostart-to-tray
  option (tray toggle writes a `~/.config/autostart` entry; `--hidden` starts in the
  tray), and the packaged-search resolution ([ADR-0008](docs/adr/0008-packaged-search-uses-electron-node.md)).

### Changed
- Renamed product Velora → **Verqury** (prior name in use by another company);
  applies to package names, CLI command, data root, and all docs.

[Unreleased]: https://github.com/spanklitch/verqury/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/spanklitch/verqury/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/spanklitch/verqury/releases/tag/v0.1.0
