# Changelog

All notable changes to Verqury are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.5] - 2026-08-10

### Added
- **Lines of code and real cost on the project meter.** Verqury can now receive the metrics Claude
  Code measures about itself — lines added and removed, and what a session actually cost in
  dollars — and folds them into the same per-session records the build-time meter already keeps.
  Off by default; switch it on under **Settings → Build metrics**.
  - Only sessions **Verqury launches** are counted, so the line figure is a floor rather than a
    total, and the meter always shows the date counting began instead of implying it knows your
    project's whole history.
  - Counting starts when you enable it. Unlike build time, past sessions cannot be backfilled —
    the measurements simply do not exist before then.
  - The receiver listens on loopback only, on a port you choose, and nothing leaves your machine.
    If the port is taken, the meter quietly goes without the numbers rather than blocking startup.

## [0.6.4] - 2026-08-09

### Fixed
- **Phantom approval cards on startup.** A permission (or question) whose Claude Code session
  ended before anyone answered it stayed *pending* forever — the countdown lived only inside the
  hook that filed it, and died with it. Restarting Verqury then sent your phone a fresh card for
  a tool call that had finished hours ago, where tapping did nothing. Verqury now owns expiry
  itself: it sweeps the inbox every 30 seconds, and before every relay pass, so a stale request
  is closed out instead of announced.

## [0.6.3] - 2026-08-07

### Added
- **A build-time meter on every project.** Verqury now reads the transcripts Claude Code
  already leaves on disk and turns them into one durable record per session, so a project
  can finally answer "how much build time is in this?" The meter shows **active** time —
  gaps longer than 15 minutes are counted as walking away, not working — alongside token
  totals and a session count. Because the transcripts are already there, the first harvest
  **backfills every past session**: the meter opens with real history instead of a zero.
  Wall-clock time and the raw token counters stay one hover away.
- **`verqury session harvest|list|metrics`** on the CLI, for the same numbers without the app.

### Fixed
- **A quit Verqury no longer stalls every permission for nine minutes.** With presence set to
  Away, the gate used to relay a permission request whether or not the app was running — but the
  app is the only thing that sends the card and reads your tap, so with it closed the request sat
  there until the ~9-minute expiry before falling back to the desktop prompt. Every prompt. And
  because the notify hook needs no app, your phone kept buzzing about other events, so the relay
  looked perfectly alive. The gate now checks a liveness heartbeat and falls back to the desk
  **immediately** when nothing is there to answer.
- **Closing the window says so.** Verqury stays resident in the tray by design, which is easy to
  forget — one instance ran for over seven days unnoticed. Closing the window now tells you once
  that it's still running, and the tray tooltip says it permanently.

### Notes
- Session records are plain markdown under `projects/<slug>/sessions/`, like everything else
  (ADR-0001) — once harvested, the numbers are yours and survive any change upstream.
- Sessions are matched to a project by its `repo` path, so a project needs one to be measured.
  Sessions run from a subdirectory of the repo count too.
- **Upgrade order matters:** install the app **before** copying the updated
  `hooks/verqury-permission.cjs` into `~/.claude/hooks/`. The new hook expects the heartbeat that
  only this version writes; paired with an older app it would read "not running" every time and
  stop relaying altogether (safely — every prompt would go to the desk).

## [0.6.2] - 2026-08-06

### Added
- **Per-tab colors in the terminal.** Each tab claims a color for its lifetime (blue,
  yellow, purple, green, white, red) and wears it as a left bar, so tabs are told apart at
  a glance. Closing a neighbour never re-colors a tab; a closed tab's color returns to the
  pool.
- **Bell blink.** A background tab that rings BEL now blinks in its own color until you
  click it — it still never navigates away or takes your keyboard. Motion-sensitive users
  get a steady high-contrast state instead (`prefers-reduced-motion`).
- **Drop a file into the terminal to type its path**, the way a plain terminal does.
  Multiple files are shell-quoted and space-separated; a dragged link pastes verbatim.
- **Editable task bodies + an `idea` route.** A task can now be written and revised in
  place — jot a fix or feature as a one-liner and flesh it out over several sittings, then
  send it on with the existing hand-off. The new `idea` lane holds what isn't worked out
  yet.
- **AskUserQuestion reaches the phone readable.** When an agent asks a multiple-choice
  question, the relay card now carries the question text and the option labels instead of a
  bare "Approve this?", and the full options with their descriptions are emailed when they
  are too long for a card — the first real-world path that exercises the Phase C email
  channel. Note the gate contract is unchanged: `PermissionRequest` is allow/deny only, so
  approving means *"let me answer at my desk"*; answering from the phone remains the
  `verqury-ask` skill's job.

### Fixed
- **A bell in a background tab no longer kills your keyboard.** Ringing a tab called the
  full renderer repaint, whose `replaceChildren` detached and re-appended the *active*
  session's container — dropping focus out of its xterm textarea, so typing went nowhere
  until you clicked back into the terminal. A bell now repaints only the tab strip.
  (It never switched tabs; only focus was lost.) Guarded by VERQURY_VERIFY block 15.
