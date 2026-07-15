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

## Working convention: prefer official Skills, screen every pull

Before building a new Skill — or hand-coding any multi-step, domain-knowledge task
(doc/spreadsheet/PDF generation, MCP scaffolding, test harnesses, etc.) — check the
official catalog at github.com/anthropics/skills first; don't reinvent a vetted
skill. Skills ship executable Python/Shell scripts, so **every pull gets a mandatory
security screen** (quarantine at a pinned commit → read SKILL.md + all scripts →
grep for network/exec/credential/destructive/install/obfuscation → license check →
confirm with Gary before installing into ~/.claude/skills/). Note the doc skills
(docx/pdf/pptx/xlsx) are source-available, not open source. Two enforcement layers
exist outside this repo: global Verqury guidance `check-official-skills-first`
(auto-injects via the terminal-build bootstrap packet) and a non-blocking Claude
Code PreToolUse/Write hook (`~/.claude/hooks/skill-check.js`) that fires on SKILL.md
writes. Added 2026-07-13.

## Build-by-build notes

### 2026-07-06 — Phase 0
Scaffolded repo, docs, workspace. Details in PROGRESS.md session log. Nothing
non-obvious encountered.

### 2026-07-07 — Phase 1
verqury-core data layer + `verqury` CLI (projects, guidance, memory, FTS5 search).
Deps: better-sqlite3, gray-matter. 17 tests green. Deferred ULID→Phase 4 and
chokidar→Phase 2 (no Phase-1 consumer). Domain = pure file I/O; CLI refreshes the
index after mutations. FTS5 = delete+insert on mtime change (no UPDATE) — see
docs/engineering-notes.md §2. Details in PROGRESS.md session log.

### 2026-07-07 — Phase 2
Electron shell (app/): main.js (ESM) + preload.cjs + vanilla renderer; project list,
detail (narrative + stage control + memory timeline), search, tray, live file watcher.
Testable logic in app/src/{api,watcher}.js. **ADR-0006: search runs out-of-process
(system `node` + CLI), so Electron never loads better-sqlite3 → NO electron-rebuild.**
Deps: electron 41, chokidar 5. 23 tests green. Both done-when criteria proven in the
running app via the VERQURY_VERIFY harness (live update 2→3; stage change persisted).
Engineering gotchas (execPath vs node, ESM/CJS, capturePage) in engineering-notes §3.

### 2026-07-07 — Phase 3
Guidance library: Projects/Guidance tabs, scoped guidance browsing, markdown preview,
copy-to-clipboard, new-from-template, promote-to-global. Core: listAllGuidance,
promoteGuidance + CLI. In-house dependency-free markdown renderer (app/src/markdown.js,
HTML-escaped; ADR-0005) — also upgrades narrative. Clipboard/external-links via preload
bridge. Renderer is now an ES module. 29 tests green; all done-when proven via harness
(markdownRendered / guidanceCreated / guidancePromoted true) + FTS-findable. Details in
PROGRESS.md; renderer notes in engineering-notes §3.

### 2026-07-07 — Phase 4
Artifact inbox + clipboard capture. Core: artifacts.js (CRUD + guessKind), ids.js (ULID,
deferred from P1), activeProject config, artifact indexing, artifact/active CLI. App:
global Control+Alt+C → clipboard→artifact into active project + notification; Inbox tab
(capture-to selector, kind filter, copy-back/retag/change-kind/delete). Capture logic
injectable (api.captureClipboard) → unit-tested sans Electron. Artifact bodies stored
VERBATIM (not fenced) for exact copy-back. 36 tests green; harness proves hotkeyRegistered
/ captureFiledArtifact / captureRoundTrips / inboxCards. X11 hotkey/clipboard gotchas in
engineering-notes §3.

### 2026-07-07 — Phase 5
Session bootstrapper. Core packets.js: GLOBAL packet templates at <root>/packets/
(ADR-0007, deviates from §3 per-project sketch), {{project.*}}/{{includes}}/{{log:N}}
substitution + tiny in-house globber, renderPacket, 3 starters seeded by init. packet
list|render CLI. App: ⚡ Bootstrap panel in project detail (packet dropdown, live preview,
copy / write-to-repo). 40 tests green; harness proves packetHasContext/packetFileWritten/
packetClipboard/bootstrapPreview. Fixed a null-text-node bug (replaceChildren with null).

### 2026-07-07 — Phase 6
Task router (ties P4 artifacts + P5 packets into a loop). Core tasks.js: per-project tasks
(ULID), CRUD, renderHandoff (prepends surface's packet context), attachReport (artifact →
done → auto-log echo into timeline). TASK_ROUTES/STATUSES, task indexing, task CLI. App:
Tasks tab, route-laned list, detail with status/route + Hand-off (payload→clipboard) +
Attach-report (artifact picker → done). 44 tests green; harness proves the full done-when
loop (taskHandoffClipboard/taskHandedOff/taskClosed/taskEchoedInTimeline/taskCards). Board
= route-grouped sidebar sections (not horizontal kanban) — fits 2-pane layout.

### 2026-07-07 — Phase 7
Adapter registry (ADR-0004 concrete). Core adapters.js: config-only surfaces
{slug,label,command,packet,notes}, CRUD over config.json, resolveCommand, 4 starters seeded
once (config.adaptersSeeded flag). adapter list CLI. App: Settings tab (⚙) CRUD form +
per-project launch buttons; adapter:launch renders handoff packet→clipboard then spawns the
substituted command detached (shell:true,unref). 47 tests green; harness proves done-when
via the settings FORM (adapterCards=5, adapterLaunched, adapterHandoffCopied) + full P2–6
regression. Gotcha: config.json not watched → settings UI self-refreshes (eng-notes §3).

