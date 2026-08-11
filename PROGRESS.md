# Verqury — Build Progress

One phase per AI-agent session against [verqury-build-plan.md](verqury-build-plan.md).
Each session: read the plan, read this file, execute the next incomplete phase,
verify success criteria, update this file.

## Phase checklist

- [x] **Phase 0 — Repo init & scaffolding** (2026-07-06)
- [x] **Phase 1 — verqury-core: data layer + CLI** (2026-07-07)
- [x] **Phase 2 — Electron shell + project views** (2026-07-07)
- [x] **Phase 3 — Guidance library** (2026-07-07)
- [x] **Phase 4 — Artifact inbox + clipboard capture** (2026-07-07)
- [x] **Phase 5 — Session bootstrapper** (2026-07-07)
- [x] **Phase 6 — Task router** (2026-07-07)
- [x] **Phase 7 — Adapter registry + launch** (2026-07-07)
- [x] **Phase 8 — Packaging, docs, release prep** (2026-07-08 — AppImage built + verified running; only v0.1.0 tag + push remain)
- [x] **Remote decision relay — Phase A** (2026-07-14 — Here/Away + Telegram notify hook; code+harness verified, live phone verified)
- [x] **Remote decision relay — Phase B** (2026-07-15 — approve-by-tap: PermissionRequest gate + Approval inbox + app Telegram round-trip; **LIVE-PHONE-VERIFIED**; shipped v0.5.0, then **v0.5.1** relay de-dup; 0.5.1 AppImage built + launcher repointed + hooks installed/registered)
- [x] **Project instrumentation — slice 1** (2026-08-07 — ADR-0013 + transcript harvester + build-time meter; **shipped v0.6.3** with the two carried UX fixes. LOC deferred to an OTel slice.)
- [x] **App lifecycle — one app per data root** (2026-08-10 — ADR-0015 + single-instance lock + pid-owned heartbeat; shipped v0.6.6)
- [x] **Project instrumentation — slice 2** (2026-08-10 — ADR-0014 + loopback OTLP receiver; LOC + real USD cost on the meter, off by default. Built, tested and pushed; **not yet released** — no version bump, ADR still Proposed.)
- [x] **Remote decision relay — Phase C** (2026-07-15 — `verqury-ask` skill + question inbox + escalating email context + typed-reply channel; 70 tests + lint + harness block 13 green; **SHIPPED v0.6.0 + LIVE-PHONE+EMAIL-VERIFIED**. Relay initiative COMPLETE (A→C).)

## Open questions (plan §7)

1. Data root location: `~/FlawedWorks/verqury/` — building against this default; configurable.
2. ~~Back-import Mebit/ZAGNALS?~~ **RESOLVED 2026-07-07: yes, seed both** at end of
   Phase 1 via the normal CLI (no importer feature — scope creep). Entries are stubs +
   pointers: project.md with `repo:` path to the code repo + links, plus a few decisions/
   log entries distilled from each project's CLAUDE.md. Source code never enters Verqury.
   Data root is user data, never in this repo — publishability unaffected (ADR-0001).
   Note: live post-ship projects will cycle `stage` back to `build` per release train;
   the linear stage enum is a label, not a gate.
3. ~~Capture hotkey?~~ **RESOLVED 2026-07-07: Ctrl+Alt+C** (Phase 4).

All plan §7 questions are now resolved.

## Repo status

Private GitHub repo `spanklitch/verqury` created + main pushed 2026-07-07 (Gary confirmed).

**RENAMED Velora → Verqury 2026-07-07:** "Velora" is taken by a company publishing a
vibe-coding product. Gary researched availability, is registering "Verqury" and grabbing
verqury.com. Renamed everywhere: repo dir, GitHub repo, package names (verqury,
verqury-core, verqury-app), CLI command (`verqury`), data root (`~/FlawedWorks/verqury/`),
all docs + plan file. Tagline "Layer, not IDE" unchanged. Historic references to "Velora"
in early commit messages remain — history is immutable, and the name never shipped.

## Session log

### 2026-07-06 — Phase 0 (session 1)
**Shipped:** Repo at `~/claude-projects/verqury/` (git init, branch `main`); build plan
moved into repo; standard doc set via project-docs skill (README with architecture
diagram, CHANGELOG at [Unreleased], ADRs 0001–0005 covering plan §2, engineering-notes
stub); Node 20 workspace `core/` + `app/` with `verqury` CLI stub, node:test smoke test,
minimal eslint flat config; `.gitignore` (secrets, node_modules, *.sqlite) written first.

**Verified:** `npm install && npm test` green; `npm run lint` clean; secret-hygiene grep
clean; first commit made locally.

**Deviations:** none.

**Not done (deliberate):** GitHub remote/push — awaits Gary's confirmation per push
protocol. No dependencies beyond eslint installed (gray-matter, better-sqlite3, chokidar
etc. land in Phase 1 when used).

**Next session:** Phase 1 — data layer + CLI (the keystone; plan §5 Phase 1 + §3 spec).

### 2026-07-07 — Phase 1 (session 2, Opus)
**Shipped:** `verqury-core` data layer + `verqury` CLI. Modules in `core/src/`:
`paths`, `slug`, `schema` (enum vocab + validation), `frontmatter` (gray-matter
wrapper), `config`, `init`, `projects` (create/list/show/set-stage), `guidance`
(add/list/show, global + project scope), `memory` (log add, numbered decision add),
`search` (FTS5 build/refresh/search/rebuild), barrel `index.js`, and `cli.js`
(init, project, guidance, log, decision, search, index, config). Deps added:
better-sqlite3, gray-matter. 17 tests across 6 files (unit + CLI child-process
round-trip) against temp data roots.

**Verified:** `npm test` 17/17 green; `npm run lint` clean; manual end-to-end run of
the success-criteria commands (init → project create → log/decision → search →
delete index.sqlite → rebuild → search) all correct; generated project.md /
decision / config.json inspected — well-formed YAML frontmatter, Ctrl+Alt+C hotkey
default present.

**Deviations from plan (deliberate, per simplicity rule):**
- **ULID deferred to Phase 4.** Plan listed "ULID generation" under Phase 1, but no
  Phase-1 command produces one (ULIDs are for artifacts/tasks). Added no ulid dep.
- **chokidar deferred to Phase 2.** Phase 1 needs on-demand build/refresh/rebuild
  only; the live watcher is an app-runtime concern.
- Domain functions do pure file I/O; the CLI refreshes the index after mutations
  (clean ADR-0001 boundary; the Phase 2 watcher will refresh its own way).
- Fixed a leftover `companion` typo in the plan's Phase 1 success criteria → `verqury`.
- Broadened `.gitignore` `*.sqlite` → `*.sqlite*` (WAL side files).

**Not done (deliberate):** artifacts/tasks/packets dirs are created per project but
have no commands yet (their phases: 4/6/5). No Electron. No push yet — awaits Gary.

**Next session:** Phase 2 — Electron shell + project views (plan §5 Phase 2). First
Electron install; budget time for better-sqlite3 electron-rebuild (plan §6).

### 2026-07-07 — Phase 2 (session 3, Opus)
**Shipped:** Electron shell (`app/`). `main.js` (ESM: window + tray + IPC + watcher),
`preload.cjs` (sandboxed contextBridge), vanilla renderer (`renderer/`: sidebar with
search + project list, detail pane with narrative + stage dropdown + merged memory
timeline; theme-aware light/dark CSS). Testable headless logic split into
`app/src/api.js` + `app/src/watcher.js`. Core additions: `listLog`/`listDecisions`/
`projectTimeline` readers, native-free `verqury-core/files` barrel + `exports` map,
`search --json` + `timeline` CLI. Deps: electron 41, chokidar 5. Generated
`renderer/assets/icon.png` (violet placeholder; real branding → Phase 8).

