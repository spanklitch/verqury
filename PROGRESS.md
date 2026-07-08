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
- [~] **Phase 8 — Packaging, docs, release prep** (2026-07-07 — code/config/docs done; AppImage build + v0.1.0 tag pending Gary on a real host)

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