- **The drag-and-drop overlay no longer latches on.** Dragging onto the terminal left the
  dashed "Drop to capture" overlay stuck until the app was restarted: the terminal's drop
  handler calls `stopPropagation`, which prevented the document-level handler that clears
  the overlay from ever running. Cleanup now runs in the capture phase (plus on `dragend`),
  and the overlay no longer claims the terminal area at all.

## [0.6.1] - 2026-08-06

### Added
- **Web companion deep-links** — a new **About & updates** card in Settings opens the
  [verqury.com](https://verqury.com) web companion in your browser: **Check for updates**
  (→ `/whats-new/`) and **Share an idea** (→ `/ideas/`), plus links to verqury.com and the
  GitHub source. Shows the app version via a new `app:version` IPC. Closes the app↔web loop.
  (VERQURY_VERIFY block 14 added to prove it at build time.)

### Fixed
- Task detail no longer renders a stray `null` line for tasks that have no attached report
  (native `replaceChildren(null)` was coercing to the string "null").

## [0.6.0] - 2026-07-15

### Added
- **Remote decision relay — Phase C: ask questions & read long context from your phone**
  ([ADR-0011](docs/adr/0011-remote-decision-relay.md), build plan §8) — the final phase of the
  relay. Two additions:
  - **`verqury-ask` skill** (`skills/verqury-ask/`) — the agent's *own* clarifying-question
    path (distinct from the automatic permission gate). When a build hits a decision only you
    can make — a design choice, an ambiguous spec, "approach A or B?" — the model runs the
    skill; it files a **question** into the same Decision Inbox, relays it to your phone, and
    **blocks until you answer**, then returns your answer to the model. You answer by **tapping
    an option or replying with free text**. Questions share the `approvals/` inbox by `kind`
    (`permission` | `question`); answering echoes into the project timeline. The skill runner
    is dependency-free and file-mediated — it never injects keystrokes.
  - **Escalating email context channel.** For a long or `--needs-context` question, Verqury
    also **emails the full context** (Gmail SMTP via nodemailer); the Telegram card degrades to
    *"📧 full context emailed — reply here (#code)."* Email is deliberately **powerless** — it
    carries context only, never an actionable link — so all authority stays on the one authed
    Telegram chat. A `#code` correlation id joins the email and the card; typed replies map back
    via Telegram `reply_to_message`. The Gmail app-password is saved to `~/.claude/.env` (never
    the repo, never shown back); non-secret SMTP fields live in `config.json`.
- Settings → **Notifications & remote relay** now has a live **Email** section (To / From / SMTP
  host / port / app-password + status). The Approvals tab renders questions with option buttons
  and a free-text reply box. CLI: `verqury approval ask` / `approval reply`.

### Changed
- The Telegram long-poll now also receives typed **message** replies (was callback taps only),
  and resolved cards (answered at the desk or on the phone) are closed out on the phone.

## [0.5.1] - 2026-07-15

### Changed
- **One Telegram per event (relay de-dup).** With both the Phase A notify hook and the
  Phase B approve-by-tap gate installed, a permission prompt used to send two messages — a
  plain *"needs your permission"* notification **and** the actionable Approve/Deny card. The
  `Notification` hook (`hooks/verqury-notify.cjs`) now stays **silent on permission prompts**
  (the `PermissionRequest` gate owns those) and fires only for the events the gate does not:
  build **done** and **idle / waiting for input**. Re-copy the hook to `~/.claude/hooks/` after
  updating.

## [0.5.0] - 2026-07-15

### Added
- **Remote decision relay — Phase B: approve builds by tap** ([ADR-0011](docs/adr/0011-remote-decision-relay.md),
  build plan §8). When a running Claude Code build asks permission while you are **Away**,
  Verqury relays the request to your phone with inline **✅ Approve / ⛔ Deny** buttons and
  returns your tap to the build — you keep making the call from anywhere. A blocking Claude
  Code `PermissionRequest` hook (`hooks/verqury-permission.cjs`) files the request into a new
  file-backed **Approval inbox** (`<data-root>/approvals/`) and blocks on it; the app is the
  single Telegram long-poll consumer, sends the card, and writes your verdict back into the
  record. No terminal scraping, no keystroke injection — everything file-mediated (ADR-0001).
  If nobody answers within ~9 min the request **falls back to the desktop prompt** (never an
  auto-answer): the hook self-expires safely below Claude Code's 600 s fail-open timeout.
  New **Approvals** tab (waiting / resolved, with a desktop Approve/Deny that drives the same
  path a tap does) and a pending-count badge. CLI: `verqury approval list|answer|expire`.
  Verqury stays a **relay** — it carries the question and the answer; you decide.

## [0.4.0] - 2026-07-14

### Added
- **Remote decision relay — Phase A** ([ADR-0011](docs/adr/0011-remote-decision-relay.md),
  build plan §8): see a running Claude Code build's prompts on your phone. A desktop
  **Here / Away** toggle (Settings → Notifications, and a tray checkbox) routes attention:
  **Here** keeps the local terminal bell; **Away** forwards Claude Code notifications
  (needs-permission / waiting / done) to **Telegram**. A non-blocking Claude Code
  `Notification` hook (`hooks/verqury-notify.cjs`, installed to `~/.claude/hooks/`) does
  the send — it never influences the agent, always exits 0, and reads the bot token from
  `~/.claude/.env` (never logged). Settings section for enable, `chat_id`, and the bot
  token (saved to `~/.claude/.env` via the "save to .env?" convention); email fields are
  present but inert until Phase C. Verqury stays a **relay** — it carries the message, you
  still make the call. Approve-by-tap arrives in Phase B. CLI: `verqury notify
  [here|away|enable|disable|chat-id <id>]`.

### Added
- **Resume reminders** ("where you left off"): flag any task with **Remind me on
  open** and it surfaces in a strip across the top of the window each time you open
  Verqury — the pending thing greets you instead of a blank slate. Dismiss (Snooze,
  hides until next open), or mark Done to clear it. Active project's reminders sort
  first. Reuses the Tasks layer — a reminder is just a task with `resume: true` in
  frontmatter (ADR-0001); no new data type. CLI: `task add … --resume`,
  `task resume <project> <id> [on|off]`.
- **Resume-in-tool launch button**: a resume reminder can remember which code tool
  you were in (`resumeAdapter` on the task) and surface a **▶ Resume in <tool>**
  button on its strip card — one click relaunches that adapter at the project repo
  (renders the handoff packet to the clipboard and boots the command in the embedded
  terminal). Pick the tool from the task detail's **Resume in** dropdown. Reuses the
  Phase-7 adapter registry — Verqury launches the tool, it does not orchestrate it.
- **Multi-tab terminal** ([ADR-0010](docs/adr/0010-multi-session-terminal.md)): the
  embedded terminal now runs **multiple concurrent sessions** with a tab strip. Launch
  an adapter for a project to open (or focus) a **project-pinned tab** — relaunching the
  same project focuses its tab instead of stacking duplicates; the **+** button opens a
  plain shell tab; each tab's × closes just that one. Sessions have independent
  scrollback and survive both tab switches and navigation away and back.
- **Bell / attention alerts**: when a terminal rings the bell (BEL) — e.g. an agent
  CLI finishing and awaiting your input — Verqury plays a short beep, glows the tab that
  rang (so you know *which* one wants you), and, if Verqury is minimized, raises a desktop
  notification. A 🔔/🔕 toggle in the terminal toolbar mutes it. (To make Claude Code ring
  the bell in the embedded terminal, add a `Notification` hook to `~/.claude/settings.json`
  that runs `printf '\a' > /dev/tty` — its `terminal_bell` channel alone is gated and stays
  silent in an embedded terminal.)

### Changed
### Fixed

## [0.2.0] - 2026-07-09

Verqury becomes an **agent workbench** — an embedded terminal at the center,
with the library, clipboard organizer, and memory around it ([ADR-0009](docs/adr/0009-embedded-terminal.md)).

### Added
- **Embedded terminal** (node-pty + xterm.js): run your shell and AI CLIs inside
  a Verqury pane. Adapters gain a `target` — `terminal` launches the command in
  the embedded terminal at the project repo (the Claude Code starter now runs
  in-app); `external` keeps the detached-spawn behavior.
- **Send to terminal** from guidance docs and the bootstrap packet panel.
- Terminal toolbar (Capture selection → Inbox, Copy, Paste), Ctrl+Shift+C/V, and
  drag-text-onto-the-terminal-to-type.
- **Clipboard-watch** tray toggle: passively file everything you copy into the
  active project (off by default).
- Edit Verqury's own content in-app: inline narrative editing, **+ Log** /
  **+ Decision** on the timeline, and editable guidance bodies.

### Changed
- Identity shift from "layer" to "agent workbench" — the no-embedded-terminal
  anti-goal is superseded ([ADR-0009](docs/adr/0009-embedded-terminal.md)).

## [0.1.2] - 2026-07-08

### Added
- Create projects from the UI: a **+ New project** form (name, stage, status,
  repo, optional narrative). Projects were previously CLI-only.

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

[Unreleased]: https://github.com/spanklitch/verqury/compare/v0.6.5...HEAD
[0.6.5]: https://github.com/spanklitch/verqury/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/spanklitch/verqury/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/spanklitch/verqury/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/spanklitch/verqury/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/spanklitch/verqury/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/spanklitch/verqury/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/spanklitch/verqury/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/spanklitch/verqury/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/spanklitch/verqury/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/spanklitch/verqury/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/spanklitch/verqury/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/spanklitch/verqury/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/spanklitch/verqury/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/spanklitch/verqury/releases/tag/v0.1.0
