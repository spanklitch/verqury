# Verqury — Build Plan
**Name:** Verqury — "Layer, not IDE." A low-friction companion.
**Owner:** Gary Seiler / FlawedWorks
**Plan authored:** 2026-07-06 (Fable 5 planning session; execution intended for Opus)
**Status:** PLAN — not yet started

---

## How to run this plan (read this first, Opus)

This plan is executed one phase per Claude Code session to control token spend.
Per-session protocol:

1. Read this file top to bottom.
2. Read `PROGRESS.md` in the project root (created in Phase 0) to see what is done.
3. Execute exactly ONE phase (or one sub-step if the phase is large). Do not run ahead.
4. Verify against the phase's success criteria before declaring done.
5. Update `PROGRESS.md` with what shipped, what was verified, and any deviations.
6. Follow Gary's global CLAUDE.md: propose before coding, surgical changes,
   confirm before any git push, invoke the `project-docs` skill at init /
   decision / gotcha / release checkpoints.

Suggested session-start prompt for Gary to paste:
> Read verqury-build-plan.md and PROGRESS.md, then execute the next
> incomplete phase. Propose your approach before writing code.

---

## 1. Product summary

A low-friction Linux desktop companion for AI-assisted product development.
It is a **workflow layer, not an IDE**: it does not replace chat AIs, terminal
agents, editors, or browsers — it organizes the process around them.

Core value, in priority order:
1. **Durable project memory** — narrative, decisions, stage tracking from
   concept → PRD → architecture → build → test → docs → release → marketing.
2. **Reusable guidance as first-class assets** — skills, standards, and
   project instructions (markdown), composable per project and per session.
3. **Artifact capture** — copied prompts, commands, snippets, and reports
   become visible, searchable, reusable objects instead of clipboard ghosts.
4. **Session bootstrapping** — assemble the right context packet for the
   right surface (chat window, terminal agent, browser agent) in one action.
5. **Task routing & tracking** — tasks flow to direct execution, scripted
   automation, browser agents, or human-in-the-loop, and completion reports
   flow back into project memory.

Anti-goals (guardrails — reject scope creep toward these):
- NOT another chat interface. No embedded LLM chat in MVP.
- NOT a code editor. Never render/edit source trees.
- NOT an agent framework. It routes and records; it does not orchestrate
  API calls to models in MVP.
- NOT multi-user. Single user, local-first, no accounts, no cloud sync.

## 2. Foundational architecture decisions

These are settled. Write ADRs for each in Phase 0 (`project-docs` skill).

### ADR-1: Files are the database
All durable data is markdown with YAML frontmatter in a conventional
directory tree (see §3). SQLite (FTS5) is a **rebuildable index only** —
delete it and the app regenerates it by rescanning. Rationale:
- Terminal agents get native read/write access to project memory — the
  model-agnosticism requirement is satisfied structurally, not via adapters.
- Survives tool churn; git-versionable; greppable; zero lock-in.
- The app can die and the operating record remains fully usable.

### ADR-2: Core logic is a plain Node library + CLI; Electron is a shell
Build `verqury-core` as a dependency-light Node package with a thin CLI
(`verqury` command). The Electron app consumes the same library. Rationale:
- Every feature is testable/verifiable from the terminal before UI exists.
- Terminal-first users (and terminal agents!) can drive the product headless.
- UI phases become pure presentation work — lower risk per session.

