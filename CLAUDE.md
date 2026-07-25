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

### 2026-07-24 — verqury.com website + open-source + app↔web loop (ADR-0012)
Big multi-part session — a **new initiative**, not a build-plan phase. Arc:
- **Positioning + outline** (`docs/website.md`): Verqury ships **FREE + OPEN SOURCE (MIT)** as a
  portfolio piece; **standalone verqury.com** showcase on **Cloudflare Pages**, badged FlawedWorks
  family; app↔web loop. Sitemap / theme / IP posture captured there. **ADR-0012.**
- **Security pass → repo PUBLIC:** scanned all **19** spanklitch repos (trees + full history) for
  secrets/PII — clean. Purged personal Gmail from verqury history (`git filter-repo`, force-push,
  re-tag). Added **MIT LICENSE** + `license` fields + README mark notice; gitignored
  `docs/website.md` (internal infra notes). `spanklitch/verqury` → **public**.
- **Built + shipped verqury.com** (new repo **`spanklitch/verqury-site`**, static HTML/CSS/JS, no
  build): landing (hero · what-it-is · how-it-works · see-it · philosophy · get-it · under-the-hood
  · FlawedWorks footer) + `/whats-new` `/ideas` `/privacy` `/notice`. Dark-navy + chrome theme on
  the droplet logo; subtle shimmer/twinkle, reduced-motion-aware, **JS-gated reveals** (visible
  without JS); `_headers` CSP. Cloudflare Pages connected (Gary did the GitHub OAuth) → **LIVE at
  https://verqury.com + www** (SSL). Enabled **GitHub Discussions** (ideas board); published the
  **v0.6.0 Release** (AppImage + .deb) so the Download button resolves.
- **App deep-links** (commit `6733034`): Settings **"About & updates"** card → Check-for-updates
  (`/whats-new/`) + Share-an-idea (`/ideas/`) open the browser; **`app:version` IPC**;
  VERQURY_VERIFY **block 14**. Pushed source, **batched the release** (v0.6.1, deferred).
- **Screenshots:** added a **`VERQURY_CAPTURE`** dev hook (walks each view against a curated demo
  root, saves a PNG per view — dev-only, like VERQURY_VERIFY). Curated an **"Aurora"** demo
  project; captured real shots → replaced the v0.3.0 placeholders on the site (projects/tasks/
  inbox/about, 2×2). Fixed a real bug the shots surfaced: task detail rendered literal **"null"**
  for tasks with no report (native `replaceChildren(null)` coercion) → empty node.
- **PII remediation (image-based) — the grep pass was blind to pixels.** Public README hero showed
  a real home-dir path + private project name; terminal.png showed the machine hostname (`user@host`).
  Replaced HEAD hero with the clean Aurora capture; **filter-repo-purged the PII image blobs from
  BOTH verqury and verqury-site history** (+ deleted 4 stale remote feature branches carrying
  them); force-pushed; fresh-mirror verified clean. **Cloudflare Pages retains deleted files** →
  overwrote the live terminal.png with a **1×1 blank**. Audited images in the other public repos
  (flawedworks-site ZAGNALS marketing shots + icons) — clean. Gotchas in **eng-notes §9**; process
  fix: **visual image pass** before any repo goes public.
- **Relay:** confirmed **WORKING** (was presence=Here — not a bug; Away arms it) — off the repair
  list; surfaced on the site as a **"New"** feature. **ADR-0011 flipped Proposed→Accepted** (shipped
  v0.6.0).
- **Still open (v0.6.1 batch, deferred):** rebuild AppImage/.deb + `gh release` so the deep-links
  reach the installed app; run VERQURY_VERIFY block 14 in a clean build; workflow **videos** (Gary
  records). See SESSION_STATE.md for the resume list.