### 2026-07-07 — Phase 8 (code/config/docs done; build pending Gary)
Release prep. ADR-0008 resolves ADR-0006: packaged search runs CLI under Electron's embedded
node (ELECTRON_RUN_AS_NODE, app.isPackaged→api.configureNode); electron-builder rebuilds
better-sqlite3 for Electron ABI + asarUnpack. Dev/tests unchanged (system node).
Autostart-to-tray (~/.config/autostart/verqury.desktop; --hidden→createWindow(false)).
electron-builder config (AppImage+deb, electronVersion pinned for monorepo). v0.1.0 across
root/core/app. README hero + Packaging; CHANGELOG [0.1.0]; eng-notes §4. 47 tests + full
27-check harness regression green. **AppImage build NOT run — electron-builder can't complete
in this sandbox (app-builder-bin dropped); Gary runs `npm run dist -w app` on a real host,
verifies, then tags v0.1.0. Verqury is feature-complete.**

### 2026-07-15 — Remote decision relay: Phase B (built)
Approve-by-tap — the interactive gate (plan §8 Phase B, ADR-0011). Core `approvals.js` = third
file-backed inbox (`<root>/approvals/`, **global**; named `approvals` NOT `decisions` — the latter
is the per-project ADR log `memory/decisions`): create/get/list/pending/answer(allow|deny, atomic +
timeline echo)/expire + `approval` CLI. **Blocking** `PermissionRequest` hook `hooks/verqury-permission.cjs`
(dependency-free): HERE/disabled → emit nothing (native prompt); AWAY+configured → file a pending record,
poll it, **self-expire at 9 min → emit nothing (desk fallback)**; on tap emit `decision.behavior` allow/deny.
App is the **single Telegram consumer** (`app/src/telegram.js`, getUpdates long-poll): sends the inline
[✅ Approve][⛔ Deny] card, writes the verdict back, T=7min nudge; new **Approvals tab** + pending badge.
**Contract corrected vs. this ADR's assumption (verified against live docs):** `PermissionRequest` =
`decision.behavior` **allow/deny only, no `ask`**; 600 s timeout **fails open** → the 9-min self-expire is
load-bearing; "ask" = emit nothing. `init()` now creates `approvals/` so the watcher sees the first pending.
61 tests + lint + VERQURY_VERIFY **block 12** (7/7 in the running app: filed→inbox card→badge→desktop
answer→cleared→gates-when-Here) green. Gotchas (single-consumer getUpdates, `Atomics.wait` sync sleep,
chokidar-watch-a-dir-that-must-exist, hook⇄core cross-reader) in eng-notes §7. **Handoff:** live phone
round-trip needs Gary's bot+phone (like Phase A). No push, no AppImage yet. 0.4.0→0.5.0. Phase C next.

### 2026-07-14 — Remote decision relay: Phase A (built)
Here/Away + outbound Telegram notify (plan §8 Phase A, ADR-0011). Core `notify.js`
(config.json: presence/enabled/telegram.chatId, email inert) + `notify` CLI. Standalone
**non-blocking** Claude Code `Notification` hook `hooks/verqury-notify.cjs` → installed to
`~/.claude/hooks/`, registered as a 2nd Notification entry (bell + skill-check preserved,
backup saved). AWAY+enabled → POSTs the notification to Telegram; zero-dep, reads config.json
+ `~/.claude/.env` off disk, token never logged, always exits 0. App: Settings "Notifications
& remote relay" panel + tray "Away" checkbox; `saveEnvVar`/`hasEnvVar` (0600, `VERQURY_ENV_FILE`
override, value never returned to renderer). **Verified against current hooks docs first**
(Notification input shape; completion is fuzzy — "done" ping rides the catch-all Notification
hook, top-level reliability TBD live). 54 tests + lint + harness block 11 (9/9, isolated .env)
green; fixed an enriched-IPC-return bug the harness caught. **`.cjs` not `.js`** so the
no-package.json install dir doesn't warn (eng-notes §6). Anti-goal intact: relay, not
orchestrator — it shows the prompt, Gary decides. **Handoff:** live phone test needs Gary's
BotFather token + chat_id (like Phase 8's AppImage). No push yet. Phase B (approve-by-tap) next.

### 2026-07-14 — Planning: remote decision relay (ADR-0011, plan §8) — no code
Designed the "approve builds from the phone" initiative with Gary. Goal: trigger a multi-step
Claude Code build in the morning and keep it moving from the day job — pinged on the phone when
it needs a decision or finishes, answering the common approvals with a tap — while still making
the approvals himself (his learning loop). Verqury stays a **relay** (agent raises its hand →
human decides → Verqury carries it), never auto-answers → §1 anti-goal intact. Detection uses
Claude Code's `Notification` + `PermissionRequest` hooks and a `verqury-ask` skill — **no
terminal scraping, no keystroke injection**; everything file-mediated (Decision Inbox = third
inbox beside artifacts/tasks). Telegram = fast bidirectional channel (long-poll, no inbound
port); email = optional long-form read channel (Phase C), joined by a `#id`. Load-bearing
gotcha verified against current hook docs (not memory): blocking hooks time out at **600 s and
then auto-PROCEED**, so the gate self-times (T=0 notify / T=7min reminder / T=9min expire→`ask`,
1-min safety margin). Secrets → `~/.claude/.env`, non-secrets → `config.json`. **Phases A→C in
plan §8; native iOS app (D) shelved.** Rulings: expire→`ask`; Phase A Telegram-only. **Phase A
is the next build session** (one-phase-per-session rule). Reasoning + alternatives in ADR-0011.