### ADR-3: Electron for the desktop shell
JS end-to-end (Gary's stack). Needs system tray, global hotkeys, clipboard
polling — all first-class in Electron. Tauri rejected: Rust backend is
outside the maintainer's stack. Footprint accepted as a tradeoff.
Target platform: Linux x64 (Xubuntu/X11) only for MVP. Package as AppImage + .deb.

### ADR-4: Adapters are launch/handoff definitions, not API integrations
An "AI endpoint" in MVP = a named surface with: a launch command (e.g.
`claude` in a terminal at project root), a handoff format (context packet
template), and a return path (artifact capture / completion report). No
model API keys, no streaming, no SDKs in MVP. This keeps the product
routing-oriented and immune to provider churn.

### ADR-5: Vanilla-leaning frontend
Electron renderer uses plain HTML/CSS/JS or at most a minimal build step
(esbuild). No React/framework in MVP — the UI is lists, panes, and forms.
Cuts dependency surface and keeps sessions cheap.

## 3. Data layer specification

Configurable data root, default `~/FlawedWorks/verqury/`:

```
verqury/
├── config.json                # data-root config, adapter registry, hotkeys
├── index.sqlite               # rebuildable FTS index — gitignored
├── guidance/                  # GLOBAL reusable guidance
│   └── <slug>.md              # skills, standards, operating principles
└── projects/
    └── <project-slug>/
        ├── project.md         # narrative + frontmatter: stage, status, links
        ├── guidance/          # project-specific instruction files
        │   └── <slug>.md
        ├── memory/
        │   ├── decisions/     # one file per decision (ADR-lite)
        │   │   └── NNN-<slug>.md
        │   └── log/           # append-oriented session/progress notes
        │       └── YYYY-MM-DD-<slug>.md
        ├── artifacts/         # captured fragments
        │   └── YYYY-MM/<ulid>.md
        ├── tasks/
        │   └── <ulid>.md      # one file per task
        └── packets/           # session-bootstrap templates
            └── <slug>.md
```

### Frontmatter schemas (keep minimal; extend only when a feature needs it)

`project.md`:
```yaml
name, slug, created, stage (concept|prd|architecture|build|test|docs|release|marketing|shipped),
status (active|paused|shipped|archived), repo (path), links ([{label,url}])
```

`guidance/*.md` (global and project):
```yaml
title, slug, kind (skill|standard|instruction|template), tags [], created, updated
```

`artifacts/*.md`:
```yaml
id (ulid), captured (ISO datetime), source (clipboard|manual|report),
kind (prompt|command|snippet|report|note|url), project, tags [], title (optional)
```
Body = the captured content verbatim, fenced if code.

`tasks/*.md`:
```yaml
id (ulid), title, created, stage, route (direct|automation|browser-agent|human),
status (todo|handed-off|in-progress|done|dropped),
surface (adapter slug, optional), report (artifact id, optional)
```
Body = task description + handoff payload.

`packets/*.md` (bootstrap template):
```yaml
title, slug, surface (adapter slug), includes [paths/globs relative to data root]
```
Body = template text with `{{include}}` markers and `{{project.*}}` variables.

### Index (SQLite, FTS5)
One `documents` virtual table: path, type, project, title, tags, body, mtime.
Incremental refresh via mtime comparison; full rebuild command must exist.
Watcher (chokidar) keeps it live while the app runs.

## 4. Feature modules (map to phases)

1. **Project registry & memory** — create/list projects, stage tracking,
   decision files, log entries, timeline view assembled from memory/ + tasks.
2. **Guidance library** — browse/search global + project guidance, copy
   contents, create from template, "promote to global" for project guidance.
3. **Artifact inbox** — global hotkey captures current clipboard into the
   active project's artifacts (kind auto-guessed, editable). Inbox UI: list,
   search (FTS), tag, assign-to-project, copy-back-to-clipboard, delete.
4. **Session bootstrapper** — pick project + packet template → core resolves
   includes and variables → output to clipboard AND/OR write to a file path
   (e.g. drop into a repo as context for a terminal agent). One click/command.
5. **Task router** — task board grouped by route lanes; "hand off" action
   generates the handoff payload (via packet template for that surface),
   copies it, marks task handed-off; "attach report" links a captured
   artifact and marks done, echoing an entry into memory/log/.
6. **Adapter registry** — config-defined surfaces: `{slug, label, launch
   command, packet template, notes}`. Launch button runs the command
   (e.g. opens terminal at project repo running `claude`). Pure config —
   adding a new AI tool never requires a code change.

## 5. Build phases

Each phase = one Opus session (split if a session runs long; never merge
two phases into one session). Every phase ends with verified success
criteria and a PROGRESS.md update.

### Phase 0 — Repo init & scaffolding (small)
- Create repo `verqury` under ~/claude-projects/; move this plan into it. `git init`, private GitHub repo AFTER Gary confirms.
- Invoke `project-docs` skill: README, CHANGELOG, docs/adr/ (write ADR-1..5
  from §2), docs/engineering-notes.md.
- Create `PROGRESS.md` (phase checklist + session log).
- Node project scaffold: workspaces or flat `core/` + `app/` layout,
  eslint minimal, no framework installs yet.
- **Done when:** repo exists with docs + ADRs; `npm test` runs (even if trivial);
  PROGRESS.md shows Phase 0 complete.

### Phase 1 — verqury-core: data layer + CLI (the keystone, medium-large)
- Implement data-root bootstrap, frontmatter read/write (gray-matter),
  schemas from §3, ULID generation.
- Commands (library API + CLI): `init`, `project create/list/show`,
  `project set-stage`, `guidance list/show/add`, `log add`, `decision add`.
- SQLite FTS index: build, incremental refresh, `search <query>`, full rebuild.
- Unit tests against a temp data root.
- **Done when:** from a clean shell, `verqury init && verqury project create demo
  && verqury search demo` works; tests pass; index deletes/rebuilds cleanly.

### Phase 2 — Electron shell + project views (medium)
- Electron app boots to tray + main window; loads verqury-core.
- Views: project list (stage/status badges), project detail (narrative,
  stage control, memory timeline: log + decisions merged chronologically).
- Global search box backed by FTS.
- File watcher keeps views live when files change on disk (terminal edits
  appear without restart — this is a headline behavior, verify it).
- **Done when:** creating a log entry via CLI appears in the running app
  within ~2s; stage change in UI is visible in project.md frontmatter.

### Phase 3 — Guidance library (small-medium)
- Global + project guidance browsing, search, markdown preview, copy-to-
  clipboard, new-from-template, promote-to-global.
- **Done when:** a project instruction file created in the UI is a valid
  markdown file on disk, findable via `verqury search`, and promotable
  to guidance/ global.

### Phase 4 — Artifact inbox + clipboard capture (medium; the riskiest OS integration)
- Global hotkey (default e.g. Ctrl+Alt+C) captures clipboard → artifact in
  the ACTIVE project (active project = explicit selector in tray/UI).
- Kind auto-guess (heuristics: shell-looking → command, fenced/indented →
  snippet, URL → url, else note); editable in a quick-capture toast/dialog.
- Inbox view: filter by kind/tag/project, FTS search, copy-back, retag, delete.
- X11 focus/hotkey gotchas go in engineering-notes.
- **Done when:** copy text anywhere in the OS, hit hotkey, artifact file
  exists with correct frontmatter and appears in inbox; copy-back round-trips.

### Phase 5 — Session bootstrapper (medium)
- Packet templates per §3; resolver for `{{include}}` globs and
  `{{project.*}}` variables in core, with CLI: `verqury packet render <slug>`.
- UI: pick project → pick packet → preview → copy to clipboard / write to file.
- Ship 3 starter packets: `chat-ideation`, `terminal-build` (writes a context
  file into the project repo), `browser-task`.
- **Done when:** rendering `terminal-build` for a project produces a file
  containing the project narrative, selected guidance, and last N log entries;
  clipboard path verified.

### Phase 6 — Task router (medium)
- Task CRUD in core + CLI; board UI with route lanes (direct / automation /
  browser-agent / human).
- Hand-off action: render the task's handoff payload via the surface's packet
  template → clipboard → status=handed-off.
- Attach-report action: link an inbox artifact → status=done → auto-append a
  memory/log entry ("Task X completed, report: artifact Y").
- **Done when:** full loop demonstrated — create task, hand off (payload on
  clipboard), capture a fake report via hotkey, attach it, see the completion
  echoed in the project timeline.

### Phase 7 — Adapter registry + launch (small)
- `config.json` adapters per §4.6; settings UI to add/edit; per-project
  launch buttons (spawn detached process, e.g. xfce4-terminal at repo path
  running the agent command).
- Ship starter adapters: claude-code (terminal), claude-chat (browser URL),
  cursor (editor), comet/browser-agent (browser URL + browser-task packet).
- **Done when:** adding a fictional new adapter via settings requires zero
  code changes and its launch + handoff both work.

### Phase 8 — Packaging, docs, release prep (small-medium)
- electron-builder: AppImage + .deb; autostart-to-tray option.
- README polish, CHANGELOG 0.1.0, annotated tag, screenshots.
- Security/sanitization pass (global CLAUDE.md push protocol) before any push.
- **Done when:** AppImage installs and runs on a fresh-ish profile; v0.1.0
  tagged; Gary has confirmed the push.

### Deferred (post-0.1 candidate list — do NOT build during phases 0–8)
- Git awareness (auto-log commits into memory), stage-gate checklists,
  marketing-asset templates, packet scheduling, Wayland support, artifact
  dedup, browser-extension capture, direct API adapters, cross-project
  analytics, encrypted artifact vault.

## 6. Risks & gotchas to watch
- **Clipboard/global hotkey on Linux** is the flakiest surface (Phase 4).
  X11/XFCE is the target and is well supported; do not chase Wayland in MVP.
- **Scope gravity**: every phase will tempt toward chat UI, editor features,
  or agent orchestration. The anti-goals in §1 are binding.
- **Index drift**: the SQLite index must always be safe to delete. Any
  feature that stores truth only in SQLite violates ADR-1 — reject it.
- **Electron + better-sqlite3** native module rebuilds (electron-rebuild) —
  budget time in Phase 2; record the incantation in engineering-notes.
- **Session sizing**: Phases 1, 4, 5 are the likely overruns. Split rather
  than rush; PROGRESS.md records the split point.

## 7. Open questions for Gary (answer before Phase 0)
1. Data root location: `~/FlawedWorks/verqury/` proposed — confirm.
2. Should existing projects (Mebit, ZAGNALS) be back-imported as seed data
   during Phase 1 testing, or start clean?
3. Default capture hotkey preference.

(Resolved: name = **Verqury**, tagline "Layer, not IDE" — 2026-07-06.)

## 8. Remote decision relay — approve builds from the phone (initiative, post-0.3)

Planned 2026-07-14. Rationale, alternatives, and the full reasoning live in **ADR-0011**;
this section is the phase spec. Goal: trigger a multi-step build in the morning and keep it
moving from the day job — *notified on the phone when a running Claude Code build needs a
decision or finishes, and able to answer the common approvals with a tap*. Verqury stays a
**relay** (agent raises its hand → human decides → Verqury carries it both ways); it never
auto-answers. Claude Code only at first (hooks/skills are Claude features); the ADR-0010
bell/pty path is the universal floor for other CLIs. Detection uses Claude Code's `Notification`
/ `PermissionRequest` hooks + a `verqury-ask` skill — **no terminal scraping, no keystroke
injection**. Everything file-mediated; the **Decision Inbox** is a third file-backed inbox
beside artifacts (P4) and tasks (P6). Secrets → `~/.claude/.env`, non-secrets → `config.json`.
Phases are A→C; **native iOS companion app (D) is shelved**, not planned.

**Rulings (Gary, 2026-07-14):** expire → `ask` (graceful fall-back to the desktop prompt, not
`deny`); Phase A ships **Telegram-only**, email deferred to C.

### Phase A — Here/Away + config UI + outbound notify (small-medium; lowest risk, no blocking)
- Desktop **Here/Away toggle**; state written to `config.json` (HERE = ADR-0010 bell/tab;
  AWAY = notify the phone).
- **Config/setup section on the existing Settings tab:** enable notifications, Telegram
  setup (bot token → `~/.claude/.env` via the "save to .env?" pattern; `chat_id`), Here/Away
  control. Email fields may appear but stay inert until Phase C.
- **`Notification` hook** (`~/.claude/hooks`): reads Here/Away; when AWAY, sends a Telegram
  message on `agent_needs_input` ("session X needs you") and `agent_completed` ("task done").
  Non-blocking — nothing waits, nothing can auto-approve.
- **Done when:** with Away set, a real Claude Code permission prompt produces a Telegram
  message on the phone within seconds, and `agent_completed` produces a "done" ping; token
  is read from `~/.claude/.env` and never logged.

### Phase B — the remote tap: interactive approval gate (medium; the fail-safe phase)
- **`PermissionRequest` blocking hook:** AWAY → write a **Decision Inbox** record →
  Telegram card with inline `[Approve][Deny]` (callback carries the decision id) → poll the
  record → return `permissionDecision`.
- **Verqury long-polls Telegram** (no inbound port), writes the tapped answer into the record.
- **Self-timed lifecycle inside the 600 s ceiling:** `T=0` notify → `T=7min` "expiring in
  2 min" reminder → `T=9min` expire → return **`ask`** (fall back to the desktop prompt).
  The 1-min margin must beat the harness's auto-PROCEED-on-timeout.
- Decision Inbox record is markdown; answers auto-log into the project timeline (as P6 does).
- **Done when:** Away, a pending commit → Telegram tap `Approve` runs it / `Deny` blocks it;
  no answer within 9 min parks the decision at the desk via `ask`; multiple concurrent tabs
  stay unambiguous via the `#id` in each card.

### Phase C — rich decisions: Skill + email long-form (medium)
- **`verqury-ask` Skill** for the agent's *own* clarifying questions: write a Decision Inbox
  record `{kind, summary, options, body}` → poll for the answer → return it to the model.
- **Escalating email read channel:** when a decision body is long (or flagged needs-context),
  also send an email carrying the full context; the Telegram card degrades to "context in
  email `#a7`, respond here." Email is powerless (context only, no actionable link).
- **Correlation ids** (`#a7`) join the email and the Telegram card; typed answers map back via
  Telegram reply-to-message. Gmail SMTP app-password → `~/.claude/.env`.
- **Done when:** a long-form decision emails the full context, the matching `#id` Telegram
  card resolves it by tap or typed reply, and the answer returns to the paused agent.