### 2026-07-15 — Remote decision relay: Phase C (built) — RELAY COMPLETE
Questions + long-form email (plan §8 Phase C, ADR-0011). Core: `approvals/` is now a Decision Inbox with a
**`kind`** (`permission` | `question`; missing → permission, Phase-B back-compat) — `createQuestion`/`answerQuestion`
(free-text answer + timeline echo)/`markEmailed`; **both answer fns guard their lane** (lane-cross throws; tests caught
it). **`verqury-ask` skill** (`skills/verqury-ask/`: SKILL.md + dependency-free `scripts/ask.cjs`) = the agent's OWN
clarifying-question path — files a question, blocks polling, **prints the answer to stdout** (a skill's stdout IS its
return to the model; verified vs current docs, not memory). App: Telegram `getUpdates` now also takes **`message`** →
`handleMessage` (typed replies via `reply_to_message.message_id`, `#code` fallback) + `q:<id>:<i>` option taps;
`reconcileApprovals` sends question cards and **emails full context once** for long/`needsContext` questions
(`app/src/mailer.js`, **nodemailer** MIT-0/zero-dep, injected transport; app-password → `~/.claude/.env`
`VERQURY_SMTP_PASSWORD`). Email is **powerless** (no link) — authority stays on the authed Telegram chat. Settings email
section live; Approvals tab renders questions (option buttons + free-text reply). **70 tests** (+6 core, +3 mailer) +
lint + **harness block 13** (askFiledQuestion/questionInboxCard/questionDesktopAnswered/askPollReadsAnswer + full
regression) green. Gotchas (kind back-compat, skill⇄core array/bool cross-reader, nodemailer-in-app-only, App Password
465/587, powerless-once email) in eng-notes **§8**; ADR-0011 Phase-C amendment. **Handoff (human-gated, like A/B live
test):** install skill → `~/.claude/skills/`, save Gmail app-password, live phone-reply+email test, build 0.6.0
AppImage + repoint launcher, git push. Presence flipped **Here** during the build so the armed gate didn't relay this
session's own prompts — flip back to Away deliberately. Phase C = the LAST relay phase; initiative complete.

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
chokidar-watch-a-dir-that-must-exist, hook⇄core cross-reader) in eng-notes §7. **SHIPPED v0.5.0** (merged
main 193ce31, tag v0.5.0) **+ LIVE-PHONE-VERIFIED**: real permission request → card on Gary's phone → tapped
Approve (~20 s) → hook returned `decision.behavior:"allow"` → timeline echo. Then v0.5.1 (below). Phase C next.

### 2026-07-15 — v0.5.1: relay de-dup + go-live
Gary saw **two Telegrams per permission event** (Phase A notify's "needs permission" text + Phase B's
Approve/Deny card). Fix: `hooks/verqury-notify.cjs` now **stays silent on permission messages** (`/permission/i`
→ `send:false`, reason `permission-handled-by-gate`) — the `PermissionRequest` gate owns permission; the notify
hook keeps only completion ("done") + idle/waiting. **One event → one Telegram.** Harness block 11 updated
(`hookSuppressesPermission`). 0.5.0→**0.5.1**; CHANGELOG [0.5.1]. **Went live:** built **0.5.1 AppImage + .deb**
(clean rebuild after a concurrent-kill `app-builder CANNOT_EXECUTE` — `npm install` restores app-builder-bin, then
ONE clean foreground `npm run dist`; validated packaged headlessly), **repointed launcher** 0.3.0→0.5.1
(`~/Applications/Verqury.AppImage` via install-desktop.sh), **installed both hooks** to `~/.claude/hooks/` +
**registered `PermissionRequest`** in `~/.claude/settings.json` (safe merge, backup, timeout 600). Pushed
(merged main deac123, tag v0.5.1; lockfile version-sync ee8cb58). **Left presence=Here** so live sessions aren't
relayed until Gary flips Away. **CAUTION:** the gate now fires for ALL Claude Code sessions — Away blocks each
prompt until a tap or the ~9-min desk fallback (that's the design; flip Here/Away deliberately).

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