**Verified:**
- 23 tests green (18 core + 5 app: api, watcher/live-fire, search-subprocess), lint clean.
- Ran the actual Electron app headlessly via a `VERQURY_VERIFY` harness against a
  seeded root (Mebit + ZAGNALS). `verify.json`: 2 project cards rendered, detail title
  "Mebit", **liveUpdate before=2 after=3 passed=true** (a log written on disk appeared
  in the running app's timeline within 2s — done-when #1), **stageChange
  wroteTestStage=true** (stage set via the UI bridge persisted to project.md —
  done-when #2). Screenshot captured and visually confirmed (brand, badges, timeline,
  stage dropdown all correct).

**KEY DECISION — ADR-0006 (search runs out-of-process):** Electron never loads
better-sqlite3, so **no electron-rebuild needed at all** (the plan §6 budget item is
moot). App reads files in-process via `verqury-core/files` (no native dep); search
shells out to the **system `node`** running the CLI (ABI-matched to better-sqlite3).
better-sqlite3 stays system-ABI, so CLI + `npm test` never break. Trade-off: running
app needs `node` on PATH for search — Phase 8 packaging resolves (bundle node, or
rebuild for Electron). Details + Electron ESM/CJS, chokidar v5, tray, capturePage
gotchas in docs/engineering-notes.md §3.

**Deviations from plan:** search subprocess instead of in-process sqlite + electron-
rebuild (ADR-0006 — simpler, avoids the fragile dual-ABI dance). Markdown narrative
shown as plain text this phase; real markdown rendering deferred to Phase 3 (which
explicitly owns "markdown preview").

**Not done (deliberate):** no clipboard/hotkey (Phase 4), no guidance library UI
(Phase 3). Tray uses a placeholder icon. No push yet — awaits Gary.

**Next session:** Phase 3 — Guidance library (plan §5 Phase 3): browse/search global +
project guidance, markdown preview, copy-to-clipboard, new-from-template, promote-to-
global. Good place to add a small markdown renderer for narrative + guidance preview.

### 2026-07-07 — Phase 3 (session 4, Opus)
**Shipped:** Guidance library. Sidebar Projects/Guidance tabs; guidance list grouped by
scope (Global + per project); detail with kind/scope/tags, rendered markdown, Copy, and
Promote-to-global (project-scoped only); New-guidance form (title, kind, scope, kind-aware
body scaffold). Core: `listAllGuidance`, `promoteGuidance` + `guidance promote` /
`guidance list --all` CLI. New dependency-free markdown renderer `app/src/markdown.js`
(headings/emphasis/code/fences/lists/links/hr/blockquote, HTML-escaped) — also upgrades
the project narrative from plain text. Clipboard + external links routed through the
preload bridge (Electron `clipboard`/`shell`). Renderer converted to an ES module to
import the markdown module.

**Verified:**
- 29 tests green (20 core incl. promote/listAll; 9 app incl. 4 markdown cases covering
  HTML-escape + unsafe-link rejection). Lint clean.
- VERQURY_VERIFY harness (extended) against a seeded root: guidanceCards=2,
  **markdownRendered=true** (`.markdown h1` in DOM), **guidanceCreated=true** (created via
  UI bridge → valid file on disk — done-when #1), **guidancePromoted=true** (project→global
  file move — done-when #2). Plus a search confirmed promoted guidance is FTS-findable
  (done-when #3). Phase 2 checks still pass. Screenshot confirmed (grouped list + rendered
  markdown with heading/list/inline-code/link).

**Deviations:** none. Markdown renderer is intentionally minimal per ADR-0005 (no vendored
lib); covers what guidance/narrative files use. No new ADR (this follows ADR-0005, not a
reversal).

**Not done (deliberate):** no guidance editing of existing bodies in-app (create-only +
promote; editing free-form bodies would drift toward an IDE — anti-goal). Real markdown
edge cases (tables, nested lists) not handled — add only if a guidance file needs them.

**Next session:** Phase 4 — Artifact inbox + clipboard capture (plan §5 Phase 4; the
riskiest OS integration). Global hotkey Ctrl+Alt+C → capture clipboard into the active
project's artifacts; kind auto-guess; inbox view. ULID generation lands here (deferred
from Phase 1). Clipboard READ needed (Phase 3 added clipboard write via the bridge).

### 2026-07-07 — Phase 4 (session 5, Opus)
**Shipped:** Artifact inbox + clipboard capture. Core: `artifacts.js` (add/list/show/
delete/retag/setKind + `guessKind` classifier), `ids.js` (in-house ULID — deferred here
from Phase 1), ARTIFACT_KINDS/SOURCES, `activeProject` config get/set, artifact indexing
in search, `artifact add|list` + `active` CLI. App: global `Control+Alt+C` hotkey reads
clipboard → files an artifact into the active project + system notification; Inbox tab
(capture-to selector, Ctrl+Alt+C button, kind filter, artifact cards; detail with kind
dropdown, editable tags, copy-back, delete). Capture logic is `api.captureClipboard(root,
readClipboard)` with the clipboard read INJECTED → unit-tested without Electron.

**Verified:**
- 36 tests green (24 core incl. ulid/guessKind/artifact lifecycle; 12 app incl. 3 capture-
  path cases). Lint clean.
- VERQURY_VERIFY harness (extended): **hotkeyRegistered=true**, **captureFiledArtifact=true**
  (clipboard→artifact file on disk in active project), **captureRoundTrips=true** (stored
  body === captured text), **inboxCards=1** (appears in inbox). All Phase 2/3 checks still
  pass. Screenshot confirms inbox UI (classifier tagged `git rebase…` as command; verbatim
  body, kind/tags editors, copy-back/delete). CLI confirms captured artifacts are FTS-findable.

**Deviations:** artifact bodies stored VERBATIM (not "fenced if code" as plan said) so
copy-back round-trips exactly and files stay clean for agents — kind frontmatter carries
the signal (engineering-notes §3). No separate quick-capture popup window — capture is
immediate + notification, and kind/tags are editable in the inbox detail (satisfies
"editable in a dialog"; a 2nd window was unneeded scope on the riskiest phase). Hotkey
verified via registration + handler (harness can't synthesize an OS key event).

**Not done (deliberate):** Wayland global-shortcut (X11 only, ADR-0003). No artifact→task
promotion yet (that's Phase 6's attach-report loop).

**Next session:** Phase 5 — Session bootstrapper (plan §5 Phase 5): packet templates with
`{{include}}` globs + `{{project.*}}` vars; render to clipboard / write to a repo file;
ship chat-ideation / terminal-build / browser-task starter packets. `verqury packet render`.

### 2026-07-07 — Phase 5 (session 6, Opus)
**Shipped:** Session bootstrapper. Core `packets.js`: global packet templates at
`<root>/packets/` ([[ADR-0007]] — deviates from §3's per-project sketch; reusable +
`{{project.*}}`-parameterized), a small `{{…}}` substitution engine (`{{project.*}}`,
`{{includes}}` guidance-glob expansion with a tiny in-house globber, `{{log:N}}` recent
entries), `renderPacket`, add/list/show, and 3 starter packets seeded by `init`
(chat-ideation, terminal-build, browser-task). Packets indexed for search. `packet
list|render` CLI (`--out`, `--log`). App: a ⚡ Bootstrap button in project detail opens a
panel — packet dropdown, live preview, Copy-to-clipboard, and Write-to-<output> (writes a
context file into the project repo). New `packet:list|render|write` IPC.

**Verified:**
- 40 tests green (28 core incl. 4 packet cases: starters seeded, render expands
  vars/includes/log, `log:N` limit, unknown-marker passthrough; 12 app). Lint clean.
- VERQURY_VERIFY harness: **packetHasContext=true** (rendered terminal-build has narrative
  + guidance + log — done-when), **packetFileWritten=true** (written to a file via the
  write IPC, contains guidance — done-when "produces a file"), **packetClipboard=true**
  (clipboard round-trip — done-when "clipboard path verified"), **bootstrapPreview=true**
  (UI panel live-previews terminal-build). All Phase 2–4 checks still pass. Screenshot
  confirms the Bootstrap panel. CLI render verified too.
- Fixed a real bug found via the screenshot: a stray "null" text node in the bootstrap
  actions when a packet had no output (passing null to replaceChildren) — now filtered.

**Deviations:** packets are GLOBAL (ADR-0007), not per-project as §3 sketched — required
by the reusable-template + pick-project-then-packet semantics.

**Not done (deliberate):** no packet editing UI (starters + CLI `packet` cover authoring;
free-form template editing would be editor-ish). Surface field is set but not yet wired to
launching (that's Phase 7 adapters).

**Next session:** Phase 6 — Task router (plan §5 Phase 6): task CRUD + board UI with route
lanes (direct/automation/browser-agent/human); hand-off renders a packet payload →
clipboard → status; attach-report links an inbox artifact → done → auto-append a log entry.
ULID reused for task ids. Ties packets (Phase 5) + artifacts (Phase 4) into a loop.

### 2026-07-07 — Phase 6 (session 7, Opus)
**Shipped:** Task router — the loop that ties packets (P5) + artifacts (P4) together. Core
`tasks.js`: per-project tasks (ULID ids), CRUD, `renderHandoff` (prepends the surface's
packet context to the task payload), `attachReport` (links artifact → status done → auto-
appends a memory/log entry, closing back into the timeline). TASK_ROUTES/TASK_STATUSES
enums. Tasks indexed for search. `task add|list|status|handoff|report` CLI. App: Tasks tab
with route-laned task list, detail with status/route dropdowns, Hand-off (payload→clipboard
→handed-off), Attach-report (project-artifact picker → done), new-task form. `task:*` IPC.

**Verified:**
- 44 tests green (32 core incl. 4 task cases: route validation, CRUD, handoff-with-packet-
  context, attachReport→timeline echo; 12 app). Lint clean.
- VERQURY_VERIFY harness — the full done-when loop in the running app:
  **taskHandoffClipboard=true** (payload on clipboard), **taskHandedOff=true**,
  **taskClosed=true** (attach report → done + report linked), **taskEchoedInTimeline=true**
  (completion appears in project timeline), **taskCards=1** (route lane renders). All Phase
  2–5 checks still pass. Screenshot confirms Tasks UI (done badge, linked report, payload).
  CLI loop verified independently too.

**Deviations:** "board with route lanes" implemented as route-grouped sections in the
sidebar (like guidance-by-scope) + detail pane, not a horizontal kanban — fits the app's
2-pane layout and is more usable in a solo tool. Hand-off enriches the task payload with
the surface's matching packet (wires P5 into P6) — reasonable reading of "render the
handoff payload via the surface's packet template".

**Not done (deliberate):** surface field is free-selected from packet surfaces; actual
launching of a surface is Phase 7 (adapters). No task due-dates/priority (not in scope).

**Next session:** Phase 7 — Adapter registry + launch (plan §5 Phase 7): config.json
adapters {slug,label,launch command,packet template,notes}; settings UI to add/edit;
per-project launch buttons (spawn detached, e.g. xfce4-terminal at repo running the agent);
starter adapters (claude-code/claude-chat/cursor/browser-agent). Adding an adapter must
need ZERO code changes. This connects task.surface + packet.surface to real launches.

### 2026-07-07 — Phase 7 (session 8, Opus)
**Shipped:** Adapter registry — ADR-0004 made concrete. Core `adapters.js`: config-only AI
surfaces {slug,label,command,packet,notes}, CRUD over config.json, `resolveCommand`
({{repo}}/{{project.*}} substitution), 4 starter adapters seeded once (tracked by
config.adaptersSeeded). `adapter list` CLI. App: Settings tab (⚙) with adapter list +
add/edit/remove form; per-adapter launch buttons in each project detail. `adapter:launch`
(main) renders the handoff packet → clipboard, then spawns the substituted command detached
(shell:true, unref). `adapter:*` IPC.

**Verified:**
- 47 tests green (35 core incl. 3 adapter cases: starters seeded, CRUD, resolveCommand;
  12 app). Lint clean.
- VERQURY_VERIFY harness — done-when via the SETTINGS FORM (not code): filled the New-adapter
  form and saved → **adapterCards=5** (4 starters + fictional "Harness"), then launched it →
  **adapterLaunched=true** (its `echo > sentinel` command ran) + **adapterHandoffCopied=true**
  (its terminal-build packet copied to clipboard). **All Phase 2–6 checks still pass in the
  same run** (full regression). Screenshot confirms the Settings/adapter UI.

**Deviations:** none. (Phase 7 implements the pre-existing ADR-0004; no new ADR.)

**Gotcha recorded:** config.json is NOT watched (watcher covers projects/ + guidance/ only),
so adapter changes don't fire data:changed — the settings UI refreshes its own list after
each mutation. See engineering-notes §3.

**Not done (deliberate):** launch commands target XFCE/X11 (xfce4-terminal/xdg-open) per
ADR-0003; other DEs need the user to edit the command (that's the point — pure config).

**Next session:** Phase 8 — Packaging, docs, release prep (plan §5 Phase 8, the LAST):
electron-builder AppImage + .deb, autostart-to-tray option, README polish, CHANGELOG 0.1.0,
annotated v0.1.0 tag, screenshots, security/sanitization pass. NOTE the ADR-0006 caveat:
the app shells out to system `node` for search — packaging must bundle node or rebuild
better-sqlite3 for Electron (decide + document; may supersede ADR-0006).

### 2026-07-07 — Phase 8 (session 9, Opus) — code/config/docs complete; build pending
**Shipped:** Release prep. **ADR-0008** resolves the ADR-0006 packaging caveat: the search
subprocess is configurable (`api.configureNode`); the packaged app runs the CLI under
Electron's embedded node (`ELECTRON_RUN_AS_NODE`, gated on `app.isPackaged`), and
electron-builder rebuilds better-sqlite3 for Electron's ABI + asarUnpack. Dev/tests
unchanged (system node). Autostart-to-tray (tray "Start on login" toggles
`~/.config/autostart/verqury.desktop`; `--hidden` → `createWindow(false)`). electron-builder
config in app/package.json (AppImage + deb, electronVersion pinned for the monorepo, icon,
maintainer). Versions bumped to **0.1.0** (root/core/app). README: hero screenshot
(docs/screenshots/verqury.png) + Packaging section. CHANGELOG **[0.1.0] - 2026-07-07** with
compare/release links. engineering-notes §4 Packaging.

**Verified:**
- 47 tests green, lint clean. Full VERQURY_VERIFY harness re-run with the Phase 8 code
  changes: **all 27 checks pass** (regression — configureNode default/system-node search,
  tray/window rework, createWindow(show) all fine). Hero screenshot captured from the app.
- **NOT verified: the actual AppImage build.** electron-builder cannot complete in this
  sandbox — its internal npm install / binary fetch drops `app-builder-bin` (spawn ENOENT),
  an environment limit, not a config bug. Stopped after 3 attempts per the anti-grind rule.
  Config is correct (got past electron-version + author resolution); build needs a real host.

**Remaining (Gary, on a real machine):**
1. `npm run dist -w app` → confirm the AppImage launches on a fresh-ish profile. This is the
   ONLY path that exercises ADR-0008's ELECTRON_RUN_AS_NODE search — verify search works in
   the packaged app specifically.
2. After confirming: `git tag -a v0.1.0 <release-commit> -m "v0.1.0 — first release"` at the
   Phase 8 commit, verify with `git show v0.1.0 --stat | head`, then `git push origin v0.1.0`.

**Notes:** AppImage done-when not met in-session (environmental). Everything else (config,
code, docs, versioning) complete + verified. See engineering-notes §4 for the monorepo
electronVersion pin + sandbox-drops-binaries gotchas.

**Build plan status: Phases 0–7 fully done; Phase 8 code/config/docs done. Verqury is
feature-complete; only the human-gated release build + tag remain.**

### 2026-07-08 — Phase 8 build FIXED + VERIFIED (session 9 cont., Opus)
**Root cause of the failed build (was misread as a sandbox issue):** electron-builder's
"installing production dependencies" step **prunes devDependencies from the hoisted npm
workspace and deletes its own `app-builder-bin` helper mid-build** → `spawn … app-builder
ENOENT`. Reproducible, environment-independent. Known electron-builder + workspaces bug.

**Fix (ADR-0008 revised):** `npmRebuild: false` (no rebuild → no prune → build completes)
+ `asar: false` (so the system-`node` search subprocess can execute the CLI as plain files)
+ packaged search uses the **system node** (dropped the `ELECTRON_RUN_AS_NODE`/isPackaged
switch); the bundled system-ABI better-sqlite3 matches the node that built it. Added
`homepage` (deb metadata required it). eslint now ignores `dist/`.

**VERIFIED on this machine (2026-07-08):**
- `npm run dist -w app` → **built `app/dist/Verqury-0.1.0.AppImage` (121 MB) + `verqury-app_0.1.0_amd64.deb` (83 MB)**.
- Launched the packaged AppImage headless (`--appimage-extract-and-run`) with the
  VERQURY_VERIFY harness → **all 27 checks PASS in the packaged app**, and `index.sqlite`
  was written by the packaged search subprocess (proves system-node + better-sqlite3 work
  inside the package). 47 tests + lint green.

**DONE-WHEN MET** (AppImage installs+runs; search works). Remaining = human-gated only:
Gary verifies the AppImage on his desktop (double-click / run it, click around), then tags:
`git tag -a v0.1.0 <commit> -m "v0.1.0 — first release"` → `git push origin v0.1.0`.
Trade-off (ADR-0008): packaged app needs `node` on PATH — fine for the dev audience; a
self-contained variant is a post-0.1 follow-up.

**ALL 9 PHASES DONE. Verqury 0.1.0 is built and verified; it ships the moment Gary pushes
the commits + tag.**

### 2026-07-08 — SHIPPED 🚀
Commits pushed (`f96f9af` on `main`); annotated **`v0.1.0` tag created at f96f9af, verified,
and pushed to origin**. Release artifacts built locally: `app/dist/Verqury-0.1.0.AppImage`
(121 MB) + `verqury-app_0.1.0_amd64.deb` (83 MB). **Verqury 0.1.0 is released.** The build
plan is complete end to end (Phases 0–8). Post-0.1 ideas live in the plan's "Deferred" list.
Optional follow-ups: a GitHub Release with the AppImage/deb attached (`gh release create
v0.1.0 app/dist/Verqury-0.1.0.AppImage app/dist/verqury-app_0.1.0_amd64.deb`); a
flawedworks.com/verqury page; back-import Mebit/ZAGNALS as seed data (plan §7 decision).

### 2026-07-10 — Resume reminders (post-0.2.0, v0.3.0 candidate)
"Where you left off" nudges, driven by Gary's need to be reminded on return that a live
app (ZAGNALS) is awaiting Apple approval before the next step. Deliberately Verqury-native
and file-backed (not an external cron/ASC check). **Reuses the Tasks layer** rather than a
new concept: one optional frontmatter flag `resume: true`; an open flagged task surfaces in
a dismissible strip across the top of the window, refreshed whenever Verqury is opened
(`win.on('show')` → renderer). Core: `listResumeReminders(root)` (open resume tasks, active
project first), `addTask({resume})`, `task resume` CLI. App: `resume:list` IPC + `app:shown`
event; resume strip with Open / Snooze (session-only) / Done; **Remind me on open** toggle in
task detail. Crosses no anti-goal; stays ADR-0001 (reminder is a task .md file).

**Verified:** 48 tests green (core `listResumeReminders` unit test: filtering + active-first
sort + toggle-off) + lint clean. VERQURY_VERIFY harness (block 8b) against a seeded root in
the running Electron app: **resumeToggled=true, resumeSurfacedOnOpen=true, resumeCleared=true**,
plus P2–P7 core-loop regression green (projectCreated/liveUpdate/stageChange/guidance*/capture*/
taskClosed). (`hotkeyRegistered=false` only because Ctrl+Alt+C was already claimed on the live
`:0.0` desktop the harness ran against; `markdownRendered=false` was a thin-seed artifact.)
Gotcha: node-pty isn't installed in this env, so the resume block runs *before* the terminal
block to stay independent of it. Multi-tab terminal remains the queued v0.3.0 sibling phase.

### 2026-07-11 — Resume-in-tool launch button (extends resume reminders)
Follow-on from Gary's UX note: the reminder tells you *what* you were doing but drops you at
the door without the key. A reminder now carries an optional `resumeAdapter` (adapter slug);
its strip card shows a **▶ Resume in <tool>** button that fires the *existing* `adapter:launch`
(renders handoff packet → clipboard, boots the command in the embedded terminal at the repo).
Set the tool from the task detail's **Resume in** dropdown (populated from the adapter registry;
Claude Code is a seeded starter). **Reuses Phase-7 adapters — Verqury launches the tool, does
not orchestrate it** (anti-goal clear). Per-reminder scope (field on the task .md, not the
project), so reminders in one repo can point at different tools. Core: `addTask({resumeAdapter})`
+ `listTasks` surfaces it (→ `listResumeReminders` carries it; `updateTask` persists it). App:
launch button on the strip card + adapter picker in task detail; label resolves from
`state.adapters`, falls back to slug.

**Verified:** 49 tests green (new core test round-trips `resumeAdapter` through
add/list/update/clear) + lint clean. VERQURY_VERIFY harness (block 8b, isolated
`VERQURY_DATA_ROOT` seeded with `init` + one project) in the running Electron app:
**resumeLaunchButton=true** alongside resumeToggled/Surfaced/Cleared and the full P2–P7 +
terminal regression (adapterCards=5, terminalAdapterRouted=true). `hotkeyRegistered=false` again
just reflects the live desktop's existing Ctrl+Alt+C grab; markdown/packet-context falses are
thin-seed artifacts, not regressions (this diff touches only task/resume code).

### 2026-07-12 — Multi-tab terminal (ADR-0010; v0.3.0 sibling phase)
Promoted the embedded terminal from a singleton to a keyed `Map<id,…>` of sessions with a
tab strip. **Main:** `ptys = Map<id,pty>`; `ptyStart(id,{shell,cwd})` pins cwd at spawn;
`pty:data`/`pty:exit` carry the id; `pty:input`/`resize`/`kill` keyed by id; `before-quit`
kills all. **Renderer (terminal.js):** `sessions = Map<id,{term,fit,wrap}>`, one global
pair of PTY listeners dispatching by id, per-session persistent container moved in/out of
view (the ADR-0009 trick, now per tab). Tab strip: click to switch, × to close, **+** for a
plain shell (`shell:<n>`). **One tab per project (Gary's call):** launched tabs use a
deterministic id `proj:<slug>` so relaunch focuses/restarts rather than duplicating.
**Launch is renderer-driven:** `launchAdapter` (main) returns a `{id,label,cwd}` pin instead
of touching a PTY; the renderer's `launchAdapterUI` opens the tab and writes the command —
so the xterm listener attaches before output (no missed first line). Removed the old
main-side `pty:send`/`nav:terminal`; "send to terminal" is now `sendToActiveTerminal` against
the active tab. Anti-goal clear: several user-driven shells ≠ agent orchestration.

**Verified:** 49 tests + lint green (terminal is UI-only; covered by the harness, not units).
VERQURY_VERIFY harness block 10 rewritten for multi-tab, isolated root, running app — ALL
green: terminalDefaultTab=1, terminalAdapterPin=true, terminalTwoTabs=2, terminalProjectPinned,
terminalActiveRanCommand, terminalReuseNoDup, terminalTabsIsolated (shell tab has no trace of
the project tab's output), terminalHasPrompt, terminalPersistsOnReturn (both tabs survive
nav), terminalTabClosed — plus full P2–P7 + resume regression. Same hotkey/markdown/packet
falses (env + thin-seed), unrelated. Small `window.__verquryTerm` hook added for the harness
(like `__verquryReady`). **Both v0.3.0 sibling phases now built; ready to reconcile versions
and release.**

Bell/attention alerts folded in (Gary's ask): `term.onBell` → synthesized Web Audio beep +
per-tab attention glow (background tabs only) + focus-gated desktop notification, with a
🔔/🔕 mute toggle. Verified how Claude Code signals (per the "don't trust stale third-party
memory" rule): it fires `idle_prompt`/`permission_prompt` but only desktop-notifies in
Ghostty/Kitty/iTerm2, so the embedded xterm needs `preferredNotifChannel terminal_bell` — the
BEL our `onBell` catches. Harness gained terminalBellAttention + terminalBellCleared (both
true via a test-only `ringBellForTest` hook that writes BEL exactly as pty:data would).

### 2026-07-14 — Remote decision relay: Phase A (build session, Opus)
**Shipped:** "See a build's prompts on your phone." Core `notify.js`: non-secret relay
config in `config.json` (`notify: {presence here|away, enabled, telegram.chatId, email{…inert}}`),
`getNotify`/`setPresence`/`updateNotify`; `notify [here|away|enable|disable|chat-id]` CLI.
**Hook** `hooks/verqury-notify.cjs` (installed to `~/.claude/hooks/`): a **non-blocking**
Claude Code `Notification` hook — when AWAY+enabled it POSTs the notification to Telegram;
zero-dep, reads `config.json` + `~/.claude/.env` off disk, never logs the token, always exits 0.
App: Settings **"Notifications & remote relay"** panel (Here/Away segmented control, enable,
chat_id, bot-token→`~/.claude/.env` via the save-to-.env convention, token/hook status lines;
email fields inert/"Phase C") + a tray **"Away (notify my phone)"** checkbox. `saveEnvVar`/
`hasEnvVar` in api.js (0600, path overridable via `VERQURY_ENV_FILE`; value never returned to
the renderer). Docs verified against current hooks docs first (not memory): Notification input
shape + that completion is fuzzy (see below). Registered the hook as a **second** Notification
entry in `~/.claude/settings.json` (preserving the existing bell + skill-check hooks; backup saved).

**Verified:**
- 54 tests green (40 core incl. 3 notify: defaults/no-secret, presence round-trip, deep-merge;
  14 app incl. 2: token→isolated-.env 0600 + value-never-returned, notify config merge) + lint clean.
- Hook proven headlessly via dry-run across all four gates (Here→disabled, Away-no-token→no-token,
  Away+configured+permission→needs-you, +completion→done).
- VERQURY_VERIFY harness (new **block 11**, placed before the terminal block so it never depends
  on node-pty; isolated `VERQURY_ENV_FILE` so the real `~/.claude/.env` is untouched) — all 9
  Phase-A checks green in the running app: notifyPanelShown, notifyPresenceAway (UI segmented
  control → config.json), notifyEnabledChat, **notifyTokenNotInConfig** + **notifyTokenInEnv**
  (secret in .env, never config.json), **hookSendsWhenAway** + **hookGatesWhenHere** (installed
  hook run as a real subprocess), **hookTextNoSecret**, notifyTokenStatus. Full P2–P10 regression
  green; only `hotkeyRegistered` false (the known live-desktop Ctrl+Alt+C grab, unrelated).

**Bug caught + fixed via the harness:** `notify:setPresence`/`update` IPC returned the bare core
config, so the renderer dropped `tokenSet`/`hookInstalled` on any toggle → made all three notify
mutations return the enriched state and made `showNotifyPanel` always refetch. Gotchas
(`.cjs`-not-`.js` for the no-package.json install dir; completion fuzziness; non-blocking
contract) in engineering-notes §6; secret handling in §5.

**Not done (deliberate / the one true handoff):** the final done-when — a real permission prompt
buzzing Gary's **actual phone** — needs his BotFather token + chat_id + phone (mirrors Phase 8's
AppImage: build everything, human does the live verification). Everything up to the network POST
is proven. **No git push** (awaits Gary). Phase B (interactive approve-by-tap gate) is next.

### 2026-07-15 — Remote decision relay: Phase B (build session, Opus 4.8)
**Shipped:** "Approve builds by tap." The interactive gate. Core `approvals.js` — a third
file-backed inbox (`<root>/approvals/<ulid>.md`, **global** like packets so the dependency-free
hook writes without resolving a project; named `approvals` to avoid colliding with the
`memory/decisions` architecture-decision log): `createApproval`/`getApproval`/`listApprovals`/
`pendingApprovals`/`answerApproval`(allow|deny, atomic write + project-timeline echo)/
`expireApproval`; `approval list|answer|expire` CLI. **Blocking hook** `hooks/verqury-permission.cjs`
(dependency-free `PermissionRequest`): HERE/disabled → emit nothing (native prompt); AWAY+enabled+
chat+token → file a pending record, poll it, self-expire at 9 min → emit nothing (desk fallback);
on answer emit `{hookSpecificOutput:{hookEventName:'PermissionRequest',decision:{behavior:allow|deny}}}`.
App: single Telegram long-poll (`app/src/telegram.js` — getUpdates/sendApprovalCard/editMessageText/
answerCallbackQuery), sends the inline **[✅ Approve][⛔ Deny]** card per pending approval, writes the
tapped verdict into the record, T=7min "expiring" nudge; new **Approvals tab** (waiting/resolved +
desktop Approve/Deny + pending-count badge); IPC + preload bridge; `approvalsDir` added to the watcher
and created at `init()` so the first pending fires the watcher.

**Corrected the ADR-0011 contract against live docs (not memory):** `PermissionRequest` returns
`decision.behavior` ∈ **allow/deny only** (no `ask`) — the "expire→ask" ruling is realized by emitting
nothing; the 600 s timeout **fails open**, so the 9-min self-expire is load-bearing. Amendment written
into ADR-0011; gotchas (single-consumer getUpdates, Atomics.wait sync sleep, chokidar-watch-a-dir-that-
must-exist, hook⇄core cross-reader contract, atomic answer write) in engineering-notes **§7**.

**Verified:**
- 61 tests green (47 core incl. **7 new approvals**: create/list, answer+clear, allow/deny-only guard,
  timeline echo, bad-project-silent, expire-vs-prior-answer, **hook⇄core cross-reader**; 14 app) + lint clean.
- Hook proven headlessly across all gate cases (disabled/here → engage:false; away+configured → files the
  record; real poll loop with short timers: pre-answered → emits allow; no-answer → emits nothing + marks expired).
- VERQURY_VERIFY harness (new **block 12**, before the terminal block; relay skipped under the harness — no
  network): **permHookFiled**, **approvalPendingOnDisk**, **approvalInboxCard**, **approvalTabBadge**,
  **approvalDesktopAnswered**, **approvalClearedFromPending**, **permHookGatesWhenHere** — all green in the
  running app. (Ran on the real X display; xvfb not installed. Three unrelated checks — markdownRendered/
  packetHasContext/packetFileWritten — false only because the test used a minimal one-project seed lacking
  their rich content; not regressions.)

**SHIPPED + LIVE-VERIFIED (same session):** pushed v0.5.0 (merged main 193ce31, tag v0.5.0). Then ran the
**live phone test** — launched the Phase B app (Away), fired a real permission request through the actual hook:
card hit Gary's phone → **he tapped Approve (~20 s later)** → hook returned `decision.behavior:"allow"` → the
answer echoed into the verqury project timeline. Full round-trip proven on real hardware. (20 s gap = a human
tap, not an auto-answer — nothing in the code auto-answers.)

### 2026-07-15 — v0.5.1: relay de-dup + go-live (release session, Opus 4.8)
Gary noticed **two Telegrams per permission event** — the Phase A `Notification` hook's plain "needs permission"
text AND the Phase B Approve/Deny card. Fix: `hooks/verqury-notify.cjs` now **suppresses permission messages**
(`/permission/i` → `send:false, reason:'permission-handled-by-gate'`); the notify hook keeps only the events the
gate doesn't own — completion ("done") + idle/waiting. **One event, one Telegram.** Harness block 11 updated
(notify sends on "done", `hookSuppressesPermission` on permission, gates when Here) — all relay checks green in
dev + packaged. Version 0.4.0→0.5.0→**0.5.1**; CHANGELOG [0.5.1]; eng-notes note.

**Go-live (all done this session):** built the **0.5.1 AppImage + .deb** (clean build after an `app-builder
CANNOT_EXECUTE` from a concurrent-kill during a first attempt — restored via `npm install` + a single clean
foreground build; validated the packaged AppImage headlessly, 51 checks). **Repointed the launcher**
(`~/Applications/Verqury.AppImage` 0.3.0→0.5.1 via install-desktop.sh). **Installed both hooks** to
`~/.claude/hooks/` and **registered the `PermissionRequest` hook** in `~/.claude/settings.json` (safe merge,
backup saved, timeout 600). Presence left at **Here** so live sessions aren't relayed until Gary flips Away.
Pushed v0.5.1 (merged main deac123, tag v0.5.1) + a package-lock version sync (ee8cb58). **Caution captured:**
the gate is now armed for ALL Claude Code sessions — Away blocks each prompt until a tap or the ~9-min desk
fallback. Phase C (verqury-ask skill + email long-form) is next.

### 2026-07-15 — Remote decision relay: Phase C (build session, Opus 4.8) — RELAY COMPLETE
**Shipped:** "Ask a question / read long context from your phone." The final relay phase (plan §8, ADR-0011).
- **Core** generalized the `approvals/` inbox to a **Decision Inbox with a `kind`** (`permission` | `question`;
  missing = permission for Phase-B back-compat): `createQuestion`/`answerQuestion`(free text + timeline echo)/
  `markEmailed`; both `answerApproval` and `answerQuestion` now guard their lane (a lane-cross bug the tests
  caught). `approval ask|reply` CLI.
- **`verqury-ask` skill** (`skills/verqury-ask/` — SKILL.md + dependency-free `scripts/ask.cjs`): the agent's OWN
  clarifying-question path. Files a question → **blocks polling** → prints the owner's answer to stdout (the skill's
  return channel to the model). Skill format verified against current docs (SKILL.md frontmatter + `${CLAUDE_SKILL_DIR}`
  script; stdout = model-visible result), not memory.
- **App:** Telegram `getUpdates` now also takes **`message`** updates → `handleMessage` resolves **typed replies**
  (by `reply_to_message.message_id`, `#code` fallback) + `q:<id>:<i>` **option taps**; `reconcileApprovals` sends
  question cards and, for long/`needsContext` questions, **emails the full context once** (`app/src/mailer.js`,
  **nodemailer** MIT-0/zero-dep, injected transport) with the card degrading to "📧 context emailed #code". App-password
  → `~/.claude/.env` (`VERQURY_SMTP_PASSWORD`). Settings email section activated; Approvals tab renders questions
  (option buttons + free-text reply). Email is **powerless** (no link) — authority stays on the authed Telegram chat.

**Verified:**
- **70 tests green** (was 61: +6 core question/kind/cross-reader/lane-guard, +3 mailer) + lint clean.
- `verqury-ask/scripts/ask.cjs` proven headlessly: dry-run files a question, core cross-reads it, the poll reads a
  core-written answer back, timeout prints the desk fallback.
- **VERQURY_VERIFY harness block 13** (isolated seeded root, relay network-skipped) — all green in the running app:
  **askFiledQuestion, questionInboxCard, questionDesktopAnswered, askPollReadsAnswer** — plus the full P2–P12 +
  terminal regression. (Same known falses as prior runs: `hotkeyRegistered` = the live-desktop Ctrl+Alt+C grab;
  `markdownRendered`/`packetHasContext`/`packetFileWritten` = thin one-project seed lacking rich content — not
  regressions; this diff touches only question/email code.)

**Contract notes (verified live, not memory):** skill stdout is the model return channel; Telegram `reply_to_message.
message_id` maps typed replies; Gmail needs a 16-char App Password over 465(TLS)/587(STARTTLS) — plain passwords gone
since May 2025. nodemailer adds **zero** subdeps (the audit `high`s trace to node-gyp/make-fetch-happen from
node-pty/better-sqlite3, pre-existing). Gotchas in eng-notes **§8**; ADR-0011 Phase-C amendment written.

### 2026-07-15 — Phase C GO-LIVE: shipped v0.6.0 + live phone/email verified (same session, Opus 4.8)
All human-gated steps completed with Gary, in a plain Terminal (no bootstrap trap):
- **Installed** `skills/verqury-ask/` → `~/.claude/skills/` (hot-loaded). **Built the 0.6.0 AppImage + .deb**,
  repointed `~/Applications/Verqury.AppImage` (byte-identical to the build); packaged boot verified.
- **Email = personal Gmail** (address redacted — see local `~/.claude/.env`), App Password → `~/.claude/.env` `VERQURY_SMTP_PASSWORD`.
  We first chased **gary@flawedworks.com**: found flawedworks.com DNS is on **Cloudflare** but MX = **ImprovMX**
  (forward-only); ImprovMX **SMTP sending is Premium-only ($9/mo)** with no DKIM on Free — so sending *as* the
  flawedworks alias needs either that upgrade or a Gmail "Send mail as" alias. Gary chose to **drop the alias** and
  use his Gmail directly (From=To=login → zero mailer change). Direct SMTP send test → email arrived.
- **Live results (real phone, single 0.6.0 app):** Test A **option tap** → "Apple" (5.2s, question path, decision
  null); Test B **typed reply** → "Next Thursday" (84s, mapped via `reply_to_message`); Test C **timeout → desk
  fallback** (never auto-answered); Test D **long question → email + `#code` reply** → "Yes. Received" (99s,
  emailedAt stamped, timeline echo). Relay round-trip proven end to end.
- **Shipped:** branch `phase-c-relay` → merged `--no-ff` to main (**c7f3db0**), tag **v0.6.0** pushed. Security
  pass clean (`.env`/`dist`/binaries gitignored; real chat_id lives only in untracked `.claude/settings.local.json`;
  the one `HARNESS-SECRET` is the pre-existing fake fixture).

**Gotchas caught live (→ eng-notes candidates):**
- **Stale-app trap:** an OLD 0.5.1 AppImage was still running from earlier and, being pre-Phase-C, treated a
  *question* as a permission — wrote `decision: allow` on it — while a 2nd (new) instance also polled → **two
  Telegram consumers racing**. Fix: kill ALL Verqury, launch exactly one current build. Always confirm the running
  binary == the freshly built one (compare process start-time vs build mtime; `cmp` launcher vs dist).
- **Self-relay noise:** running the live test *from a Claude Code session while Away* means this session's OWN
  permission prompts relay to the phone, mixed with the test cards (~24 stray permission records). Mitigation:
  fire the question, then run NO Bash until the background runner returns; the `#code` plain-message answer path is
  the robust one (independent of reply-linking); flip **Here** when done. Cleaned the 28 session-test records after.
- **Powerless-email UX:** a card saying "check your EMAIL, then REPLY here" invites replying to the *email* (dead
  end) — keep the card's answer instruction Telegram-only.

Presence left at **Here** (relay armed but not relaying live sessions until Gary flips Away). Remaining optional:
GitHub Release with the 0.6.0 binaries; flawedworks.com/verqury page. **The remote decision relay (A→C) is done.**

### 2026-07-14 — Planning session: remote decision relay (no code)
Designed, with Gary, a way to monitor/answer running Claude Code builds from his phone while
away from the desk (trigger a build in the morning, keep it moving from the day job, while
still making the approvals himself — that's how he's learning). Verqury stays a **relay**, not
an orchestrator. Verified Claude Code's hook capabilities against the current docs
(code.claude.com/docs/en/hooks) rather than memory: `PermissionRequest`/`PreToolUse` block up
to **600 s** and return `allow`/`deny`/`ask`, but **auto-PROCEED on timeout** — so the gate
hook must self-time (7-min reminder / 9-min expire→`ask`, 1-min margin under the ceiling). The
`Notification` hook fires `agent_needs_input`/`agent_completed` for the outbound pings.
Captured as **ADR-0011** (full reasoning + alternatives, incl. the shelved native iOS app) and
**plan §8** (Phases A→C). **Rulings:** expire→`ask`; Phase A is Telegram-only (email→C).
Secrets → `~/.claude/.env`, non-secrets → `config.json`. **Phase A is the next build session.**

### 2026-07-24 — verqury.com website + open-source flip + app↔web loop (initiative, not a phase)
A large multi-part session outside the build-plan phases. **ADR-0012** records the decision.

- **Positioning/outline** → `docs/website.md`: FREE + OPEN SOURCE (MIT), standalone verqury.com
  showcase on Cloudflare Pages, badged FlawedWorks; app links out to a web companion.
- **Went public:** security-scanned all 19 spanklitch repos (trees + full history); purged the
  personal Gmail from verqury history (`git filter-repo` + force-push + re-tag); added MIT LICENSE
  + `license` fields + README notice; gitignored `docs/website.md`. `spanklitch/verqury` → public.
- **Shipped verqury.com:** new repo `spanklitch/verqury-site` (static, no build) — landing + 4
  sub-pages, dark-navy/chrome theme, subtle motion (reduced-motion + JS-gated reveals), `_headers`
  CSP. Cloudflare Pages connected (Gary's OAuth) → LIVE at https://verqury.com + www (SSL, all
  pages 200). Enabled Discussions; published the v0.6.0 GitHub Release (AppImage + .deb).
- **App deep-links** (commit 6733034, pushed; release batched): Settings "About & updates" card →
  Check-for-updates (`/whats-new/`) + Share-an-idea (`/ideas/`); `app:version` IPC; VERQURY_VERIFY
  block 14. Lint + 17 app tests green.
- **Screenshots:** new `VERQURY_CAPTURE` dev hook captures each view against a curated "Aurora"
  demo root → real shots replaced the v0.3.0 placeholders (2×2 grid). Fixed a bug the shots
  surfaced (task detail rendered literal "null" for report-less tasks).
- **PII remediation (image-based):** grep pass was blind to pixel-PII — public README hero leaked
  a real home-dir path + private project name, terminal.png leaked the machine hostname. Replaced
  HEAD; filter-repo-purged the PII image blobs from BOTH repos' history + deleted 4 stale remote
  feature branches; fresh-mirror verified; overwrote Cloudflare's retained terminal.png with a 1×1
  blank (Pages keeps deleted files). Other public repos' images audited clean. Eng-notes §9.
- **Relay** confirmed working (was presence=Here, not a bug); ADR-0011 → Accepted.
- **Deferred to v0.6.1 batch:** rebuild + `gh release` so deep-links reach the installed app; run
  block 14 in a clean build; workflow videos (Gary records). Resume list in SESSION_STATE.md.

### 2026-08-06 — v0.6.1 release cut (release session, Opus 5)
**Shipped the deferred v0.6.1 batch** — the deep-links have been on `main` since 2026-07-24 but
never reached the installed app, because the previous session ran Claude Code *inside* Verqury's
embedded terminal and could not overwrite its own mounted AppImage. This session ran from a plain
xfce4-terminal, which removed the blocker.

- **README status line** was stale at v0.3.0 (repo was at v0.6.0 with the whole relay shipped) —
  the first thing a visitor to the now-public repo reads. Rewritten for 0.6.1.
- **Version bump** 0.6.0 → **0.6.1** via `npm version --workspaces --include-workspace-root
  --no-git-tag-version` (root + core + app + lockfile in one shot — avoids the manual lockfile
  drift that needed the separate `9c7ce18` sync during the 0.5.1 cut).
- **CHANGELOG** `[Unreleased]` → **`[0.6.1] - 2026-08-06`**, empty `[Unreleased]` retained,
  compare-links updated.
- **Built** AppImage + .deb clean (electron-builder 25.1.8, exit 0). Run **backgrounded on
  purpose**: a foreground build that trips the agent's 10-min tool timeout gets killed mid-flight,
  which is exactly what produces the `app-builder CANNOT_EXECUTE` state from the 0.5.1 session.
- **VERQURY_VERIFY block 14 verified in the clean packaged build** (the outstanding item):
  `aboutDeepLinks` / `aboutVersionShown` / `aboutSiteLink` all true, **55/55 checks green**, full
  P2–P10 regression alongside. Harness run against a throwaway `VERQURY_DATA_ROOT` in scratch,
  never the real data root (the harness mutates: creates projects, flips stage, files artifacts).
- **Launcher repointed** 0.6.0 → 0.6.1 via `scripts/install-desktop.sh` (md5-verified identical to
  the dist artifact). Rollback = re-run the script against `app/dist/Verqury-0.6.0.AppImage`.
- 70 tests + lint + secret-hygiene grep green before and after.

**Gotcha (harness fixtures are load-bearing):** a first harness run reported `packetHasContext:
false`. Not a regression — `main.js:718` asserts three *literal* strings (`build context`,
`Security Baseline`, `Build 93`) that must exist in the seeded root. A bare `project create` has no
narrative and a differently-worded log entry fails the match. Re-seeded with those fixtures → true.
If you re-run the harness on a fresh root, seed it to match or expect this false.

**Diagnosed (not a bug — two symptoms, one cause):** Gary believed Verqury was closed, yet the
Telegram relay kept working in a plain terminal. The app had been resident **7 days 20 hours**
(started Jul 29 19:40, ~25 min after boot; no autostart entry). `app/main.js:1067`
`window-all-closed` deliberately keeps it alive when a tray exists — design principle #4, quiet
companion; only tray → Quit exits. That also explains the relay: **outbound** needs no app at all
(the hooks in `~/.claude/hooks/` + `~/.claude/settings.json` are global and fire for *every*
Claude Code session, in any terminal), while **inbound** taps need the app as the single
`getUpdates` consumer — so working bidirectional traffic was *proof the app was alive*.

**Two UX items surfaced, deliberately NOT fixed here (out of scope for a release cut):**
1. No affordance that closing the window ≠ quitting — an 8-day invisible instance is the evidence.
2. The half-failure is **silent**: quit the app while presence is Away and the phone still buzzes
   (hooks fire), but nothing consumes the reply — every prompt rides the ~9-min self-expire.

### 2026-08-06 — v0.6.2: six fixes from Gary's list (fix session, shipped)

Not a plan phase — the fix/feature list foreshadowed at the end of the 0.6.1 cut, worked in one
sitting and released the same day. Four commits (`f032471` terminal tabs → `0dfbfbf` relay →
`d9fca8c` tasks → `325d61a` docs) then `7596865` cut **v0.6.2**; tag pushed, GitHub release
published with AppImage + .deb, launcher repointed (installed AppImage md5-matches
`app/dist/Verqury-0.6.2.AppImage`). **78 tests green** (53 core + 25 app; +8 from the new
`app/test/ask-card.test.js`) + lint.

**1. The bell was eating the keyboard — and it was never the bell.** Typing in one terminal tab
while another rang BEL sent every subsequent keystroke nowhere until you clicked back in. Not
focus-stealing and not a tab switch: `onBell` called the full `render()`, whose
`replaceChildren` detached and re-appended the *active* session's container, and **detaching a
DOM node moves focus out of everything inside it** — here the xterm helper textarea. `render()`
never re-focuses; only `setActive` does, which is why clicking the tab you were already on
"fixed" it. A bell now repaints only the tab strip. Guarded by VERQURY_VERIFY **block 15**
(`bellKeepsFocus`, `main.js:1025`) — and the guard was **confirmed to go false against the old
code** before it was kept. A regression guard nobody has watched fail is not a guard.

**2. The drop overlay latched on forever.** Dragging a file onto the embedded terminal left the
dashed "Drop to capture" overlay stuck until restart. The overlay is cleared by document-level
listeners on the **bubble** phase, and the terminal's own `drop` handler calls
`stopPropagation()` — so the cleanup never ran. Cleanup moved to the **capture** phase (plus
`dragend` for a drag abandoned outside the window), and the overlay no longer claims the terminal
area at all, since a drop there means something different.

**3. Terminal tabs got legible.** Per-tab colors *claimed* for a tab's lifetime (not positional —
positional re-colors survivors when a neighbour closes, which destroys the "the build is in the
purple one" muscle memory the color exists to build); a closed tab's color returns to the pool.
Background-tab bell blinks in its own color, with a steady high-contrast state under
`prefers-reduced-motion`. File drops type the path like a plain terminal does — via
`webUtils.getPathForFile()`, because **Electron 41 removed `File.path`** and reading it just
yields `undefined` (checked against the installed `electron.d.ts`, not memory).

**4. The Phase C email channel had never fired — it had no input.** Fully configured since
0.6.0, zero mails sent. `maybeEmailQuestion` requires `kind === 'question'`, and only the
`verqury-ask` skill creates those; across **347** approval records there were **zero**. The
feature wasn't broken, it had never been triggered. *Before debugging a feature that "doesn't
work", count its input records.*

**5. `AskUserQuestion` was already arriving — disguised as a permission.** Claude Code's
multiple-choice question comes through the `PermissionRequest` gate as an ordinary permission
whose **body is the tool's JSON payload** — question, options, descriptions, all already on disk,
and all thrown away in favour of a bare "Approve this?" card. New `app/src/ask-card.js` parses it
into a readable card (question + option labels) and a long-form email (options *with*
descriptions), which is what finally exercised the email channel. Cards cap at 3500 chars
(real limit 4096) measured on the **assembled** string — summing the fixed parts miscounts the
`join('\n')` separators, and over the cap the send fails and the card is lost.
**Hard limit, don't fight it:** `PermissionRequest` returns allow/deny only, so a tapped option
*cannot* answer the question — approving means "let it render at my desk". Answer-from-phone is
what the blocking, file-mediated `verqury-ask` skill is for.

**6. Editable task bodies + an `idea` lane** (`core/src/schema.js`) — a task can be jotted as a
one-liner and fleshed out over several sittings, so a fix list lives in the app instead of a
notes file. Immediately load-bearing: Gary filed the next three ideas (Time Tracker, Token
Tracker, Lines of Code Counter) straight into the `idea` lane on 2026-08-07.

Gotchas in engineering-notes **§10** (terminal) and **§11** (question relay).

### 2026-08-07 — Docs backfill (hygiene session, Opus 5)

The 0.6.2 session shipped code, CHANGELOG, and eng-notes §10–11 but never wrote its PROGRESS
entry or refreshed SESSION_STATE — so the notebook claimed v0.6.1 was still awaiting a push
while the repo, the tag, the GitHub release, and the installed launcher were all at **v0.6.2**.
Backfilled the entry above from the commit range + eng-notes, re-verified state (78 tests green,
tags pushed, release assets present, installed md5 matches), and rewrote SESSION_STATE.md.
**Process note:** a release cut isn't done when the tag lands — PROGRESS.md is the only place
the *reasoning* survives, and it's the one artifact a shipping session is most likely to skip.

### 2026-08-07 — Project instrumentation: ADR-0013 + the build-time meter (initiative, Opus 5)

Opened the initiative behind Gary's three `idea`-lane tasks (Time Tracker, Token Tracker, Lines
of Code Counter). They are **one** question — *what did this project cost to build?* — so the
session went **ADR first**, then one slice: the shared substrate plus time and tokens. LOC stays
filed.

**The finding that shaped everything.** Token Tracker was flagged last session as the riskiest
data-sourcing problem. It wasn't — the data was already on disk. Claude Code writes one JSONL
transcript per session under `~/.claude/projects/<slugified-cwd>/`, and every assistant record
carries a full `usage` block. Time and tokens therefore come from **the same file scan**; they
were never two features. The join key already existed too: a project's `repo` frontmatter field.

**Weighed the official interface honestly, and rejected it with reasons** (Gary's "is there an
official API?" rule). Claude Code *does* export `claude_code.token.usage`, `cost.usage`, and
`lines_of_code.count` over OpenTelemetry — better-specified, and it answers all three ideas.
It loses on three points that are decisive here: it is **prospective only** (the transcripts
already held 9 sessions / 96.5 h / 234 M cache-read tokens for this project — OTel starts every
project at zero), its collector-free exporter **binds one fixed port (9464)** against ADR-0010's
concurrent sessions, and it needs `CLAUDE_CODE_ENABLE_TELEMETRY=1` on **every** session or the
hole is permanent. Recorded in ADR-0013 as the intended successor for cost + LOC.

**Wall-clock time would have lied by ~5×.** Measured on this project's own transcripts: **96.5 h**
first-record-to-last vs **20.6 h** with idle gaps over 15 min capped. The difference is a laptop
left open overnight. Both are recorded (`wallSeconds`/`activeSeconds`); **active** is the headline,
wall sits in the tooltip. A meter that says 96.5 h is a vanity number, not a smaller truth.

**Built.** `core/src/sessions.js` — `harvestSessions` / `listSessions` / `projectMetrics` /
`summarizeTranscript` / `findTranscripts`, writing one record per session to
`projects/<slug>/sessions/<session-id>.md` (a **fourth** file-backed collection beside artifacts,
tasks, memory — ADR-0001). Session id *is* the filename, so re-harvesting is idempotent by
construction, and the first run **backfills all history**. `verqury session harvest|list|metrics`
on the CLI; a meter on project detail (`⏱ 20.6h build time · 2.0M out · 9 sessions`) with a
↻ Harvest button, raw counters in the tooltip.

**Two bugs the tests caught, both real:**
1. The slug fast path matched the transcript directory **exactly**, which silently dropped every
   session started in a *subdirectory* of the repo (they get their own directory). Fixed to
   narrow by slug **prefix**; `cwd` inside the file remains the authoritative join, which is what
   rejects a same-prefix neighbour like `/repo/mine-other`.
2. A PII slip: the slug unit test hard-coded the real home path + username into a **public** repo
   — the exact class of leak eng-notes §9 exists to prevent. Caught by the pre-commit PII grep,
   not by review. Genericized to `/home/dev`.

**Verified.** **88 tests green** (61 core + 27 app, up from 78) + lint clean + secret/PII grep
clean. VERQURY_VERIFY harness against a **throwaway** root + fixture transcript tree:
**74/75**, including the new meter block (`meterHarvested`/`meterMetrics`/`meterIdempotent`/
`meterRendered`) and full regression. The one false is `hotkeyRegistered` — Gary's installed
AppImage was tray-resident and holds the global `Control+Alt+C`, so a second instance can't
register it; `captureFiledArtifact`/`captureRoundTrips` pass on the same code path without the
OS shortcut, which is how you tell it apart from a regression.

**Deviations:** none. No release cut — this session ran in a plain xfce4-terminal (build was
possible), but the slice is source-only and 0.6.3 should batch with whatever comes next.

Gotchas in engineering-notes **§12**.

### 2026-08-07 — v0.6.3: the meter ships, and the relay stops stalling (release session, Opus 5)

Second stretch of the same day, taken deliberately against the one-phase-per-session rule (Gary
had time and waived it knowingly). Picked the **two UX items carried since the 0.6.1 cut** over
opening the LOC/OTel initiative — they were already diagnosed, so this was implementation rather
than design, and they turned a thin "we added a meter" release into a substantive one.

**1. The nine-minute stall (the real bug).** With presence Away the `PermissionRequest` gate
engaged unconditionally — but the pending record's only consumer is the **app** (the single
Telegram `getUpdates` owner). App closed ⇒ no card sent, no tap read, so **every** permission
request blocked for the full ~9-minute self-expire before the desk prompt appeared. The old hook
comment called this "expires to the desk: safe"; it was safe and unusable. Worse, it *looked*
healthy: the notify hook is app-independent and kept buzzing about other events, so the relay
seemed alive. **A working outbound leg is not evidence of a working inbound one.**
*Fix:* `core/src/runtime.js` — the app writes `<root>/runtime/app.json` (`{pid, updated}`) every
30 s and clears it on quit; the dependency-free hook re-reads it (cross-reader test, same contract
as `approvals.js`). Liveness is checked **last** so `here`/`disabled`/`no-token` remain the
reported reason when they apply. Timestamp **and** pid are both checked — a stale beat catches a
wedged app, `process.kill(pid,0)` catches a `kill -9` instantly. Heartbeat lives outside the
watched markdown tree, so beats can't spin the watcher or the FTS refresh (pinned by a test).

**2. Closing ≠ quitting.** Tray residency is design principle #4, but an instance once ran 7d20h
unnoticed. Now a one-time notification (persisted as `closeHintShown`) plus a permanent tray
tooltip. Once, not every close — a nag trains you to ignore it.

**Released 0.6.3.** `npm version --workspaces --include-workspace-root` (root+core+app+lockfile in
one shot), CHANGELOG `[Unreleased]` → `[0.6.3]`, and the **public README status line** refreshed —
the same stale-status trap that forced the 0.6.1 cut. Built AppImage + .deb **backgrounded**.

**Verified.** **96 tests** (69 core + 27 app) + lint + secret/PII grep clean. Harness **77/78 in
dev** (new: `permHookNeedsRunningApp`, `permHookRelaysWhenAppUp`, `closeHintOnce`, plus the four
meter checks) and **63/64 against the packaged AppImage** (`aboutVersionShown` true, meter renders
in the packaged build). The lone false in both is `hotkeyRegistered` — the installed tray-resident
instance holds the global `Control+Alt+C`.

**Two gotchas worth the ink:**
- **Upgrade order is load-bearing: app first, then hook.** `~/.claude/hooks/` holds *copies* and
  `install-desktop.sh` does **not** install them (it never has). The new hook expects a heartbeat
  only ≥0.6.3 writes — paired with an older app it reads `app-not-running` every time and stops
  relaying entirely. Fails safe, fails silent: the exact bug class this release removed.
- **`pgrep -f "electron-builder"` matches your own waiter.** A wait-loop whose command line
  contains the pattern never terminates, because it finds itself. The build had finished ~25 min
  earlier; only the loop was stuck. Exclude `bash -c`, or match the real process another way.

**Deviations:** launcher NOT repointed and hooks NOT installed in-session — `install-desktop.sh`
overwrites `~/Applications/Verqury.AppImage`, which was mounted and running (ETXTBSY). Needs Gary
to Quit from the tray first. Gotchas in engineering-notes **§13**.

### 2026-08-08 (late 08-07) — v0.6.3 installed + verified; a second relay bug found

**Install completed and verified end-to-end.** Repo, tag, GitHub release, installed AppImage
(md5 `fad0d05c…`) and the updated hook are all 0.6.3. The gate was proven on the **real** data
root in both directions: app down → `{engage:false, reason:"app-not-running"}` in **31 ms** with
nothing filed (previously: 9 minutes and a record); app up → engages and files as designed.

**Diagnosing "running but no tray icon."** Gary reported the tray icon missing while a process
still showed. Findings worth keeping: the AppImage spawns a small **FUSE mount** process
(`WCHAN fuse_dev_do_read`, ~1.7 MB) that is *not* the app — the real one is
`/tmp/.mount_Verqur*/verqury-app` at ~96 MB. That instance was **healthy**, not wedged: 1038 CPU-
seconds over 16 h and two ESTABLISHED :443 sockets (the Telegram long-poll). Only the tray icon
was missing — `setupTray()` catches its own failure and continues, so a launch can end up resident
with **no window and no tray icon at all**, unreachable. It returned on 0.6.3, so it is transient,
not systematic. Uncomfortable corollary: the close-hint added hours earlier says "open it from the
tray icon", which is useless in precisely that state. The panel-restart hypothesis was tested and
**disproved** (panel up 9 days, app 16 h).

**The pile of expired records turned out to be the diagnostic.** 484 approvals, **305 expired**,
last human answer 2026-08-06 15:47 — presence had been left `away` at the desk, so every request
relayed, went untapped, and burned the full 9 minutes. That aggregate is what made the stall's
scale legible. **Anyone tempted to purge these should read that sentence twice.**

**NEW BUG FOUND (filed to the `idea` lane, next session's target).** The ~9-minute self-expire
lives **only inside the hook process**. If that process dies first — session ends, Ctrl+C, sleep,
kill — the record stays `pending` **forever**; nothing else reaps it. Proven: two records from
21:23/21:29 still `pending` ~6 h later. `reconcileApprovals` only *sends* cards and nudges and has
**no expiry path**, so on app restart those zombies get **fresh Telegram cards** — phantom
approvals for tool calls that finished hours ago. *Fix direction:* give expiry authority to the
app (it outlives any hook); keep the hook's self-expire as the fast path, not the only path.
Retention is a **separate** question and the answer is not "purge" — roll per-session relay counts
into the `sessions/` record from ADR-0013, then prune detail past a window.

**Correction worth recording:** an in-session claim of "17 blocked hook processes" was wrong —
`pgrep -f` was matching its own command line again (the same trap that hung the build wait). The
measured figure was **2 processes / 4.2 MB**; they do drain. Memory pressure was never the issue.

**Deviations:** none. No code changed in this stretch — install, verification, and diagnosis only.

### 2026-08-09 — orphaned approvals reaped: expiry gets an owner

**The bug from the last session, fixed at its root.** The countdown that expires an unanswered
request lived only inside the process that filed it — the hook (9 min) or the `verqury-ask` skill
(20 min) — so a session that ended first left the record `pending` with nobody responsible for it.
The two records filed 2026-08-07 at 21:23/21:29 were still pending when this session opened,
**43.5 hours** later, and would have drawn fresh Telegram cards on the next app start.

**What shipped (`a05d9a2`, local):**
1. **`sweepExpiredApprovals(root, { now })`** in `core/src/approvals.js` — reaps any pending past
   its window; per-kind (`PERMISSION_EXPIRE_MS` 9 min / `QUESTION_EXPIRE_MS` 20 min) **plus a 60 s
   grace**, so the writer's own timer stays the fast path and wins the ordinary race. Safe because
   both writers only ever *shrink* their window via env, and only for tests.
2. **`api.reapExpiredApprovals`** + a `reapExpiredApprovals()` in `app/main.js` on the 30 s
   interval, at startup, and inside `syncRelay` — always **before** a reconcile, so an orphan is
   expired rather than carded, and it runs whether or not the relay is configured.
3. **A record with no parseable `created` is skipped**, left visible in the inbox. Guessing an age
   is how you cancel something real.
4. **Four tests** (100 total: 73 core + 27 app), lint clean, secret/PII grep clean.

**Verified on the real data root, not a fixture.** The sweep reaped both 43-hour orphans
(`…4C31A7`, `…4ADDB8`) → **0 pending, 326 expired**. The in-app `idea` task is closed. Gotchas in
engineering-notes **§14**; CHANGELOG entry under Unreleased.

**Deviations:** the fix is committed locally but **not pushed** and **not released** — no version
bump, no AppImage. The running 0.6.3 install therefore still has the old behaviour; the reap
lands with the next build.

### 2026-08-09 (same day) — v0.6.4 released, installed, and verified

Cut and shipped the orphan-reap fix as a one-fix release.

1. **Version** 0.6.3 → 0.6.4 across root/core/app + lockfile; CHANGELOG `[Unreleased]` →
   `[0.6.4] - 2026-08-09`, and the **compare link the 0.6.3 cut forgot** was added back.
2. **Built** AppImage + .deb backgrounded, from a plain xfce4-terminal (never Verqury's own
   embedded one). Clean, exit 0.
3. **Packaged harness: 64/64, zero failures**, against a throwaway `VERQURY_DATA_ROOT` +
   `VERQURY_TRANSCRIPTS_ROOT`. The seed script had died with its scratchpad, so it was rebuilt —
   requirements now written down in SESSION_STATE rather than rediscovered a third time.
4. **The fix proved in the packaged binary**, which the harness does not cover: planted a
   2-hour-old `pending` record in the throwaway root, ran `Verqury-0.6.4.AppImage`, and the record
   came back `expired`. That is the release's own claim tested against the artifact being shipped,
   not against the source it was built from.
5. **Installed** to `~/Applications/Verqury.AppImage` (md5 `341ba7cb7e1b40b8e4d51bbde4feb082`,
   verified against `app/dist/`). Hooks unchanged this release — repo and `~/.claude/hooks/` md5s
   still match, so the app-first/hook-second upgrade order had nothing to do.
6. **Pushed** `main` + tag `v0.6.4`; **GitHub release published** with both artifacts.

**Gotcha worth keeping:** `scripts/install-desktop.sh` installs the **newest** AppImage in
`app/dist/` (`ls -t | head -1`), not a version you name — a rollback means moving the newer file
out of the way first.

**Deviations:** none.

**Field confirmation (Gary, 2026-08-09):** the **Phase C email context channel works end-to-end to
Gmail**. Long permission requests arrive as email carrying the **matching Telegram ticket number**,
so the two channels join up as designed. That was the last relay leg never verified against real
mail — it is no longer a theoretical path. Email remains deliberately powerless (no action link);
authority stays on the authed Telegram chat.

### 2026-08-10 — Project instrumentation, slice 2: LOC + real cost via OpenTelemetry (ADR-0014)

Built the third metric idea ADR-0013 had to leave in the `todo` lane. Transcripts record what a
session *said*, never how much code it changed or what it cost — those numbers exist only in
Claude Code's own OpenTelemetry export. So Verqury now runs a receiver for it.

**Shipped (committed + pushed, `05efc7c`):**
1. **`core/src/telemetry.js`** — parses an OTLP/HTTP-JSON metrics export, resolves each session to
   a project, and merges the result into the existing `projects/<slug>/sessions/<id>.md`.
2. **`app/src/otel-receiver.js`** — a plain `node:http` listener in the Electron main process. No
   collector binary, no new dependency; **loopback-only, port configurable, off by default**. A
   taken port degrades the meter to "no numbers" rather than blocking startup.
3. **App wiring** — api + IPC + preload, main-process lifecycle, and env injection for sessions
   **Verqury launches** (both the embedded pty and externally spawned adapters).
4. **UI** — the LOC figure on the project meter, plus a **Settings → Build metrics** panel.
5. **113 tests** (81 core + 32 app), **harness block 18** (7 checks, all green), engineering-notes
   **§15**, CHANGELOG under `[Unreleased]`.

**Verified on live data, not fixtures.** A real `claude -p` session produced `+4/-0 lines` and
`$0.000621`, and the meter rendered **"4 lines since Aug 2026"**. That also settled the assumption
ADR-0014 flagged as load-bearing but unconfirmed: the metrics' `session.id` really does equal the
transcript basename, which is the only reason attribution works at all (the payload carries no
`cwd`, so it must route *through* the transcript).

**Design decisions honoured from the ADR:** the meter labels LOC **by start date** and never shows
a bare zero, because counting cannot be backfilled — the measurements did not exist before the
switch was flipped. And only Verqury-launched sessions are instrumented, so the figure is
explicitly a **floor, not a total**.

**Two gotchas that cost real time, both written up in §15:** the generic
`OTEL_EXPORTER_OTLP_ENDPOINT` is gRPC-only and fails **silently** under http/json (use
`OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` with the full `/v1/metrics` path); and the counters are
**cumulative**, re-exported every interval, so the merge must be last-value-wins — summing
triple-counts a 30-second session.

**Deviations:** the slice is built, tested and pushed but **NOT released** — no version bump, no
AppImage, and ADR-0014 is still `Proposed` (it flips to `Accepted` on release, per the 0011
precedent). The session ended abruptly: the machine was shut down ahead of a storm-related power
outage, which is also why this entry was written the following session rather than at the time.

**Carried, not done:** an ingest that matches no project is counted in the return value but shown
nowhere, so a silently-dropped session looks identical to no session at all.

### 2026-08-10 (same day) — v0.6.5 released and installed

Cut the OTel slice as a release. The slice itself was built the previous session; this was
the cut, the verification, and the install.

1. **Version** 0.6.4 → 0.6.5 across root/core/app + lockfile; CHANGELOG `[Unreleased]` →
   `[0.6.5] - 2026-08-10` with its compare link; **ADR-0014 flipped Proposed → Accepted**
   (and in the ADR index) — the 0011 precedent: a design stops being a proposal once it
   ships in a binary.
2. **Built** AppImage + .deb backgrounded from a plain terminal. Clean, exit 0.
3. **Packaged harness: 60 boolean checks, zero failures**, against a throwaway
   `VERQURY_DATA_ROOT` + `VERQURY_TRANSCRIPTS_ROOT`. Three blocks skip by design in a
   packaged run (hooks/ and skills/ aren't bundled).
4. **Block 18 green in the packaged binary** — all seven ingest checks. Unlike 0.6.4, this
   release's own claim is inside the harness, so no separate probe against the artifact was
   needed: the receiver bound, took a real-shaped OTLP POST, and the numbers reached both the
   record and the meter, surviving a re-harvest.
5. **Installed** to `~/Applications/Verqury.AppImage` (md5 `ba6e7d1578c5ec0a3b81d3eda63f071d`,
   verified against `app/dist/`). Hooks untouched since v0.6.4 and the installed copies still
   match the repo, so there was no hook step.

**The harness seed bit again, in a new way.** The rebuilt seed gave its project
`repo: /harness/repo` — the same path block 17 creates *Harness Metrics* with. Session →
project resolution takes the **first** project whose repo contains the cwd, so the seed
project silently swallowed the ingest: the receiver bound, the POST returned 200, and four
block-18 checks failed with the numbers nowhere. The seed now uses `/harness/seed-only`.
Worth knowing beyond the harness: **two projects claiming the same repo is genuinely
ambiguous**, and Verqury resolves it by declaration order rather than complaining. Not a
release blocker — it takes a duplicate repo path to reach — but it is a real sharp edge.

**Deviations:** none.

### 2026-08-10 (same day) — v0.6.6: one app per data root

Gary reported that exiting Verqury left something running on the box. Investigation first, then
two fixes and a cut.

**The finding.** Quit was never the broken part — `before-quit` releases everything and the
process really does end, with no stale AppImage mount. The problem was that **nothing enforced
one instance**: every launch built a complete second app (~168 MB, tray-resident, independent),
so Quit only ended the one whose tray icon you clicked. Confirmed by running two side by side.
Combined with the known silent `setupTray()` failure (§13), an instance can have no window *and*
no tray icon — a process with nothing left to click.

Two of the consequences are correctness bugs, not waste: two instances both long-poll Telegram,
which must have exactly **one** consumer (ADR-0011), so an approval tap can be swallowed by the
copy you aren't watching; and the heartbeat is one file per root, so whichever instance quits
first tells the gate "no app" while another is running and answering.

**Shipped:**
1. **Single-instance lock, scoped per data root** ([ADR-0015]). Electron keys its lock on the
   userData directory, so an explicit `VERQURY_DATA_ROOT` gets its own — which keeps the rule
   honest (one app per *root*) and lets a harness or dev run coexist with the installed app. A
   machine-wide lock would have broken the release procedure itself.
2. **`second-instance` shows and focuses the existing window**, because launching again means
   "show me the app" — a second click that appeared to do nothing would be worse than the bug.
3. **`clearHeartbeat(root, { pid })`** refuses to delete a beat owned by a different **live**
   process. Deliberately asymmetric: pid-less, unreadable and dead-pid beats stay clearable by
   anyone, because a permanently unclearable heartbeat would disable the relay for good.
4. **118 tests** (86 core + 32 app; +5 core), **harness block 19** (`singleInstanceLock`,
   `heartbeatSurvivesSiblingQuit`), **ADR-0015**, engineering-notes **§16**, CHANGELOG.

**Verified in the packaged binary, beyond what the harness covers.** The harness can only prove
the lock is *held*; it cannot prove a second launch is *refused*. So: launched
`Verqury-0.6.6.AppImage`, launched it again on the same root — the second exited immediately, the
first stayed up, and its heartbeat still carried its own pid, proving the loser's `before-quit`
left it alone. Both fixes, together, against the artifact being shipped.

**Packaged harness: 62 boolean checks, zero failures.** Installed to `~/Applications/
Verqury.AppImage` (md5 `1be73ec5640ad115e9f5531108d930dd`). Hooks untouched again this release.

**What this deliberately does NOT fix.** Work started *inside* the embedded terminal that has
detached itself survives Quit. Measured with the shipped node-pty under Electron's ABI:
foreground and plain `&` jobs die with the PTY; `disown`, `setsid` and `nohup` children live on.
That is correct — they are the work Verqury launched, not Verqury — but in a process list they
look identical to a leaked app, which is most of why the original report was confusing. A
quit-time "live work is still running" prompt is the open follow-up.

**Deviations:** none.
